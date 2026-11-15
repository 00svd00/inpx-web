# inpx-web plugin: opds-tolino

Делает OPDS-каталог совместимым с читалками Tolino: к каждой entry, у которой
есть навигационная ссылка (`rel="subsection"`), добавляется её дубль без `rel`.
Tolino ходит по записи только через ссылку без `rel`, остальные читалки
продолжают использовать `rel="subsection"`.
Плагин идемпотентен: если plain-ссылка уже есть (встроенный мутатор отработал), 
ничего не меняет — можно ставить без конфликта;

## Требования

- inpx-web `1.6.5+` (нужен `api.registerOpdsPageMutator`);
- Node.js 22+.

Zero-dependency.

## Установка

```bash
unzip dist/plugins/opds-tolino.zip -d <dataDir>/plugins/
cp <dataDir>/plugins/opds-tolino/config.example.json <dataDir>/plugins/opds-tolino/config.json
# в config.json: "enabled": true
```

В конфиге ядра: `"pluginsEnabled": true`.

## Сборка
```bash
npm run build:plugin -- opds-tolino
```
→ dist/plugins/opds-tolino.zip.