import { fileURLToPath } from 'node:url';

/**
 * Вся настраиваемая логика проекта. Экономика, лимиты и тайминги живут здесь,
 * а не в коде бизнес-правил — клиент никогда не присылает эти значения.
 */
export function loadConfig(env = process.env, overrides = {}, argv = []) {
  // Флаг `--demo` в командной строке равносилен TOMATO_DEMO=1 (в Windows cmd `VAR=1 node …` не работает)
  const demoMode = env.TOMATO_DEMO === '1' || argv.includes('--demo');
  const cfg = {
    port: Number(env.PORT || 8787),
    host: env.HOST || '0.0.0.0',
    // Демо-сервер по умолчанию пишет в отдельный файл: песочный прогресс не смешивается с настоящей БД.
    // fileURLToPath, а не pathname: pathname ломался на Windows ("/C:/…")
    dbPath: env.TOMATO_DB || fileURLToPath(new URL(demoMode ? '../data/tomato-demo.db' : '../data/tomato.db', import.meta.url)),
    corsOrigin: env.TOMATO_CORS_ORIGIN || '*',
    /** Папка собранного фронтенда (единый образ): сервер отдаёт её на путях вне /api и /ws. Без переменной — только API. */
    staticDir: env.TOMATO_STATIC_DIR || null,

    /**
     * Демо-режим для жюри: только по явному флагу сервера, см. docs/DEMO_MODE.md.
     * Ускоренные комнаты доступны только песочным аккаунтам (users.sandbox), а их токены
     * без демо-режима не авторизуются. Повышенные потолки ниже действуют только в демо-комнатах.
     */
    demoMode,

    // Присутствие: пользователь «жив», пока присылает heartbeat / ping / любой авторизованный запрос.
    onlineWindowMs: 15_000, // дольше — connection = 'reconnecting'
    graceMs: 30_000, //        дольше — сессия считается прерванной, награды нет
    maxBodyBytes: 64 * 1024,

    tickMs: 500, //            как часто сервер проверяет границы фаз
    broadcastTickMs: 1000, //  как часто в комнату уходит timer_tick (для сверки часов)
    wsPingMs: 5000,

    limits: {
      userNameMax: 24,
      roomNameMax: 40,
      taskMax: 80,
      maxMembers: 12,
      maxRoomsPerUser: 5,
      focusMinutes: [10, 120],
      breakMinutes: [3, 30],
      demoFocusSeconds: [5, 600],
      demoBreakSeconds: [5, 300],
    },

    economy: {
      standardFocusMinutes: 25,
      xpPerSession: 100,
      coinsPerSession: 20,
      teamPointsPerSession: 1,
      minRewardFactor: 0.4, // награда масштабируется длиной сессии, чтобы не фармить короткие
      maxRewardFactor: 2,
      dailyRewardedSessions: 16, // потолок наград за сутки (анти-накрутка) — для обычных комнат, в т.ч. на демо-сервере
      demoDailyRewardedSessions: 500, // только для демо-комнат (room.demo): за показ проходят десятки 25-секундных циклов
      challengeReward: { xp: 150, coins: 60 },
      treasuryStart: 30, // стартовый капитал казны каждой команды (Tower Defense); фокус-монеты тоже идут в казну
      td: {
        dailyRewardedRounds: 8,
        demoDailyRewardedRounds: 500, // только для демо-комнат
        duelReward: { xp: 15, coins: 10 }, firstClearMultiplier: 1.5, minRemainingSec: 6,
        counterattackCoins: 40, // «Контратака»: проигравшая дуэль раунда 1 команда получает в казну перед реваншем (один раз)
      },
      nodeReward: { xp: 25, coins: 10 }, // за каждый новый узел карты (победа в этапе TD), один раз на участника раунда
    },

    // Голос: WebRTC mesh внутри комнаты. Сервер только передаёт сигналы и выдаёт ICE-серверы,
    // сам звук идёт напрямую между браузерами (или через TURN, если задан).
    voice: {
      maxPeers: Number(env.TOMATO_VOICE_MAX_PEERS || 8),
      stunUrls: splitList(env.TOMATO_STUN_URLS ?? 'stun:stun.l.google.com:19302,stun:stun.cloudflare.com:3478'),
      turnUrls: splitList(env.TOMATO_TURN_URLS ?? ''),
      // Вариант 1 (рекомендуется, coturn use-auth-secret): общий секрет → временные логины на час
      turnSecret: env.TOMATO_TURN_SECRET || null,
      // Вариант 2: статичные логин/пароль TURN
      turnUsername: env.TOMATO_TURN_USERNAME || null,
      turnCredential: env.TOMATO_TURN_CREDENTIAL || null,
      turnTtlSec: 3600,
      maxSdpBytes: 32 * 1024,
      signalsPerSec: 200, // кандидаты ICE приходят пачками — отдельный лимит от остальных сообщений
    },

    social: {
      helpDailyLimit: 6,
      boost: { xpBonusPct: 25, ttlMs: 24 * 3600_000 },
      shield: { cost: 10, ttlMs: 3600_000 },
      prank: {
        cooldownMs: 20_000,
        demoCooldownMs: 1_000, // только для демо-комнат: перерыв там длится секунды
        maxPerBreak: 3,
        types: { fog: { durationMs: 15_000 }, sticker: { durationMs: 10_000 } },
      },
    },
  };
  return deepMerge(cfg, overrides);
}

function splitList(value) {
  return String(value).split(',').map((s) => s.trim()).filter(Boolean);
}

function deepMerge(base, extra) {
  for (const [k, v] of Object.entries(extra || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') deepMerge(base[k], v);
    else base[k] = v;
  }
  return base;
}
