const { test } = require('node:test');
const assert = require('node:assert');

const { buildInfoList, buildDesc } = require('../../server/core/book/bookInfoMapping');

const bookInfo = {
    titleInfo: {
        genre: ['popadanec', 'sf_technofantasy', 'sf_realrpg'],
        bookTitle: 'Тест',
    },
};

test('buildInfoList: жанры нормализуются через canonicalGenre', () => {
    const list = buildInfoList(bookInfo);
    const ti = list.find(i => i.name === 'titleInfo');
    const genre = ti.value.find(v => v.name === 'genre');
    // popadanec → popadancy; sf_technofantasy и sf_realrpg — без изменений (не алиасы)
    assert.strictEqual(genre.value, 'popadancy, sf_technofantasy, sf_realrpg');
});

test('buildDesc: genre нормализуется', () => {
    const desc = buildDesc(bookInfo);
    assert.deepStrictEqual(desc.genre, ['popadancy', 'sf_technofantasy', 'sf_realrpg']);
});