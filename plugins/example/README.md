# inpx-web plugin: example

Эталонный плагин для `inpx-web`. Показывает минимальную структуру плагина без внешних зависимостей (`node_modules` не нужен) и на примерах разбирает контракт `PluginApi` (`api.version = '1.0'`):

* **Точки расширения:** HTTP-роуты, мутаторы OPDS-ленты, дополнительные ссылки у книг в OPDS и веб-интерфейсе.
* **Работа с API ядра:** ожидание готовности базы, поиск книг и авторов, получение метаданных, файлов книг, отзывов и биографий.

## Структура
```text
plugins/example/
├── package.json        # метаданные плагина (без dependencies)
├── config.example.json # шаблон настроек
├── index.js            # код плагина: start(api, config) и stop()
└── README.md           # эта справка
```

## Установка и запуск

1. Распаковать архив с плагином в каталог плагинов `<dataDir>/plugins/`:
   ```bash
   unzip dist/plugins/example.zip -d <dataDir>/plugins/
   ```
   *(либо просто скопировать туда папку `plugins/example`)*

2. Создать рабочий конфиг из шаблона:
   ```bash
   cp <dataDir>/plugins/example/config.example.json <dataDir>/plugins/example/config.json
   ```

3. В `config.json` плагина включить его:
   ```json
   "enabled": true
   ```

4. В основном конфиге ядра (`<dataDir>/config.json`) разрешить загрузку плагинов:
   ```json
   "pluginsEnabled": true
   ```

5. Перезапустить сервер. Если всё прошло успешно, в логе появятся строки:
   ```text
   [example] core: inpx-web v1.6.5 (production), dbVersion=14
   ...
   [example] started
   2026-11-12 15:47:48.884  INFO: Plugins: example: started (api 1.0, config {"enabled":true,...})
   2026-11-12 15:47:48.884  INFO: Plugins: loaded 1 of 1
   ```

## Сборка

Из корня репозитория:
```bash
npm run build:plugin -- example
```
Готовый архив появится по пути `dist/plugins/example.zip`. Рабочий `config.json` 

## Контракт (кратко)

| Метод / свойство | Что делает и что возвращает |
|---|---|
| `api.version` | Версия контракта (`'1.0'`). |
| `api.config` | Копия конфига ядра без секретов (секции `server` и `opds` без `user`/`password` доступны; `accessPassword`, `remoteLib` и `external` вырезаны). |
| `api.dataDir` / `api.pluginsDir` | Пути к каталогу данных и папке плагинов. |
| `api.log(msg)` / `api.log(LM_WARN, msg)` / `api.log(LM_ERR, msg)` | Пишет сообщения в общий лог сервера. |
| `api.guard(name, fn)` | Оборачивает асинхронный обработчик, чтобы необработанные исключения аккуратно попадали в лог. |
| `api.registerRoute(path, handler, opts)` | Регистрирует HTTP-роут по пути `/plugin/<id>/<path>`. |
| `api.registerOpdsPageMutator(fn, name?)` | Позволяет изменить итоговый XML/JSON OPDS-страницы перед отдачей клиенту. |
| `api.registerOpdsBookLinks(fn, name?)` | Добавляет свои ссылки в карточку книги в OPDS. |
| `api.registerWebBookLinks(fn, name?)` | Добавляет свои кнопки/ссылки у книги в веб-интерфейсе. |
| `api.waitReady({ timeoutMs })` | Ждёт загрузки поисковой базы. Возвращает `true` или кидает `DB_NOT_READY` по таймауту. |
| `api.search(from, query)` | Поиск по справочникам (`from`: `'author'`, `'series'` или `'title'`). Возвращает `{ found, totalFound }`. |
| `api.bookSearch(query)` | Полноценный поиск книг. Возвращает `{ found, totalFound }`. |
| `api.getBookLink(uid)` | Ссылка и пути к файлу книги: `{ link, libFolder, libFile, downFileName }`. Кидает `404`, если книги нет. |
| `api.getBookFile(uid, opts)` | Распаковывает/готовит файл книги и возвращает `{ path, filename, mime }`. Кидает `404`, если не найдено. |
| `api.getBookInfo(uid)` | Полная информация о книге: `{ bookInfo: { book, cover, bookInfo, ... } }`. Кидает `404`, если не найдено. |
| `api.getGenreTree()` | Справочники: `{ genreTree, langList, extList, inpxHash }`. |
| `api.getStats()` | Состояние фич и базы: `{ reviewsEnabled, authorsBioEnabled, inpxHash }`. |
| `api.getBookReviewsCount(uid)` | Сводка по отзывам: `{ declaredCount, sum }`. Кидает `reviews_disabled` или `404`. |
| `api.getBookReviews(uid)` | Все отзывы на книгу: `{ declaredCount, sum, reviews[], months[] }`. |
| `api.getReviewLink(uid)` | Ссылка на файл отзывов `<hash>.review`: `{ link }`. |
| `api.getBookAuthors(uid)` | Авторы книги: `[{ name, hash, found }]`. |
| `api.getAuthorBio(hash)` | HTML с биографией автора или `null`. Кидает `authors_disabled`, если биографии отключены. |
| `api.getAuthorPhoto(hash)` | Путь к фото автора `{ path, ext }` или `null`. |
| `api.getBioLink(hash)` | Ссылка на биографию: `{ link }`. |
| `api.getPhotoLink(hash)` | Ссылка на фото: `{ link }` (может вести на `.nophoto`). |
| `api.getAuthorPhotoMime(ext)` | Синхронно возвращает MIME-тип по расширению фото. |
| `api.getFavorites(offset, limit)` / `getFavoriteUids()` / `addFavorite(uid)` /

* Ошибку `server_busy` ловить не нужно — `api` сам дожидается `waitReady`.
* Методы отзывов (`getBookReviews*`) могут кидать `reviews_disabled` в первые ~300 мс после старта базы, пока подгружается индекс отзывов — это штатная ситуация, достаточно обернуть вызов в `try/catch`.
* Для логов следует использовать `api.log(...)` вместо `console.log`, чтобы записи попадали в общий лог `inpx-web` с правильными таймстампами и уровнями.