import { fileURLToPath } from 'node:url';

/**
 * Вся настраиваемая логика проекта. Экономика, лимиты и тайминги живут здесь,
 * а не в коде бизнес-правил — клиент никогда не присылает эти значения.
 */
export function loadConfig(env = process.env, overrides = {}) {
  const demoMode = env.TOMATO_DEMO === '1';
  const cfg = {
    port: Number(env.PORT || 8787),
    host: env.HOST || '0.0.0.0',
    dbPath: env.TOMATO_DB || fileURLToPath(new URL('../data/tomato.db', import.meta.url)),
    corsOrigin: env.TOMATO_CORS_ORIGIN || '*',

    /** Демо-режим для жюри: только по явному флагу сервера, см. docs/DEMO_MODE.md */
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
      dailyRewardedSessions: demoMode ? 500 : 16, // потолок наград за сутки (анти-накрутка)
      challengeReward: { xp: 150, coins: 60 },
      td: { dailyRewardedRounds: demoMode ? 500 : 8, duelReward: { xp: 15, coins: 10 }, firstClearMultiplier: 1.5, minRemainingSec: 6 },
      nodeReward: { xp: 25, coins: 10 }, // за каждый промежуточный этап карты, один раз на участника с вкладом
    },

    social: {
      helpDailyLimit: 6,
      boost: { xpBonusPct: 25, ttlMs: 24 * 3600_000 },
      shield: { cost: 10, ttlMs: 3600_000 },
      prank: {
        cooldownMs: demoMode ? 1_000 : 20_000,
        maxPerBreak: 3,
        types: { fog: { durationMs: 15_000 }, sticker: { durationMs: 10_000 } },
      },
    },
  };
  return deepMerge(cfg, overrides);
}

function deepMerge(base, extra) {
  for (const [k, v] of Object.entries(extra || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') deepMerge(base[k], v);
    else base[k] = v;
  }
  return base;
}
