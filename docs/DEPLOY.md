# Деплой AntiStall на ВМ через Spirit CI

Пайплайн (`.gitlab-ci.yml`) собирает **единый образ** (корневой `Dockerfile`: backend раздаёт собранный frontend,
REST `/api` и WebSocket `/ws` на одном порту) и поднимает на ВМ два стенда из `deploy/docker-compose.yml`:

| Стенд | Адрес (HTTPS) | Адрес, если HTTPS не поднялся | Что это | База |
|---|---|---|---|---|
| `app` | `https://<DEPLOY_HOST>` | `http://<DEPLOY_HOST>:80` | обычный режим | том `tomato-data` |
| `demo` | `https://<DEPLOY_HOST>:8081` | `http://<DEPLOY_HOST>:8081` | демо для жюри: ускоренное время, только песочные аккаунты | том `tomato-demo-data` |

**HTTPS** нужен для голоса: браузер даёт микрофон только по HTTPS. Перед стендами стоит **Caddy** (`deploy/Caddyfile`):
он сам получает и продлевает сертификат Let's Encrypt для `DEPLOY_HOST`, держит порты 80 (проверка домена + редирект),
443 и 8081 (демо по HTTPS; 8443 на ВМ закрыт файрволом). Приложения в этом режиме слушают только localhost.
Логику выбирает `deploy/deploy.sh`: если HTTPS поднять не удалось (адрес — IP, нет образа caddy, сертификат не выдан),
стенды возвращаются на обычный HTTP и деплой не падает — в логе джобы будет предупреждение.

Сборка идёт в каждом MR и в master; деплой (`setup:vm` → `deploy:vm`) — **только из master**.

## 1. CI-переменные в Spirit

Код → Репозитории → antistall → вкладка «CI-переменные». Переменная репозитория важнее значения в `.gitlab-ci.yml`.

| Переменная | Обязательна | Тип | Что вписать |
|---|---|---|---|
| `DEPLOY_HOST` | да | переменная | публичный IP или адрес ВМ |
| `DEPLOY_USER` | нет (по умолчанию `root`) | переменная | пользователь на ВМ с правом `sudo` |
| `DEPLOY_KEY` | да | **файл**, секрет (masked/protected) | приватный SSH-ключ к ВМ целиком (`-----BEGIN … KEY-----` … `-----END … KEY-----`) |
| `SPIRIT_DOCKER_SA_KEY` | да | **файл**, секрет | ключ сервис-аккаунта Spirit для registry (тот же, что для сборки, если он уже задан — не трогать) |
| `NODE_IMAGE` | нет | переменная | только если сборка падает на скачивании `node:22-bookworm-slim` (нет доступа к Docker Hub): node-образ ≥ 22.13 из внутреннего registry |
| `APP_PORT` / `DEMO_PORT` | нет | переменная | порты в режиме HTTP, если 80/8081 заняты |
| `ENABLE_HTTPS` | нет | переменная | `0` — не поднимать HTTPS (по умолчанию `1`) |
| `CADDY_IMAGE` | нет | переменная | образ Caddy, если Docker Hub с ВМ недоступен (по умолчанию `caddy:2.8.4-alpine`) |

Важно: `DEPLOY_KEY` и `SPIRIT_DOCKER_SA_KEY` должны быть типа **«Файл»** — пайплайн передаёт их в `ssh -i` и `dp auth`
как путь к файлу. Если ключ задан как обычная переменная, джоба остановится с понятной ошибкой.
Если переменные protected — ветка master должна быть защищённой (иначе в пайплайн они не попадут).

## 2. Требования к ВМ

- Linux с Docker и плагином `docker compose` (v2), `curl`, доступ по SSH по ключу из `DEPLOY_KEY`.
- Пользователь `DEPLOY_USER` может выполнять `sudo` без пароля.
- Открыты входящие порты 80, 443 и 8081 (для HTTPS) — на текущей ВМ так и есть; `DEPLOY_HOST` — доменное имя (сертификат на IP не выдаётся).
- Spirit CLI (`dp`) ставится автоматически джобой `setup:vm`.

## 3. Запуск

1. Задать переменные (раздел 1).
2. Влить изменения в master — пайплайн сам соберёт образ и задеплоит. Либо в Spirit перезапустить пайплайн master.
3. Джоба `deploy:vm` в конце проверяет `/api/health` обоих стендов (в HTTPS-режиме — и сертификат) и пишет адреса:
   `https://<DEPLOY_HOST>` и `https://<DEPLOY_HOST>:8081` (или `http://…`, если пришлось остаться на HTTP).

## 4. Данные, обновление, откат

- Прогресс игроков хранится в томах `tomato-data` и `tomato-demo-data` и **переживает** обновление образа.
- Миграции БД аддитивные и выполняются сами при старте (`backend/src/db.js`); старые данные не удаляются.
- Образы тегируются коротким SHA коммита. На ВМ в `~/app/current_image` — текущий образ, в `~/app/previous_image` — предыдущий.

Откат на прошлую версию (на ВМ):

```bash
cd ~/app
sed -i "s|^IMAGE_NAME=.*|IMAGE_NAME=$(cat previous_image)|" .env
sudo docker compose up -d --no-build   # профили (demo, https) берутся из ~/app/.env
```

Или в Spirit перезапустить джобу `deploy:vm` у пайплайна нужного (старого) коммита master.

Бэкап базы перед рискованным обновлением:

```bash
sudo docker run --rm -v app_tomato-data:/data -v "$PWD":/backup alpine tar czf /backup/tomato-data-$(date +%F-%H%M).tgz -C /data .
```

(имя тома смотрите в `sudo docker volume ls`; обычно `app_tomato-data`).

## 5. Диагностика

```bash
cd ~/app
sudo docker compose ps
sudo docker compose logs --tail 100 app demo caddy
curl -s localhost/api/health; curl -s localhost:8081/api/health
```

Частые причины ошибок:
- сборка: `failed to get … node:22-bookworm-slim` → нет Docker Hub, задать `NODE_IMAGE`;
- `setup:vm`/`deploy:vm`: `Permission denied (publickey)` → неверный `DEPLOY_KEY` или `DEPLOY_USER`;
- `docker compose pull` → 401: `SPIRIT_DOCKER_SA_KEY` не задан или не того типа;
- health не отвечает → `docker compose logs`, обычно занят порт.
