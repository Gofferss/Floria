#!/bin/bash
# Разовая настройка вебхука Telegram-бота. Запускать один раз после деплоя
# (и повторно — если поменяли домен или TELEGRAM_WEBHOOK_SECRET).
#
# Использование:
#   ./set-webhook.sh https://ваш-домен.ru

set -euo pipefail

DOMAIN="${1:?Укажите домен: ./set-webhook.sh https://ваш-домен.ru}"

# Подтягиваем секреты из .env.local, чтобы не вписывать их руками
source .env.local

curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  --data-urlencode "url=${DOMAIN}/api/telegram/webhook" \
  --data-urlencode "secret_token=${TELEGRAM_WEBHOOK_SECRET}"

echo
echo "Проверка:"
curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo"
echo
