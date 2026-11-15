/**
 * Голос в настоящем Chrome: 4 участника + слушатель без доступа к микрофону.
 * Проверяем WebRTC-соединения каждый-с-каждым и реальный поток аудио (getStats), индикатор
 * говорящего, mute/deafen у других, выход, перезагрузку страницы без «мёртвых» соединений.
 *   cd e2e && npm i && npm run voice        (HEADED=1 — смотреть глазами)
 */
import { assert, createRoom, joinRoom, launchChrome, openUser, shot, startStack, step, summary, until } from './lib.mjs';

const env = await startStack();
const browser = await launchChrome();
const names = ['Лотти', 'Аня', 'Боря', 'Вика'];
const users = [];

const voiceStats = (u) => u.page.evaluate(() => window.__antistallVoice?.stats() ?? {});
const voiceSnap = (u) => u.page.evaluate(() => window.__antistallVoice?.snapshot() ?? null);
const peerAttr = (u, userId, attr) => u.page.locator(`[data-testid=voice-bar] [data-voice-peer="${userId}"]`).getAttribute(attr);
const avatars = (u) => u.page.locator('[data-testid=voice-bar] [data-voice-peer]').count();

console.log('\nГолос: WebRTC в Chrome');
try {
  await step('4 игрока заходят в комнату через интерфейс (создание + ссылка-приглашение)', async () => {
    for (const n of names) users.push(await openUser(browser, env, n));
    const code = await createRoom(users[0], env);
    for (const u of users.slice(1)) await joinRoom(u, env, code);
    for (const u of users) {
      u.id = await u.page.evaluate(async () => (await (await fetch('/api/users/me', { headers: { Authorization: `Bearer ${localStorage.getItem('tomato.token') ?? sessionStorage.getItem('tomato.token')}` } })).json()).id);
      await until(async () => (await u.page.locator('[aria-label="Участники"] li').count()) === 4, { msg: `${u.name}: не видит 4 участников` });
    }
  });

  await step('таймер работает без голоса: в голос никто не входил, кнопка «Войти в голос» на месте', async () => {
    for (const u of users) {
      assert(await u.page.getByTestId('voice-join').isEnabled(), `${u.name}: кнопка входа в голос недоступна`);
      assert((await u.page.getByTestId('voice-bar').getAttribute('data-voice-status')) === 'idle', 'голос не должен включаться сам');
    }
  });

  await step('все входят в голос: у каждого 3 соединения в состоянии connected, в полосе 4 аватара', async () => {
    for (const u of users) {
      await u.page.getByTestId('voice-join').click();
      await until(async () => (await u.page.getByTestId('voice-bar').getAttribute('data-voice-status')) === 'connected', { msg: `${u.name}: не подключился` });
    }
    for (const u of users) {
      await until(async () => {
        const s = await voiceStats(u);
        return Object.keys(s).length === 3 && Object.values(s).every((x) => x.state === 'connected');
      }, { timeout: 20_000, msg: `${u.name}: не все WebRTC-соединения установлены` });
      await until(async () => (await avatars(u)) === 4, { msg: `${u.name}: в полосе не 4 аватара` });
    }
    await shot(users[0], 'voice-4-connected.png');
  });

  await step('звук реально идёт: входящие RTP-пакеты от каждого собеседника растут', async () => {
    for (const u of users) {
      const a = await voiceStats(u);
      await new Promise((r) => setTimeout(r, 2000));
      const b = await voiceStats(u);
      for (const [peer, s] of Object.entries(b)) {
        assert(s.packetsReceived > (a[peer]?.packetsReceived ?? 0) + 20, `${u.name} ← ${peer}: пакеты не растут (${a[peer]?.packetsReceived} → ${s.packetsReceived})`);
        assert(s.bytesSent > 0, `${u.name} → ${peer}: ничего не отправлено`);
      }
    }
    const els = await users[1].page.locator('audio[data-voice-peer]').count();
    assert(els === 3, `у Ани ${els} аудио-элементов вместо 3`);
  });

  await step('индикатор «говорит»: тестовый сигнал микрофона Лотти подсвечивает её аватар у Ани', async () => {
    await until(async () => (await peerAttr(users[1], users[0].id, 'data-speaking')) === 'true', { timeout: 20_000, every: 50, msg: 'подсветка говорящего не появилась' });
  });

  await step('mute: Лотти выключила микрофон — у остальных значок, «говорит» не горит', async () => {
    await users[0].page.getByTestId('voice-mute').click();
    for (const u of users.slice(1)) await until(async () => (await peerAttr(u, users[0].id, 'data-muted')) === 'true', { msg: `${u.name}: не видит mute` });
    await new Promise((r) => setTimeout(r, 1500));
    assert((await peerAttr(users[1], users[0].id, 'data-speaking')) === 'false', 'с выключенным микрофоном не должно быть «говорит»');
    await users[0].page.getByTestId('voice-mute').click();
    await until(async () => (await peerAttr(users[1], users[0].id, 'data-muted')) === 'false', { msg: 'unmute не дошёл' });
  });

  await step('deafen: Аня никого не слышит (все её <audio> заглушены), остальные видят значок наушников', async () => {
    await users[1].page.getByTestId('voice-deafen').click();
    assert(await users[1].page.evaluate(() => [...document.querySelectorAll('audio[data-voice-peer]')].every((a) => a.muted)), 'звук не заглушён');
    await until(async () => (await peerAttr(users[2], users[1].id, 'data-deafened')) === 'true', { msg: 'deafen не виден другим' });
    await users[1].page.getByTestId('voice-deafen').click();
    assert(await users[1].page.evaluate(() => [...document.querySelectorAll('audio[data-voice-peer]')].every((a) => !a.muted)), 'звук не вернулся');
  });

  await step('выход из голоса: у Бори соединения закрыты, у остальных по 2 соединения и 3 аватара', async () => {
    await users[2].page.getByTestId('voice-leave').click();
    await until(async () => Object.keys(await voiceStats(users[2])).length === 0, { msg: 'у Бори остались соединения' });
    assert((await users[2].page.locator('audio[data-voice-peer]').count()) === 0, 'у Бори остались аудио-элементы');
    for (const u of [users[0], users[1], users[3]]) {
      await until(async () => Object.keys(await voiceStats(u)).length === 2 && (await avatars(u)) === 3, { msg: `${u.name}: Боря не исчез` });
    }
  });

  await step('перезагрузка страницы: Вика возвращается, у остальных нет «мёртвых» соединений', async () => {
    await users[3].page.reload();
    await users[3].page.getByTestId('voice-bar').waitFor();
    for (const u of [users[0], users[1]]) await until(async () => Object.keys(await voiceStats(u)).length === 1, { msg: `${u.name}: соединение с Викой не закрылось после перезагрузки` });
    await users[3].page.getByTestId('voice-join').click();
    for (const u of [users[0], users[1], users[3]]) {
      await until(async () => {
        const s = await voiceStats(u);
        return Object.keys(s).length === 2 && Object.values(s).every((x) => x.state === 'connected');
      }, { timeout: 20_000, msg: `${u.name}: после возвращения Вики не 2 живых соединения` });
    }
    const snap = await voiceSnap(users[0]);
    assert(snap.peers.length === 3, `в канале ${snap.peers.length} вместо 3`);
  });

  await step('нет доступа к микрофону: гость входит слушателем — слышит остальных, остальным показан без микрофона', async () => {
    const g = await openUser(browser, env, 'Гость', { denyMic: true });
    const code = users[0].page.url().split('/room/')[1];
    await joinRoom(g, env, code);
    g.id = await g.page.evaluate(async () => (await (await fetch('/api/users/me', { headers: { Authorization: `Bearer ${localStorage.getItem('tomato.token') ?? sessionStorage.getItem('tomato.token')}` } })).json()).id);
    await g.page.getByTestId('voice-join').click();
    await until(async () => (await g.page.getByTestId('voice-status').textContent())?.includes('нет доступа к микрофону'), { msg: 'нет объяснения про микрофон' });
    await until(async () => {
      const s = await voiceStats(g);
      return Object.keys(s).length === 3 && Object.values(s).every((x) => x.state === 'connected' && x.packetsReceived > 0);
    }, { timeout: 20_000, msg: 'слушатель не получает звук' });
    await until(async () => (await peerAttr(users[0], g.id, 'data-muted')) === 'true', { msg: 'слушатель не показан с выключенным микрофоном' });
    assert(g.errors.length === 0, `ошибки в консоли гостя: ${g.errors.join(' | ')}`);
    await shot(g, 'voice-listener-denied.png');
    users.push(g);
  });

  await step('в консоли браузеров нет ошибок', async () => {
    const all = users.flatMap((u) => u.errors.map((e) => `${u.name}: ${e}`));
    assert(all.length === 0, all.join('\n'));
  });
} finally {
  await browser.close();
  await env.stop();
}
process.exit(summary('Голос') ? 0 : 1);
