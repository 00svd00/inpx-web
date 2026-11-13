# inpx-web plugin: telegram-bot

Telegram-бот для inpx-web: OPDS-like поиск и навигация по каталогу.

## Возможности

- `/start` — меню (Поиск / Авторы / Серии / Жанры / Помощь).
- Свободный текст → «Что искать?» (название / автор / серия / жанр) → результаты.
- Пагинация — `editMessageText` (одно сообщение, без спама).
- Карточка книги: скачать (URL на `getBookLink().link`), рецензии, био/фото авторов, переход к автору/серии.
- Доступ: `accessPassword` (через `/start <пароль>`) или `allowedUsers` (whitelist chatId/username). Без них — **не стартует** (публичный бот опасен).

## Включение

1. Распаковать в `<dataDir>/plugins/`:
`unzip dist/plugins/telegram-bot.zip -d <dataDir>/plugins/`

2. Создать `config.json` из `config.example.json`:
`cp <dataDir>/plugins/telegram-bot/config.example.json <dataDir>/plugins/telegram-bot/config.json`

3. Заполнить `config.json`:
- `token` — токен бота (BotFather);
- `accessPassword` **или** `allowedUsers` — обязательно (иначе не стартует);
- `publicUrl` — базовый URL сервера (для абсолютных ссылок «Скачать»), например `https://inpx.example.com`;
- `maxResults` — размер страницы (default 10);
- `enabled: true`.
4. В конфиге ядра (`<dataDir>/config.json`): `"pluginsEnabled": true`.
5. Перезапустить сервер. В логе: `Plugins: telegram-bot: started (api 1.0, ...)`.

## Сборка
`npm run build:plugin -- telegram-bot`


→ `dist/plugins/telegram-bot.zip` (с `node_modules` внутри; `config.json` **не** входит — только `config.example.json`).

## Команды

| Команда | Действие |
|---|---|
| `/start [password]` | меню / авторизация |
| `/search` | подсказка «напишите текст» |
| `/book <uid>` | не поддерживается в v1.0 (используйте кнопки в результатах) |
| `/help` | справка |

## Ограничения (Telegram)

- `callback_data` ≤ 64 байт — состояние сессии хранится в памяти по `chatId`.
- Inline-кнопки живут 48 часов; при истечении — новое сообщение.
- Нет множественных фильтров (жанр+язык+дата) — только одна ось на запрос.
- URL-кнопка требует абсолютный URL — `publicUrl` обязателен для ссылок «Скачать»/«Фото»; иначе показывается текстом.
- `sendFiles: false` по умолчанию (ссылка, не `sendDocument`).

## Контракт

Использует `PluginApi` 1.0: `waitReady`, `bookSearch`, `search`, `getBookInfo`, `getBookLink`, `getBookReviewsCount`, `getReviewLink`, `getBookAuthors`, `getAuthorBio`, `getPhotoLink`, `getAuthorPhotoMime`, `log`. См. `plugins/example/README.md`.

## Ошибки и изоляция

Плагин использует `api.guard(name, fn)` для **всех** async-обработчиков
(`bot.on`, `bot.onText`). `api.guard` ловит любую ошибку, логирует `LM_ERR`
и **не** пробрасывает — плагин не роняет ядро.

Дополнительно `PluginManager` вешает `process.on('unhandledRejection')`
с фильтром по `pluginsDir`: любой unhandled rejection, чей стек указывает
на плагин, логируется и поглощается. «Чужие» rejection тоже логируются
(поведение ядра: явные `exit` — через `asyncExit`).

Telegram-ошибки, которые **не** являются ошибками, обрабатываются отдельно:
- `400 message is not modified` — тот же текст/клавиатура (нажали «Меню», уже в меню);
- `400 message is too long` — текст > 4096 символов;
- `400 query is too old` — callback > 48 часов;
- `400 BUTTON_DATA_INVALID` — `callback_data` > 64 байт.

Все они перехватываются `safeEdit` / `isTelegramBenign` и игнорируются.

## Ограничения

- `callback_data` ≤ 64 байт — состояние сессии в памяти по `chatId`.
- Inline-кнопки живут 48 часов; при истечении — новое сообщение.
- Нет множественных фильтров (жанр+язык+дата) — только одна ось на запрос.
- URL-кнопка требует абсолютный URL — `publicUrl` обязателен для ссылок «Скачать»/«Фото»; иначе показывается текстом.
- `sendFiles: false` по умолчанию (ссылка, не `sendDocument`).