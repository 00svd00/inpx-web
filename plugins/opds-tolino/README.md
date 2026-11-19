# inpx-web plugin: opds-tolino

Делает OPDS-каталог совместимым с читалками Tolino: к каждой entry, у которой
есть навигационная ссылка (`rel="subsection"`), добавляется её дубль без `rel`.
Tolino ходит по записи только через ссылку без `rel`, остальные читалки
продолжают использовать `rel="subsection"`.

## Установка и запуск

1. Распаковать архив с плагином в каталог плагинов `<dataDir>/plugins/`:
   ```bash
   unzip dist/plugins/opds-tolino.zip -d <dataDir>/plugins/
   ```

2. Создать рабочий конфиг из шаблона:
   ```bash
   cp <dataDir>/plugins/opds-tolino/config.example.json <dataDir>/plugins/opds-tolino/config.json
   ```

3. В `config.json` плагина включить его:
   ```json
   {
       "enabled": true
   }
   ```

4. В основном конфиге ядра (`<dataDir>/config.json`) разрешить загрузку плагинов:
   ```json
   "pluginsEnabled": true
   ```

5. Перезапустить сервер.

## Сборка

Из корня репозитория:
```bash
npm run build:plugin -- opds-tolino
```
Готовый архив появится по пути `dist/plugins/opds-tolino.zip`.