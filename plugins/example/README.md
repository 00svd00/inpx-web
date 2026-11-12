# inpx-web plugin: example

Эталонный плагин для inpx-web. Демонстрирует контракт `PluginApi` (`api.version = '1.0'`)
и типовые сценарии: `waitReady`, `search`, `bookSearch`, `getBookInfo`, `getBookLink`,
`getGenreTree`, `getStats`, `getReviewsCount`, `stop()`.

Zero-dependency: не требует `node_modules`, показывает минимальную структуру плагина.

## Структура
```
plugins/example/
├── package.json # name/version/main; без dependencies
├── config.example.json # шаблон конфига (копируется в config.json)
├── index.js # start(api, config) / stop()
└── README.md # этот файл
```

## Включение

1. Распаковать плагин в `<dataDir>/plugins/`:
`unzip dist/plugins/example.zip -d <dataDir>/plugins/`
(или скопировать каталог `plugins/example` вручную)

2. Создать `config.json` из шаблона:
`cp config.example.json config.json`

3. В `config.json` плагина: `"enabled": true` (по умолчанию `false` — безопасно).

4. В конфиге ядра (`<dataDir>/config.json`): `"pluginsEnabled": true` (по умолчанию `false`).

5. Перезапустить сервер. В логе:
```


[example] core: inpx-web v1.6.4 (production), dbVersion=14
...
[example] started
2026-11-12 15:47:48.884  INFO: Plugins: example: started (api 1.0, config {"enabled":true,...})
2026-11-12 15:47:48.884  INFO: Plugins: loaded 1 of 1
```

## Сборка
`npm run build:plugin -- example`

→ `dist/plugins/example.zip` (самодостаточный; `config.json` **не** входит — только `config.example.json`).

## Контракт (кратко)

| Метод | Возврат |
|---|---|
| `api.version` | `'1.0'` |
| `api.config` | безопасная копия конфига ядра (без `accessPassword`/`remoteLib`/`server`/`opds`/`external`) |
| `api.dataDir` / `api.pluginsDir` | пути ядра |
| `api.log(msg)` / `api.log(LM_WARN, msg)` / `api.log(LM_ERR, msg)` | в общий лог ядра |
| `api.waitReady({timeoutMs})` | `true` или throw `DB_NOT_READY` |
| `api.search(from, query)` | `{found, totalFound}`; `from: 'author'\|'series'\|'title'` |
| `api.bookSearch(query)` | `{found, totalFound}` |
| `api.getBookLink(uid)` | `{link, libFolder, libFile, downFileName}`; 404 → throw |
| `api.getBookInfo(uid)` | `{bookInfo: {book, cover, bookInfo, ...}}`; 404 → throw |
| `api.getGenreTree()` | `{genreTree, langList, extList, inpxHash}` |
| `api.getStats()` | `{reviewsEnabled, authorsBioEnabled, inpxHash}` |
| `api.getBookReviewsCount(uid)` | `{declaredCount, sum}`; `reviews_disabled`/404 → throw |
| `api.getBookReviews(uid)` | полный результат (`declaredCount`, `sum`, `reviews[]`, `months[]`); `reviews_disabled`/404 → throw |
| `api.getReviewLink(uid)` | `{link}` на `<hash>.review`; 404 → throw |
| `api.getBookAuthors(uid)` | `[{name, hash, found}]`; 404 → throw |
| `api.getAuthorBio(hash)` | HTML или `null`; `authors_disabled` → throw |
| `api.getAuthorPhoto(hash)` | `{path, ext}` или `null` |
| `api.getBioLink(hash)` | `{link}` (поставщик); 404 → throw |
| `api.getPhotoLink(hash)` | `{link}` (может быть `.nophoto`); `authors_disabled` → throw |
| `api.getAuthorPhotoMime(ext)` | MIME для фото (синхронный) |
| `api.getFavorites(offset, limit)` / `getFavoriteUids()` / `addFavorite(uid)` / `removeFavorite(uid)` | избранное |

`server_busy` ловится внутри `api` (ждёт `waitReady`); плагину обрабатывать не нужно.
`getBookReviewsCount`/`getBookReviews` могут бросить `reviews_disabled` в первые ~300 мс после `waitReady` — это нормально, плагин ловит.
Логирование — через `api.log(...)` (в общий лог ядра)

