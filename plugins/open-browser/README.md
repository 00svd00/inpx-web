# inpx-web plugin: open-browser

Автоматически открывает веб-интерфейс `inpx-web` в новом окне браузера после запуска сервера и загрузки поисковой базы.

## Установка и запуск

1. Распаковать архив с плагином в каталог плагинов `<dataDir>/plugins/`:
   ```bash
   unzip open-browser.zip -d <dataDir>/plugins/
   ```

2. Создать рабочий конфиг из шаблона:
   ```bash
   cp <dataDir>/plugins/open-browser/config.example.json <dataDir>/plugins/open-browser/config.json
   ```

3. В `config.json` плагина включить его (и при необходимости указать путь к нужному браузеру в `browserPath`):
   ```json
   "enabled": true
   ```

4. В основном конфиге ядра (`<dataDir>/config.json`) разрешить загрузку плагинов:
   ```json
   "pluginsEnabled": true
   ```

5. Перезапустить сервер. В логе должны появиться записи:
   ```text
   Plugins: open-browser: started (api 1.0, ...)
   Plugins: loaded 1 of 1
   ```

## Настройки (`config.json`)

| Поле | Обязательно | Описание |
|---|---|---|
| `enabled` | да | `true` — плагин активен; `false` — выключен. |
| `url` | нет | Адрес, который откроется в браузере. По умолчанию `http://127.0.0.1:12380`. |
| `browserPath` | нет | Путь к исполняемому файлу или приложению браузера. Если оставить пустым, используется системный браузер по умолчанию. |
| `browserArgs` | нет | Дополнительные аргументы запуска браузера (флаг нового окна добавляется автоматически). |
| `delayMs` | нет | Задержка перед открытием браузера после готовности базы, в миллисекундах. По умолчанию `300`. |
| `readyTimeoutMs` | нет | Максимальное время ожидания загрузки базы, в миллисекундах. По умолчанию `90000`. |

### Примеры `browserPath` для разных ОС

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

Из корня репозитория:
```bash
npm run build:plugin -- open-browser
```
Готовый архив появится по пути `dist/plugins/open-browser.zip`. Для полной пересборки со свежими зависимостями:
```bash
npm run build:plugin -- open-browser --clean
```
