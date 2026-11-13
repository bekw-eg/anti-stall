# Сквозные проверки в настоящем Chrome

Отдельный пакет (только `playwright-core`, браузер не скачивается — берётся установленный Google Chrome),
поэтому сборка `frontend/` от него не зависит. Скрипты сами поднимают backend (демо-режим, временная БД)
и Vite dev-сервер с прокси, открывают несколько независимых профилей браузера и проходят сценарии через интерфейс.

```bash
cd backend && npm ci && cd ../frontend && npm ci && cd ../e2e && npm ci
npm run voice     # голос: 4 участника + слушатель без микрофона
npm run social    # помощь, шутки, лента, статистика, присутствие
HEADED=1 npm run voice   # смотреть глазами
CHROME_PATH=/path/to/chrome npm test   # если Chrome стоит не в стандартном месте
```

Микрофон — встроенное тестовое устройство Chrome (`--use-fake-device-for-media-stream`): подменяется только источник
звука, а WebRTC, ICE, DTLS, Opus и WebAudio работают по-настоящему. Скриншоты — в `e2e/artifacts/`.
