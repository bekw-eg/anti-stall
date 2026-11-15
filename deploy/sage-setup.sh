#!/usr/bin/env bash
# Регистрация метрик стенда в Sage (Spirit) — один раз, ручная джоба CI sage:setup (повторный запуск безопасен).
# Sage сам забирает (pull) /api/metrics основного стенда и демо по HTTPS каждые 30 с.
# Документация: sage.spirit.t-education.com/documentation/article/scraping
#   SAGE_TOKEN   — сервисный токен Sage (секрет, CI-переменная Spirit, masked)
#   DEPLOY_HOST  — домен стенда; SAGE_GROUP — группа Sage (по умолчанию hack-nqz-03)
set -uo pipefail
API="${SAGE_API:-https://sage.spirit.t-education.com/mcc/api}"
GROUP="${SAGE_GROUP:-hack-nqz-03}"
SYSTEM=antistall
HOST="${DEPLOY_HOST:?нужен DEPLOY_HOST}"
: "${SAGE_TOKEN:?нужен SAGE_TOKEN — сервисный токен Sage (Spirit → Sage → аватар → «Создать сервисный токен»)}"

call() { # метод путь json — 2xx и 409 (уже есть) считаем успехом
  local code
  code=$(curl -s -o /tmp/sage.out -w '%{http_code}' -X "$1" "$API$2" -H "Authorization: Bearer $SAGE_TOKEN" -H 'Content-Type: application/json' -d "$3")
  case "$code" in 2*) echo "✅ $1 $2";; 409) echo "↺ $1 $2 — уже есть";; *) echo "❌ $1 $2 → $code: $(head -c 400 /tmp/sage.out)"; return 1;; esac
}

ok=0
for env in prod demo; do
  call POST /Environment "{\"envName\":\"$env\",\"groupName\":\"$GROUP\"}" || ok=1
done
call POST /System "{\"systemName\":\"$SYSTEM\",\"groupName\":\"$GROUP\",\"metricsPath\":\"/api/metrics\",\"port\":443,\"scrapeInterval\":30000,\"scrapeTimeout\":20000}" || ok=1

# коллекция на стенд: основной — 443, демо — 8081 (оба HTTPS через Caddy)
for pair in prod:443 demo:8081; do
  env=${pair%%:*}; port=${pair##*:}
  call POST /ScraperTarget/collection "{\"targetCollectionName\":\"${SYSTEM}_${env}\",\"groupName\":\"$GROUP\",\"systemName\":\"$SYSTEM\",\"envName\":\"$env\",\"metricsPath\":\"/api/metrics\",\"params\":{\"format\":\"prometheus\",\"mode\":\"http\"},\"port\":$port,\"scheme\":\"https\",\"enableFullHostName\":true}" || ok=1
  call POST /ScraperTarget "{\"host\":\"$HOST\",\"targetCollectionName\":\"${SYSTEM}_${env}\",\"groupName\":\"$GROUP\",\"systemName\":\"$SYSTEM\",\"envName\":\"$env\",\"dataCenterName\":\"ru-7\",\"clusterName\":\"vm\"}" || ok=1
done

echo
echo "Проверка в Sage → Search:  pql {group=\"$GROUP\", system=\"$SYSTEM\"} | stats count by __name__"
exit $ok
