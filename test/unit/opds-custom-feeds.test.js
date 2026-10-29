const test = require('node:test');
const assert = require('node:assert');
const CustomOpdsFeedPage = require('../../server/core/opds/CustomOpdsFeedPage');

const normalize = CustomOpdsFeedPage.normalizeCustomFeeds;
// parseFeedDate — приватный метод; не использует this (только dayjs) → Object.create
const page = Object.create(CustomOpdsFeedPage.prototype);

// --- normalizeCustomFeeds ---

test('normalize: валидный фид', () => {
    const r = normalize({a: {name: 'A', active: true, type: 'author', query: {genre: 'sf', date: '2months'}}});
    assert.strictEqual(r.a.active, true);
    assert.strictEqual(r.a.type, 'author');
    assert.deepStrictEqual(r.a.query, {genre: 'sf', date: '2months'});
});

test('normalize: невалидный id → active false', () => {
    const r = normalize({'bad id': {name: 'A', type: 'author'}});
    assert.strictEqual(r['bad id'].active, false);
});

test('normalize: невалидный type → active false', () => {
    const r = normalize({a: {name: 'A', type: 'xxx'}});
    assert.strictEqual(r.a.active, false);
});

test('normalize: query — только белый список', () => {
    const r = normalize({a: {type: 'title', query: {genre: 'sf', del: '0', page: 1, foo: 'bar', librate: '4,5'}}});
    assert.deepStrictEqual(r.a.query, {genre: 'sf', librate: '4,5'});
});

test('normalize: active false сохраняется', () => {
    const r = normalize({a: {active: false, type: 'author'}});
    assert.strictEqual(r.a.active, false);
});

test('normalize: пустой/null raw → {}', () => {
    assert.deepStrictEqual(normalize(null), {});
    assert.deepStrictEqual(normalize(undefined), {});
    assert.deepStrictEqual(normalize({}), {});
});

test('normalize: feed не объект → active false', () => {
    const r = normalize({a: 'string'});
    assert.strictEqual(r.a.active, false);
});

test('normalize: name по умолчанию = id', () => {
    const r = normalize({a: {type: 'author'}});
    assert.strictEqual(r.a.name, 'a');
});

// --- parseFeedDate ---

test('parseFeedDate: ключевые слова → YYYY-MM-DD', () => {
    for (const v of ['today', '3days', 'week', '2weeks', 'month', '2months', '3months'])
        assert.match(page.parseFeedDate(v), /^\d{4}-\d{2}-\d{2}$/, v);
});

test('parseFeedDate: дата как есть', () => {
    assert.strictEqual(page.parseFeedDate('2026-01-01'), '2026-01-01');
    assert.strictEqual(page.parseFeedDate('2026-01-01,2026-02-01'), '2026-01-01,2026-02-01');
});

test('parseFeedDate: пусто/null/неизвестно', () => {
    assert.strictEqual(page.parseFeedDate(''), '');
    assert.strictEqual(page.parseFeedDate(null), null);
    assert.strictEqual(page.parseFeedDate(undefined), undefined);
    assert.strictEqual(page.parseFeedDate('abc'), 'abc');
});