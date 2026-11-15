#!/usr/bin/env bash
# Откат на предыдущий образ (джоба rollback:vm или вручную на ВМ из ~/app):
#   bash rollback.sh <SITE_DOMAIN> [ENABLE_HTTPS=1]
# Поднимает образ из previous_image тем же deploy.sh (бэкап БД, health, HTTPS/HTTP) — повторный запуск
# вернёт обратно (deploy.sh меняет current/previous местами). БД не откатывается: миграции только
# добавляют таблицы и колонки, старый код с новой схемой работает. Вернуть данные — docs/DEPLOY.md.
set -euo pipefail
cd "$(dirname "$0")"
DOMAIN="${1:?нужен SITE_DOMAIN (DEPLOY_HOST)}"
[ -s previous_image ] || { echo "Нет ~/app/previous_image — откатываться не на что"; exit 1; }
prev="$(cat previous_image)"
echo "↩️  Откат: $(cat current_image 2>/dev/null || echo '?') → $prev"
bash deploy.sh "$prev" "$DOMAIN" "${2:-1}"
