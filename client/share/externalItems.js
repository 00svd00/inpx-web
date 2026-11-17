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
function getExternalItems(external, bookExt, externalToolsEnabled = true) {
    if (!externalToolsEnabled || !external)
        return [];

    const be = normExt(bookExt);
    const result = [];

    for (const [key, item] of Object.entries(external)) {
        if (!item || !item.active)
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

// Blocklist: пропускаем всё, кроме реально опасных схем.
// Custom schemes (fbreader:, alreader:, intent:), mailto:, tel:, http(s):,
// protocol-relative //host/path и относительные /path — проходят.
// Control chars (java\nscript:) — отсекаем.
const BLOCKED_SCHEMES = new Set(['javascript:', 'data:', 'vbscript:', 'blob:', 'file:']);

function isSafeHref(href) {
    if (!href || typeof href !== 'string')
        return false;
    const trimmed = href.trim();
    if (!trimmed)
        return false;
    // control chars — защита от java\nscript:, \0javascript: и т.п.
    if (/[\x00-\x1F\x7F]/.test(trimmed))
        return false;
    // относительные и anchor — безопасны
    if (trimmed.startsWith('/') || trimmed.startsWith('#'))
        return true;
    // схема есть?
    const m = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed);
    if (!m)
        return true;  // нет схемы — относительная
    return !BLOCKED_SCHEMES.has(m[1].toLowerCase() + ':');
}

module.exports = { normExt, getExternalItems, isSafeHref };