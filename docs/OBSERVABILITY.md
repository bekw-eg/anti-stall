# Наблюдаемость AntiStall

Что отдаёт сервер, чтобы команда подключила Grafana, сбор логов и алерты (их настраиваем вручную через Spirit).

## Эндпоинты

| Путь | Что |
|---|---|
| `GET /api/health` | `status`, `schemaVersion` (миграция БД), `uptimeSec`, `demoMode`; заодно проверяет, что БД отвечает |
| `GET /api/metrics` | метрики в формате Prometheus. Если задан `TOMATO_METRICS_TOKEN` — нужен `Authorization: Bearer <токен>` |
| `POST /api/client-errors` | приём ошибок из браузера (фронтенд шлёт сам), не больше 20 в минуту с адреса |

Каждый ответ содержит заголовок `X-Request-Id` — тот же id в логе запроса и в тексте ошибки 500 (`error.requestId`): по нему жалоба пользователя находится в логах за секунды.

## Метрики

| Метрика | Тип | Метки |
|---|---|---|
| `antistall_http_requests_total` | counter | `method`, `route` (шаблон: `/api/rooms/:id`), `status` |
| `antistall_http_request_duration_seconds` | histogram | `route` |
| `antistall_errors_total` | counter | `source`: `http` (500), `tick` (таймер комнат), `harvest`, `client` (браузер) |
| `antistall_ws_connections` | gauge | — |
| `antistall_rooms` | gauge | `phase`: waiting / focus / break / completed |
| `antistall_focus_sessions` | gauge | `status`: active / completed / aborted / abandoned |
| `antistall_reward_transactions` | gauge | `kind` (focus_session, harvest_round, td_round, …) |
| `antistall_users` | gauge | `type`: guest / registered |
| `antistall_schema_version`, `process_uptime_seconds`, `process_resident_memory_bytes`, `nodejs_heap_used_bytes` | gauge | — |

Счётчики — в памяти процесса (после рестарта с нуля; `rate()` в Prometheus это учитывает). Gauge «из БД» считаются при запросе и переживают рестарт.

## Готовые запросы (PromQL) для дашборда

- RPS по маршрутам: `sum by (route) (rate(antistall_http_requests_total[5m]))`
- Доля 5xx: `sum(rate(antistall_http_requests_total{status=~"5.."}[5m])) / sum(rate(antistall_http_requests_total[5m]))`
- p95 ответа: `histogram_quantile(0.95, sum by (le) (rate(antistall_http_request_duration_seconds_bucket[5m])))`
- Ошибки по источнику: `sum by (source) (increase(antistall_errors_total[15m]))`
- Онлайн: `antistall_ws_connections`; комнаты в фокусе: `antistall_rooms{phase="focus"}`
- Завершённые фокусы за час: `delta(antistall_focus_sessions{status="completed"}[1h])`

## Алерты (предложение)

| Алерт | Условие |
|---|---|
| Стенд не отвечает | `up == 0` 2 мин, или `/api/health` ≠ 200 |
| Много 5xx | доля 5xx > 5% за 5 мин |
| Ошибки таймера | `increase(antistall_errors_total{source="tick"}[5m]) > 0` |
| Всплеск ошибок в браузере | `increase(antistall_errors_total{source="client"}[10m]) > 20` |
| Перезапуски | `process_uptime_seconds < 120` дважды за 30 мин |
| Проверка БД | строка `db-check … нашёл нарушения` в логе деплоя |

## Логи

Одна JSON-строка на событие, stdout (ошибки — stderr): `docker compose logs app`. Поля: `t`, `level`, `msg` + данные.

- `http` — `reqId`, `method`, `route`, `path`, `status`, `ms`, `userId` (успешные heartbeat не пишутся);
- `ws_open` / `ws_close` — `conn`, `userId`, `conns`;
- `http_error` / `tick_error` / `harvest_error` — `error`, `stack`, `reqId` или `roomId`;
- `client_error` — `kind`, `message`, `stack`, `page`, `ua`.

Выключить логи запросов: `TOMATO_REQUEST_LOG=0` (ошибки пишутся всегда). Пример разбора: `sudo docker compose logs app --no-log-prefix | grep '^{' | jq 'select(.level=="error")'`.
