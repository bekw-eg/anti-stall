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
    /**
     * Какая игра на перерыве: 'alternate' — после нечётного цикла Tower Defense, после чётного Harvest;
     * 'td' / 'harvest' — всегда одна игра (удобно для показа и тестов). Переменная TOMATO_BREAK_GAMES.
     */
    breakGames: ['td', 'harvest', 'alternate'].includes(env.TOMATO_BREAK_GAMES) ? env.TOMATO_BREAK_GAMES : 'alternate',
    harvestFrameMs: 100, //   как часто в комнату уходит кадр Harvest (корзины, счёт)
    friends: { maxFriends: 200, requestsPerDay: 30, inviteCooldownMs: 60_000 },
    // перенос аккаунта на другое устройство: одноразовый код живёт 10 минут
    transfer: { codeTtlMs: 10 * 60_000 },
    // вход по логину и паролю: после 10 неудачных попыток логин блокируется на 15 минут
    auth: { maxFailures: 10, lockMs: 15 * 60_000 },
    broadcastTickMs: 1000, //  как часто в комнату уходит timer_tick (для сверки часов)
    wsPingMs: 5000,

    limits: {
      userNameMax: 24,
      roomNameMax: 40,
      taskMax: 80,
      maxMembers: 12,
      maxRoomsPerUser: 5,
      // Длительности вводит пользователь (секунды); сервер проверяет только границы.
      // Условные рамки концепта: фокус от 1 мин до 24 ч, перерыв от 10 с до 2 ч.
      focusSeconds: [60, 24 * 3600],
      breakSeconds: [10, 2 * 3600],
      cycles: [1, 12], // сколько циклов «фокус → перерыв» запланировано: столько остановок на карте
      demoFocusSeconds: [5, 600],
      demoBreakSeconds: [10, 300],
    },

    economy: {
      standardFocusMinutes: 25,
      xpPerSession: 100,
      coinsPerSession: 20,
      teamPointsPerSession: 1,
      minRewardFactor: 0, // награда линейно зависит от длины сессии: короткие фокусы не фармятся
      maxRewardFactor: 4, // выше 100 минут награда за одну сессию не растёт
      // Качество фокуса = доля времени, когда участник был во вкладке и в сети (считает сервер).
      // Награда умножается на качество; команда продвигается по карте, только если хотя бы половина
      // её участников цикла отфокусировалась с качеством не ниже teamMin.
      quality: { teamMin: 0.6 },
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
      harvest: {
        roundSec: 60, countdownSec: 3, minRoundSec: 8,
        resultsSec: 6, // после раунда остаётся время посмотреть итоги до конца перерыва
        minBreakSec: 30, // перерыв с Harvest не короче (демо-перерыв 15 с — раунд бы не поместился)
        settleSec: 2.5, // через сколько после падения пропуск окончателен (запоздалая заявка о поимке ещё принимается)
        lateSec: 2, earlySec: 0.35, // окно заявки «поймал» вокруг момента пересечения края корзины (задержка сети)
        reward: { base: 10, perPoint: 2, maxPointsXp: 30, win: 15 }, // только опыт: монеты не начисляются
        dailyRewardedRounds: 8, demoDailyRewardedRounds: 500,
      },
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

    // Текстовый чат комнаты: в фокусе только чтение, антиспам и предел длины
    chat: { maxLength: 300, minIntervalMs: 1000, perMinute: 20, historyLimit: 50 },

    social: {
      helpDailyLimit: 6,
      boost: { xpBonusPct: 25, ttlMs: 24 * 3600_000 },
      shield: { cost: 10, ttlMs: 3600_000 },
      prank: {
        cooldownMs: 20_000,
        demoCooldownMs: 1_000, // только для демо-комнат: перерыв там длится секунды
        maxPerBreak: 3,
        // Шутки = дебаффы команде соперника в Tower Defense (только на перерыве, отключить нельзя):
        // fog — «Туман»: дальность башен соперника ниже; sticker — «Липучка»: башни соперника стреляют реже.
        types: {
          fog: { durationMs: 15_000, debuff: { rangeMult: 0.6 } },
          sticker: { durationMs: 10_000, debuff: { cooldownMult: 2 } },
        },
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
