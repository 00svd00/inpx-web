const test = require('node:test');
const assert = require('node:assert');
const base = require('../../server/config/base');

test('dbVersion — снапшот (менять только при релизе)', () => {
    assert.strictEqual(base.dbVersion, '13');
});

test('reviews/authorsBio/opdsBookAddonsInCard/favorites — инварианты', () => {
    assert.strictEqual(base.reviewsEnabled, true);
    assert.strictEqual(base.authorsBioEnabled, true);
    assert.strictEqual(base.opdsBookAddonsInCard, true);
    assert.strictEqual(base.favorites.enabled, true);
    assert.strictEqual(base.favorites.autoAdd, true);
    assert.strictEqual(base.favorites.maxCount, 5000);
});

test('webConfigParams содержит обязательные поля', () => {
    for (const p of ['reviewsEnabled', 'authorsBioEnabled', 'opdsBookAddonsInCard', 'rootPathStatic', 'favorites'])
        assert.ok(base.webConfigParams.includes(p), `webConfigParams must contain ${p}`);
});

test('reviewsInOpds удалён (регресс-защита)', () => {
    assert.ok(!('reviewsInOpds' in base));
    assert.ok(!base.webConfigParams.includes('reviewsInOpds'));
});

test('latestReleaseLink/checkReleaseLink — TODO форк (не bookpauk)', () => {
    // снапшот: пока смотрят на bookpauk — фиксируем, чтобы релиз не забыл поменять
    assert.match(base.latestReleaseLink, /github\.com\/.+\/inpx-web\/releases\/latest$/);
    assert.match(base.checkReleaseLink, /api\.github\.com\/repos\/.+\/inpx-web\/releases\/latest$/);
});