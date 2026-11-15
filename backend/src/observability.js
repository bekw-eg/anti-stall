/**
 * Наблюдаемость без внешних зависимостей:
 *  - log(level, msg, fields) — одна JSON-строка на событие (удобно собирать Loki / `docker compose logs | jq`);
 *  - метрики в формате Prometheus (text exposition 0.0.4) — отдаются на GET /api/metrics.
 * Счётчики живут в памяти процесса и сбрасываются при рестарте (Prometheus это понимает через rate()).
 * Метрики «из БД» (комнаты, сессии, награды, пользователи) считаются в момент запроса — переживают рестарт.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

/** sink — дополнительный приёмник событий (отправка в Sage); stdout пишется всегда, когда enabled. */
export function createLogger({ enabled = true, minLevel = 'info', out = process.stdout, err = process.stderr, sink = null } = {}) {
  const min = LEVELS[minLevel] ?? LEVELS.info;
  return function log(level, msg, fields = {}) {
    if (!enabled || (LEVELS[level] ?? 0) < min) return;
    const event = { t: new Date().toISOString(), level, msg, ...fields };
    (level === 'error' || level === 'warn' ? err : out).write(JSON.stringify(event) + '\n');
    sink?.push(event);
  };
}

const esc = (v) => String(v).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
const labelsKey = (labels) => Object.keys(labels).sort().map((k) => `${k}="${esc(labels[k])}"`).join(',');

export function createMetrics() {
  const families = new Map(); // name → { type, help, series: Map(key → value | histogram) }
  const family = (name, type, help) => {
    if (!families.has(name)) families.set(name, { type, help, series: new Map() });
    return families.get(name);
  };

  function counter(name, help) {
    const f = family(name, 'counter', help);
    return {
      inc(labels = {}, by = 1) {
        const k = labelsKey(labels);
        f.series.set(k, (f.series.get(k) ?? 0) + by);
      },
    };
  }

  function histogram(name, help, buckets) {
    const f = family(name, 'histogram', help);
    f.buckets = buckets;
    return {
      observe(labels, value) {
        const k = labelsKey(labels);
        let h = f.series.get(k);
        if (!h) { h = { counts: buckets.map(() => 0), sum: 0, count: 0 }; f.series.set(k, h); }
        buckets.forEach((b, i) => { if (value <= b) h.counts[i] += 1; });
        h.sum += value;
        h.count += 1;
      },
      buckets,
    };
  }

  /** gauges — функция, вызываемая при выдаче: [{ name, help, values: [{ labels, value }] }] */
  function render(gauges = []) {
    const out = [];
    for (const [name, f] of families) {
      out.push(`# HELP ${name} ${f.help}`, `# TYPE ${name} ${f.type}`);
      for (const [k, v] of f.series) {
        if (f.type === 'histogram') {
          const sep = k ? `${k},` : '';
          f.buckets.forEach((b, i) => out.push(`${name}_bucket{${sep}le="${b}"} ${v.counts[i]}`));
          out.push(`${name}_bucket{${sep}le="+Inf"} ${v.count}`, `${name}_sum${k ? `{${k}}` : ''} ${v.sum}`, `${name}_count${k ? `{${k}}` : ''} ${v.count}`);
        } else {
          out.push(`${name}${k ? `{${k}}` : ''} ${v}`);
        }
      }
    }
    for (const g of gauges) {
      out.push(`# HELP ${g.name} ${g.help}`, `# TYPE ${g.name} gauge`);
      for (const { labels = {}, value } of g.values) {
        const k = labelsKey(labels);
        out.push(`${g.name}${k ? `{${k}}` : ''} ${value}`);
      }
    }
    return out.join('\n') + '\n';
  }

  return { counter, histogram, render };
}

/** Шаблон маршрута для метки (а не сырой путь): /api/rooms/:id/join, иначе кардинальность метрик взорвётся. */
export const routeLabel = (route, pathname) => route?.pattern ?? (pathname.startsWith('/api') ? 'unmatched' : 'static');
