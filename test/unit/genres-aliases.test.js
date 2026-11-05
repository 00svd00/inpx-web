const { test } = require('node:test');
const assert = require('node:assert');

const genreTree = require('../../server/core/genres');
const GROUPS = require('../../server/core/genres/genreAliases');
const {
    expandGenre,
    canonicalGenre,
    _codeToCanonical,
    _canonicalToGroup,
} = require('../../server/core/genres/genreUtils');

// множество кодов из genresText.js (после парсинга)
function genresTextCodes() {
    const set = new Set();
    for (const section of genreTree)
        for (const g of section.value)
            set.add(g.value);
    return set;
}

test('genreAliases: канон каждой группы есть в genresText.js', () => {
    const codes = genresTextCodes();
    for (const canonical of Object.keys(GROUPS)) {
        assert.ok(codes.has(canonical), `канон "${canonical}" отсутствует в genresText.js`);
    }
});

test('genreAliases: алиасы не встречаются в genresText.js', () => {
    const codes = genresTextCodes();
    for (const [canonical, group] of Object.entries(GROUPS)) {
        for (const code of group) {
            if (code === canonical)
                continue;
            assert.ok(!codes.has(code), `алиас "${code}" (${canonical}) найден в genresText.js — будет дубль в меню`);
        }
    }
});

test('genreAliases: канон присутствует в своей группе', () => {
    for (const [canonical, group] of Object.entries(GROUPS)) {
        assert.ok(group.includes(canonical), `канон "${canonical}" не в своей группе`);
    }
});

test('genreAliases: нет дублей внутри группы', () => {
    for (const [canonical, group] of Object.entries(GROUPS)) {
        assert.strictEqual(new Set(group).size, group.length, `дубль в группе "${canonical}"`);
    }
});

test('genreAliases: код не в двух группах', () => {
    const seen = new Map();
    for (const [canonical, group] of Object.entries(GROUPS)) {
        for (const code of group) {
            const prev = seen.get(code);
            assert.ok(prev === undefined || prev === canonical, `код "${code}" в группах "${prev}" и "${canonical}"`);
            seen.set(code, canonical);
        }
    }
});

test('expandGenre: идемпотентность', () => {
    for (const code of _codeToCanonical.keys()) {
        const once = expandGenre(code);
        assert.strictEqual(expandGenre(once), once, `идемпотентность для "${code}"`);
    }
});

test('expandGenre: симметрия внутри группы', () => {
    for (const [canonical, group] of Object.entries(GROUPS)) {
        const expected = expandGenre(canonical);
        for (const code of group) {
            assert.strictEqual(expandGenre(code), expected, `симметрия "${code}" vs "${canonical}"`);
        }
    }
});

test('expandGenre: порядок не влияет', () => {
    assert.strictEqual(expandGenre('popadancy,sf'), expandGenre('sf,popadancy'));
    assert.strictEqual(expandGenre('popadanec,sf'), expandGenre('sf,popadancy'));
});

test('expandGenre: неизвестный код возвращается как есть', () => {
    assert.strictEqual(expandGenre('unknown_code'), 'unknown_code');
    assert.strictEqual(expandGenre('unknown_code,popadancy'), 'popadancy,popadanec,unknown_code');
});

test('expandGenre: пусто / null', () => {
    assert.strictEqual(expandGenre(''), '');
    assert.strictEqual(expandGenre(null), null);
    assert.strictEqual(expandGenre(undefined), undefined);
});

test('canonicalGenre: канон / алиас / неизвестный', () => {
    assert.strictEqual(canonicalGenre('popadancy'), 'popadancy');
    assert.strictEqual(canonicalGenre('popadanec'), 'popadancy');
    assert.strictEqual(canonicalGenre('sf_all'), 'sf_etc');
    assert.strictEqual(canonicalGenre('military_arts'), 'home_sport');
    assert.strictEqual(canonicalGenre('unknown_code'), 'unknown_code');
    assert.strictEqual(canonicalGenre(''), '');
    assert.strictEqual(canonicalGenre(null), null);
});

test('canonicalGenre: все коды групп сводятся к канону', () => {
    for (const [canonical, group] of Object.entries(GROUPS)) {
        for (const code of group)
            assert.strictEqual(canonicalGenre(code), canonical, `${code} -> ${canonical}`);
    }
});