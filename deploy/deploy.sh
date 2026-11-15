#!/usr/bin/env bash
# Деплой на ВМ (запускает джоба deploy:vm из ~/app, куда скопированы docker-compose.yml, Caddyfile и этот скрипт).
#
#   bash deploy.sh <IMAGE_NAME> <SITE_DOMAIN> [ENABLE_HTTPS=1]
#   переменные окружения: APP_PORT (80), DEMO_PORT (8081), CADDY_IMAGE (caddy:2.8.4-alpine)
#
# HTTPS нужен для голоса (браузер даёт микрофон только по HTTPS). Если HTTPS поднять не удалось
# (нет образа caddy, не выдался сертификат, адрес — IP без домена), скрипт возвращает обычный HTTP:
# стенд остаётся рабочим, в логе — предупреждение.
set -euo pipefail
cd "$(dirname "$0")"

IMAGE="${1:?нужен IMAGE_NAME}"
DOMAIN="${2:?нужен SITE_DOMAIN (DEPLOY_HOST)}"
WANT_HTTPS="${3:-1}"
APP_PORT="${APP_PORT:-80}"
DEMO_PORT="${DEMO_PORT:-8081}"
CADDY_IMAGE="${CADDY_IMAGE:-caddy:2.8.4-alpine}"
DC="sudo docker compose"

write_env() {
  write_env_mode "$1"
  # логи в Sage: переменные приходят из CI (SAGE_TOKEN — секрет), файл .env закрыт от чужих глаз
  if [ -n "${SAGE_TOKEN:-}" ] && [ -n "${SAGE_LOGS_URL:-}" ]; then
    { echo "SAGE_LOGS_URL=$SAGE_LOGS_URL"; echo "SAGE_TOKEN=$SAGE_TOKEN"; } >> .env
  fi
  chmod 600 .env
}

write_env_mode() {
  if [ "$1" = https ]; then
    cat > .env <<EOF
IMAGE_NAME=$IMAGE
SITE_DOMAIN=$DOMAIN
CADDY_IMAGE=$CADDY_IMAGE
APP_BIND=127.0.0.1:8080
DEMO_BIND=127.0.0.1:8090
COMPOSE_PROFILES=demo,https
EOF
  else
    cat > .env <<EOF
IMAGE_NAME=$IMAGE
SITE_DOMAIN=$DOMAIN
APP_BIND=$APP_PORT
DEMO_BIND=$DEMO_PORT
COMPOSE_PROFILES=demo
EOF
  fi
}

ok() { curl -fsS --retry "$2" --retry-delay 2 --retry-all-errors -o /dev/null "${@:3}" "$1"; }

start_http() {
  write_env http
  $DC rm -sf caddy >/dev/null 2>&1 || true
  $DC up -d --no-build --remove-orphans
}

# 1. Режим: HTTPS, если просили, адрес — домен (Let's Encrypt не выдаёт сертификаты на IP) и образ caddy скачивается
mode=http
if [ "$WANT_HTTPS" = "1" ]; then
  if ! [[ "$DOMAIN" =~ [a-zA-Z] ]]; then
    echo "⚠️  DEPLOY_HOST=$DOMAIN — это IP, сертификат на него не выдаётся: остаёмся на HTTP"
  elif sudo docker pull -q "$CADDY_IMAGE" >/dev/null 2>&1; then
    mode=https
  else
    echo "⚠️  Не удалось скачать $CADDY_IMAGE на ВМ (нет доступа к Docker Hub?) — остаёмся на HTTP. Можно задать CADDY_IMAGE из доступного registry"
  fi
fi

# 2. Бэкап БД обоих стендов перед обновлением (VACUUM INTO в том же томе, папка /data/backups, 5 последних).
#    Старый образ без инструмента бэкапа — только предупреждение, деплой продолжается.
for svc in app demo; do
  if [ -n "$($DC ps -q --status running "$svc" 2>/dev/null)" ]; then
    $DC exec -T "$svc" node src/tools/db-backup.js || echo "⚠️  Бэкап БД $svc не сделан (старый образ без src/tools/db-backup.js?)"
  fi
done

# 3. Новый образ приложения и запуск
write_env "$mode"
$DC pull app demo
if [ "$mode" = http ]; then start_http; else $DC up -d --no-build --remove-orphans; fi

# 4. Проверка. В HTTPS-режиме — приложение изнутри и затем сертификат снаружи (до ~2 мин на выпуск);
#    если HTTPS не заработал — откат на HTTP, чтобы стенд не пропал
if [ "$mode" = https ]; then
  if ok http://127.0.0.1:8080/api/health 30 && ok http://127.0.0.1:8090/api/health 30 \
     && ok "https://$DOMAIN/api/health" 60 --resolve "$DOMAIN:443:127.0.0.1" \
     && ok "https://$DOMAIN:8081/api/health" 20 --resolve "$DOMAIN:8081:127.0.0.1"; then
    :
  else
    echo "⚠️  HTTPS не поднялся (сертификат не выдан или caddy не стартовал). Логи: cd ~/app && sudo docker compose logs caddy"
    $DC logs --tail 30 caddy || true
    echo "↩️  Возвращаемся на HTTP"
    mode=http
    start_http
  fi
fi
if [ "$mode" = http ]; then
  ok "http://127.0.0.1:$APP_PORT/api/health" 30
  ok "http://127.0.0.1:$DEMO_PORT/api/health" 30
fi

# Проверка БД после обновления (целостность, балансы = журналу наград, дубли начислений) — предупреждение, не откат
for svc in app demo; do
  if [ -n "$($DC ps -q --status running "$svc" 2>/dev/null)" ]; then
    $DC exec -T "$svc" node src/tools/db-check.js >/dev/null && echo "✅ БД $svc в порядке" || echo "⚠️  db-check $svc нашёл нарушения: cd ~/app && sudo docker compose exec -T $svc node src/tools/db-check.js"
  fi
done

# 5. Для отката: прошлый и текущий образ
[ -f current_image ] && cp current_image previous_image || true
echo "$IMAGE" > current_image

if [ "$mode" = https ]; then
  echo "🎉 HTTPS: основной стенд https://$DOMAIN · демо для жюри https://$DOMAIN:8081 (голос работает)"
else
  echo "🎉 HTTP: основной стенд http://$DOMAIN:$APP_PORT · демо http://$DOMAIN:$DEMO_PORT (голос недоступен без HTTPS)"
fi
