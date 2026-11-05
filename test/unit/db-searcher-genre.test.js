const { test } = require('node:test');
const assert = require('node:assert');

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