# Telegram-бот для inpx-web

Плагин для inpx-web: поиск книг в библиотеке и отправка файлов книг прямо в чат Telegram.
Работает через Telegram-бота (Bot API). Предоставляет в чате минимальный (OPDS-like) способ поиска и скачивания книг

## Установка

1. Распаковать ZIP плагина в каталог плагинов inpx-web:
`unzip telegram-bot.zip -d <dataDir>/plugins/`

2. Создать `config.json` из шаблона:
`cp <dataDir>/plugins/telegram-bot/config.example.json <dataDir>/plugins/telegram-bot/config.json`

3. В `config.json`  задать `"enabled": true`, если нужна парольная аутентификация - задать пароль в `accessPassword`, если не нужна - просто заполнить в `allowedUsers` логины доверенных пользователей
```json
{
    "enabled": true,
    "token": "<токен от @BotFather>",
    "accessPassword": "<пароль>",
    "allowedUsers": ["trusted_user1","trusted_user2",123456789],
    "sessionTtlMinutes": 5,
    "cleanIntervalMinutes": 5,
    "maxResults": 10
}
```
4. В основном конфиге inpx-web (<dataDir>/config.json) установить:
```"pluginsEnabled": true```

5. Перезапусть inpx-web. В логе должно появиться:
```text
Plugins: telegram-bot: started (api 1.0, ...)
Plugins: loaded 1 of 1
```


## Настройки

`config.json` плагина (в `<dataDir>/plugins/telegram-bot/`):
Поле|Обязательно|Описание
-|-|-
`enabled`|да|`true` — плагин запущен; `false` — выключен.
`token`|да|Токен бота от @BotFather.
`accessPassword`|нет|Пароль для доступа к боту.
`allowedUsers`|нет|Список username (без `@`) или chatId, которым разрешён доступ без пароля.
`sessionTtlMinutes`|нет|Время жизни сессии в минутах(по умолчанию 5)
`cleanIntervalMinutes`|нет|Интервал очистки истёкших сессий
`maxResults`|нет|Сколько элементов на страницу (1–90, по умолчанию 10).

Либо `accessPassword` либо `allowedUsers` должны быть заданы.


## Авторизация

### Режим `allowedUsers` (без пароля)

Доступ имеют только пользователи из `allowedUsers` (массив username (без `@`) и/или chatId)


### Режим `accessPassword` (с паролем)

Пользователь отправляет `/start <пароль>` (или просто пароль после запроса бота). Если пароль верный - `chatId` сохраняется в `<dataDir>/plugins/telegram-bot/authorizedUsers.json` (после чего пользователь становится авторизованным)
После 4 или более неудачных попыток авторизации — блокировка до истечения сессии, по умолчанию 5-10 минут без активности в чате (`sessionTtlMinutes` + `cleanIntervalMinutes`).

`allowedUsers` — приоритет (доступ без пароля). Остальные — по паролю (`accessPassword`).

## Особенности работы
Время жизни сессии 5-10 минут(5 минут + проверки раз в 5 минут) неактивности. Если после истечения сессии пользователь вернётся к старому поиску - получит предупреждение, что автор/серия/книга устарели - начните поиск заново.
Если книга весит больше 50Мб - скачать её не получится(ограничение Telegram).
Плагин поддерживает поисковые префиксы аналогично базовому inpx-web (подробности в `/help` бота)

## Сборка
В корне проекта
`npm run build:plugin -- telegram-bot`
zip архив с плагином будет по пути `dist/plugins/telegram-bot.zip`
Для чистой сборки (с принудительным скачиванием всех зависимостей последних доступных версий)
`npm run build:plugin -- telegram-bot --clean`