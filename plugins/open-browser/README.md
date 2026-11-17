# inpx-web plugin: open-browser

Открывает веб-интерфейс `inpx-web` в новом окне браузера при запуске сервера.

## Установка

1. Распаковать ZIP плагина в каталог плагинов inpx-web:
`unzip open-browser.zip -d <dataDir>/plugins/`

2. Создать `config.json` из шаблона:
`cp <dataDir>/plugins/open-browser/config.example.json <dataDir>/plugins/open-browser/config.json`

3. В `config.json` задать `"enabled": true`, при необходимости прописать `browserPath`

4. В основном конфиге inpx-web (<dataDir>/config.json) установить: `"pluginsEnabled": true`

5. Перезапусть inpx-web. В логе должно появиться:
```text
Plugins: open-browser: started (api 1.0, ...)
Plugins: loaded 1 of 1
```

## Настройки

Поле|Обязательно|Описание
-|-|-
`enabled`|да|`true` — плагин запущен; `false` — выключен.
`url`|да|url, который откроется в браузере, по умолчанию `http://127.0.0.1:12380`
`browserPath`|нет|Путь к исполняемому файлу браузера. Если не задан - плагин пытается стартовать браузер по умолчанию
`browserArgs`|нет|Дополнительные аргументы, передаваемые браузеру (по умолчанию передаются параметры для открытия в новом окне)
`delayMs`|нет|Дополнительная задержка перед запуском браузера. По умолчанию `300`мс
`readyTimeoutMs`|нет|Таймаут ожидания загрузки поисковой базы. По умолчанию `90000`мс


## Примеры `browserPath` для разных ОС

* **Windows:**
  * Chrome: `"C:/Program Files/Google/Chrome/Application/chrome.exe"`
  * Firefox: `"C:/Program Files/Mozilla Firefox/firefox.exe"`
* **macOS:**
  * Safari: `"/Applications/Safari.app"`
  * Chrome: `"/Applications/Google Chrome.app"`
  * Firefox: `"/Applications/Firefox.app"`
* **Linux:**
  * Chrome: `"/usr/bin/google-chrome"`
  * Firefox: `"/usr/bin/firefox"`


## Сборка
В корне проекта
`npm run build:plugin -- open-browser`
zip архив с плагином будет по пути `dist/plugins/open-browser.zip`
Для чистой сборки (с принудительным скачиванием всех зависимостей последних доступных версий)
`npm run build:plugin -- open-browser --clean`