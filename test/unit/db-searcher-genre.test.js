const { test } = require('node:test');
const assert = require('node:assert');

const DbSearcher = require('../../server/core/DbSearcher');
const { expandGenre } = require('../../server/core/genres/genreUtils');

// Проверяем, что selectBookIds нормализует genre до queryKey.
// Без реальной БД — проверяем сам expandGenre + логику "до queryKey" косвенно.
test('selectBookIds: expandGenre идемпотентен для входов', () => {
    assert.strictEqual(expandGenre('popadancy'), 'popadancy,popadanec');
    assert.strictEqual(expandGenre('popadanec'), 'popadancy,popadanec');
    assert.strictEqual(expandGenre('sf_all'), 'sf_all,sf_etc');   // 'sf_all' < 'sf_etc'
    assert.strictEqual(expandGenre('military_arts'), 'home_sport,military_arts'); // 'h' < 'm'
});

test('selectBookIds: раскрытие не меняет неизвестный код', () => {
    assert.strictEqual(expandGenre('unknown'), 'unknown');
});

// Проверяем, что selectBookIds нормализует genre до queryKey.
// Без реальной БД — проверяем сам expandGenre + логику "до queryKey" косвенно.
test('selectBookIds: expandGenre идемпотентен для входов', () => {
    assert.strictEqual(expandGenre('popadancy'), 'popadancy,popadanec');
    assert.strictEqual(expandGenre('popadanec'), 'popadancy,popadanec');
    assert.strictEqual(expandGenre('sf_all'), 'sf_all,sf_etc');   // 'sf_all' < 'sf_etc'
    assert.strictEqual(expandGenre('military_arts'), 'home_sport,military_arts'); // 'h' < 'm'
});

test('selectBookIds: раскрытие не меняет неизвестный код', () => {
    assert.strictEqual(expandGenre('unknown'), 'unknown');
});

// --- queryKey: excludeGenre ---

// мини-хелпер, как в db-searcher-rating.test.js
function make(recStruct = []) {
    const s = Object.create(DbSearcher.prototype);
    s.recStruct = recStruct;
    return s;
}

test('queryKey: excludeGenre попадает в конец после ratingCount', () => {
    const s = make([{field: 'author'}, {field: 'series'}, {field: 'title'}]);
    const key = s.queryKey({
        author: 'A', series: 'S', title: 'T',
        ratingCount: '5..',
        excludeGenre: 'love,love_all',
    });
    assert.strictEqual(key, '["A","S","T","5..","love,love_all"]');
});

test('queryKey: пустой excludeGenre → ""', () => {
    const s = make([{field: 'author'}, {field: 'series'}, {field: 'title'}]);
    assert.strictEqual(
        s.queryKey({author: 'A', series: 'S', title: 'T'}),
        '["A","S","T","",""]'
    );
});

test('queryKey: разный excludeGenre → разный ключ', () => {
    const s = make([{field: 'author'}]);
    assert.notStrictEqual(
        s.queryKey({author: 'A', excludeGenre: 'love'}),
        s.queryKey({author: 'A', excludeGenre: 'sf'})
    );
});

test('queryKey: excludeGenre не влияет на include-поля', () => {
    const s = make([{field: 'author'}, {field: 'genre'}]);
    const a = s.queryKey({author: 'A', genre: 'detective'});
    const b = s.queryKey({author: 'A', genre: 'detective', excludeGenre: 'love'});
    // ключи разные (excludeGenre добавлен), но prefix по recStruct одинаков
    assert.notStrictEqual(a, b);
    assert.ok(b.includes('"detective"'));
});