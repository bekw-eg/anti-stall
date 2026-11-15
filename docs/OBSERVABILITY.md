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

## Sage (Spirit): логи, метрики, Grafana, алерты

Группа Sage — `hack-nqz-03` (квоты: логи 0,1 МБ/с, метрики 100 000, хранение 14 дней). Grafana Sage — организация `hack-nqz-03`.

**Что нужно один раз:**
1. Sage → аватар → «Создать сервисный токен»: идентификатор клиента `hack_antistall`, группа `hack-nqz-03`, права на загрузку логов и метрики.
2. Spirit → CI/CD-переменные проекта: `SAGE_TOKEN` = этот токен (masked, protected). `SAGE_LOGS_URL` уже задан в `.gitlab-ci.yml`.
3. Пайплайн master → ручная джоба **`sage:setup`**: создаёт в Sage окружения `prod`/`demo`, систему `antistall` и таргеты —
   Sage сам забирает `https://<домен>/api/metrics` и `https://<домен>:8081/api/metrics` каждые 30 с.
4. Ближайший деплой передаёт `SAGE_TOKEN` в контейнеры — логи (JSON, `system=antistall`, `env=prod|demo`) начинают уходить в Sage.

**Проверка в Sage → Search:**
- метрики: `pql {group="hack-nqz-03", system="antistall"} | stats count by __name__`
- логи: `group="hack-nqz-03" system="antistall" env="prod" level="error"`

**Дашборд** «AntiStall — стенд» (Grafana Sage, `uid: antistall-stand`; копия — `deploy/grafana/antistall-dashboard.json`):
up, онлайн, комнаты в фокусе / на перерыве, доля 5xx, версия схемы, RPS по маршрутам, p95, ошибки по источнику,
коды ответов, сессии, пользователи, награды, память, таблица ошибок из логов. Переключатель стенда `prod` / `demo`.

**Алерты** (Sage → Alerts, тип MageQL): стенд не отвечает — `pql max(up{group="hack-nqz-03", system="antistall", env="prod"}) < 1`;
много 5xx — доля 5xx > 0.05; ошибки таймера — `pql sum(increase(antistall_errors_total{group="hack-nqz-03", system="antistall", source="tick"}[5m])) > 0`.
