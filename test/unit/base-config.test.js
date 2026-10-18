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

test('latestReleaseLink/checkReleaseLink — указывают на форк (снапшот)', () => {
    assert.strictEqual(base.latestReleaseLink, 'https://github.com/00svd00/inpx-web/releases/latest');
    assert.strictEqual(base.checkReleaseLink, 'https://api.github.com/repos/00svd00/inpx-web/releases/latest');
});