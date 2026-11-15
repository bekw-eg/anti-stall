/**
 * Отправка логов в Sage (Spirit) — Logs Collector: POST <SAGE_LOGS_URL> с телом «одна JSON-строка = одно событие»,
 * заголовок Authorization: JWT <SAGE_TOKEN>. Документация: sage.spirit.t-education.com/documentation/article/loading_collector
 *
 * Включается переменными SAGE_LOGS_URL (например https://sage.spirit.t-education.com/api/hack-nqz-03/multiline/)
 * и SAGE_TOKEN (сервисный токен Sage, секрет — только в CI-переменных Spirit). Без них — ничего не делает.
 * Никогда не мешает работе сервера: пачки по таймеру, ограниченный буфер, ошибки сети и 429 — пропуск пачки.
 */
export function createSageShipper({ url, token, labels = {}, flushMs = 2000, maxBatch = 200, maxBuffer = 5000, fetchImpl = globalThis.fetch } = {}) {
  if (!url || !token) return null;
  let buf = [];
  let dropped = 0;
  let sending = false;
  let pauseUntil = 0;

  async function flush() {
    if (sending || !buf.length || Date.now() < pauseUntil) return;
    sending = true;
    const batch = buf.splice(0, maxBatch);
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { Authorization: `JWT ${token}`, 'Content-Type': 'application/x-ndjson' },
        body: batch.map((e) => JSON.stringify(e)).join('\n'),
        signal: AbortSignal.timeout(5000),
      });
      if (res.status === 429) {
        // квота группы: ждём, сколько просит Sage, пачку не повторяем (логи не важнее работы сервера)
        const wait = Number(res.headers.get('wait-ms')) || Number(res.headers.get('retry-after')) * 1000 || 5000;
        pauseUntil = Date.now() + wait;
        dropped += batch.length;
      } else if (!res.ok) dropped += batch.length;
    } catch {
      dropped += batch.length;
    } finally {
      sending = false;
    }
  }

  const timer = setInterval(() => { flush(); }, flushMs);
  timer.unref?.();

  return {
    /** Событие лога (объект, как пишет createLogger) + постоянные метки: system, env. */
    push(event) {
      if (buf.length >= maxBuffer) { dropped += 1; return; }
      buf.push({ ...labels, ...event });
      if (buf.length >= maxBatch) flush();
    },
    stats: () => ({ queued: buf.length, dropped }),
    async close() { clearInterval(timer); await flush(); },
  };
}
