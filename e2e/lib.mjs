import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const ARTIFACTS = join(dirname(fileURLToPath(import.meta.url)), 'artifacts');
mkdirSync(ARTIFACTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
let passed = 0;

/** Маленький раннер: шаг = проверка с понятным названием. Падение шага не роняет остальные. */
export async function step(title, fn) {
  const t0 = Date.now();
  try {
    await fn();
    passed++;
    console.log(`  ✔ ${title} (${Date.now() - t0} мс)`);
  } catch (e) {
    failures++;
    console.log(`  ✖ ${title}\n      ${String(e?.stack ?? e).split('\n').slice(0, 4).join('\n      ')}`);
  }
}
export function summary(name) {
  console.log(`\n${name}: ${passed} пройдено, ${failures} упало`);
  return failures === 0;
}
export function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
export async function until(fn, { timeout = 15_000, every = 200, msg = 'условие не выполнилось' } = {}) {
  const end = Date.now() + timeout;
  let last;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
      last = v;
    } catch (e) { last = e; }
    if (Date.now() > end) throw new Error(`${msg} (за ${timeout} мс; последнее значение: ${last instanceof Error ? last.message : JSON.stringify(last)})`);
    await sleep(every);
  }
}

async function waitHttp(url, timeout = 60_000) {
  return until(async () => (await fetch(url)).ok, { timeout, every: 300, msg: `не поднялся ${url}` });
}

function run(cmd, args, opts) {
  const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  const log = [];
  p.stdout.on('data', (d) => log.push(String(d)));
  p.stderr.on('data', (d) => log.push(String(d)));
  p.log = log;
  return p;
}

/** Backend (демо-режим, временная БД) + Vite dev-сервер с прокси /api и /ws. */
export async function startStack({ backendPort = 8797, webPort = 4597 } = {}) {
  const db = join(mkdtempSync(join(tmpdir(), 'antistall-e2e-')), 'e2e.db');
  const backend = run(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/server.js'], {
    cwd: join(ROOT, 'backend'),
    env: { ...process.env, TOMATO_DEMO: '1', TOMATO_DB: db, PORT: String(backendPort), HOST: '127.0.0.1' },
  });
  await waitHttp(`http://127.0.0.1:${backendPort}/api/health`);
  const vite = run(process.execPath, [join(ROOT, 'frontend/node_modules/vite/bin/vite.js'), '--port', String(webPort), '--strictPort', '--host', '127.0.0.1'], {
    cwd: join(ROOT, 'frontend'),
    env: { ...process.env, VITE_BACKEND_URL: `http://127.0.0.1:${backendPort}` },
  });
  await waitHttp(`http://127.0.0.1:${webPort}/`);
  return {
    url: `http://127.0.0.1:${webPort}`,
    api: `http://127.0.0.1:${backendPort}`,
    async stop() { backend.kill(); vite.kill(); await sleep(300); },
    logs: () => ({ backend: backend.log.join(''), vite: vite.log.join('') }),
  };
}

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = {
    win32: ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'],
    darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
    linux: ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
  }[process.platform] ?? [];
  return candidates.find((p) => existsSync(p));
}

/**
 * Настоящий Chrome. Микрофон — встроенное тестовое устройство Chrome (периодический сигнал):
 * подменяется только источник звука, а WebRTC, ICE, DTLS, кодек и WebAudio — настоящие.
 */
export async function launchChrome() {
  const executablePath = chromePath();
  assert(executablePath, 'Не найден Google Chrome: задайте CHROME_PATH');
  return chromium.launch({
    executablePath,
    headless: process.env.HEADED !== '1',
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
  });
}

/** Отдельный браузерный профиль на каждого игрока (свой localStorage = своя учётка). */
export async function openUser(browser, env, name, { denyMic = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: denyMic ? [] : ['microphone'] });
  if (denyMic) {
    // пользователь нажал «Запретить» в диалоге доступа к микрофону
    await context.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
    });
  }
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|WebSocket connection|ERR_CONNECTION|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  return { name, page, context, errors };
}

/** Лендинг → «Начать» → имя → «Создать комнату». Возвращает код комнаты. */
export async function createRoom(u, env) {
  await u.page.goto(env.url + '/');
  await u.page.getByRole('button', { name: 'Начать', exact: true }).first().click(); // в меню и в первом экране лендинга
  await u.page.getByPlaceholder('Например, Лотти').fill(u.name);
  // сценарии проверяют общую комнату; режим «Две команды» по умолчанию включён — снимаем галочку
  await u.page.getByRole('checkbox', { name: /Две команды/ }).uncheck();
  await u.page.getByRole('button', { name: 'Создать комнату' }).click();
  await u.page.waitForURL(/\/room\/[A-Z0-9]{6}$/);
  return u.page.url().split('/room/')[1];
}

/** Ссылка-приглашение → имя → «Войти в комнату». */
export async function joinRoom(u, env, code) {
  await u.page.goto(`${env.url}/room/${code}`);
  await u.page.getByPlaceholder('Например, Лотти').fill(u.name);
  await u.page.getByRole('button', { name: 'Войти в комнату' }).click();
  await u.page.getByTestId('voice-bar').waitFor({ timeout: 15_000 });
}

export const token = (u) => u.page.evaluate(() => localStorage.getItem('tomato.token'));
export async function api(env, u, method, path, body) {
  const t = await token(u);
  const res = await fetch(env.api + path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
}

export async function shot(u, file) {
  await u.page.screenshot({ path: join(ARTIFACTS, file) });
}
