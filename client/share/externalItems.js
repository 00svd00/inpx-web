// external tools: клиентская фильтрация кнопок (active + cmd + onlyExt).
// Логика — здесь (тестируется CJS-тестом), utils.js — реэкспорт для клиента,
// BookView.vue — тонкий геттер.
// Валидация ключа — на сервере (normalizeExternal при чтении конфига):
// сюда приходит уже нормализованный config.external.

function normExt(v) {
    return String(v || '').toLowerCase().replace(/^\./, '');
}

// external — config.external ({key: {...}}), bookExt — book.ext (строка, любой регистр/с точкой)
// возвращает массив {key, title, hint}
function getExternalItems(external, bookExt) {
    if (!external)
        return [];

    const be = normExt(bookExt);
    const result = [];

    for (const [key, item] of Object.entries(external)) {
        if (!item || !item.active || !item.cmd)
            continue;
        if (Array.isArray(item.onlyExt) && item.onlyExt.length) {
            if (!item.onlyExt.map(normExt).includes(be))
                continue;
        }
        result.push({
            key,
            title: item.title || key,
            hint: item.hint || '',
        });
    }

    return result;
}

module.exports = { normExt, getExternalItems };