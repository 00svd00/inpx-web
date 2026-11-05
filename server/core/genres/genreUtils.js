const GROUPS = require('./genreAliases');

// code -> canonical (для любого кода группы, включая сам канон)
const codeToCanonical = new Map();
// canonical -> отсортированный массив всех кодов группы (канон + алиасы)
const canonicalToGroup = new Map();

for (const [canonical, group] of Object.entries(GROUPS)) {
    const sorted = [...new Set(group)].sort();

    if (!sorted.includes(canonical))
        throw new Error(`genreAliases: канон "${canonical}" отсутствует в своей группе`);

    canonicalToGroup.set(canonical, sorted);

    for (const code of sorted) {
        const prev = codeToCanonical.get(code);
        if (prev !== undefined && prev !== canonical)
            throw new Error(`genreAliases: код "${code}" в двух группах ("${prev}" и "${canonical}")`);
        codeToCanonical.set(code, canonical);
    }
}

// Прямое раскрытие: для поиска.
// Принимает строку кодов через запятую, возвращает строку кодов через запятую —
// объединение всех групп, отсортированное (стабильный кэш-ключ).
// Идемпотентно: expandGenre(expandGenre(x)) === expandGenre(x).
function expandGenre(genre) {
    if (!genre)
        return genre;

    const out = new Set();
    for (const code of String(genre).split(',')) {
        const c = code.trim();
        if (!c)
            continue;
        const canonical = codeToCanonical.get(c);
        if (canonical) {
            for (const g of canonicalToGroup.get(canonical))
                out.add(g);
        } else {
            out.add(c);
        }
    }

    return Array.from(out).sort().join(',');
}

// Обратное раскрытие: для отображения.
// Один код -> канон. Неизвестный код возвращается как есть.
function canonicalGenre(code) {
    if (!code)
        return code;
    return codeToCanonical.get(code) || code;
}

module.exports = {
    expandGenre,
    canonicalGenre,
    // для тестов / отладки
    _codeToCanonical: codeToCanonical,
    _canonicalToGroup: canonicalToGroup,
};