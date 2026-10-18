const test = require('node:test');
const assert = require('node:assert');
const makeBookDispatch = require('../../server/core/opds/bookDispatch');

function make(opts = {}) {
    const calls = {bookBody: 0, addonsBody: 0, hasAddons: 0};
    const book = { body: async () => { calls.bookBody++; return 'book'; } };
    const bookAddons = {
        hasAddons: async () => { calls.hasAddons++; return !!opts.hasAddons; },
        body: async () => { calls.addonsBody++; return 'addons'; },
    };
    const dispatch = makeBookDispatch(opts.config || {}, {book, bookAddons});
    return {dispatch, calls};
}

test('opdsBookAddonsInCard: true → book.body, hasAddons не дёргается', async () => {
    const {dispatch, calls} = make({config: {opdsBookAddonsInCard: true}, hasAddons: true});
    assert.strictEqual(await dispatch.body({query: {}}, {}), 'book');
    assert.strictEqual(calls.bookBody, 1);
    assert.strictEqual(calls.hasAddons, 0);
    assert.strictEqual(calls.addonsBody, 0);
});

test('opdsBookAddonsInCard: false + hasAddons → bookAddons.body', async () => {
    const {dispatch, calls} = make({config: {opdsBookAddonsInCard: false}, hasAddons: true});
    assert.strictEqual(await dispatch.body({query: {uid: 'u'}}, {}), 'addons');
    assert.strictEqual(calls.hasAddons, 1);
    assert.strictEqual(calls.addonsBody, 1);
    assert.strictEqual(calls.bookBody, 0);
});

test('opdsBookAddonsInCard: false + !hasAddons → book.body', async () => {
    const {dispatch, calls} = make({config: {opdsBookAddonsInCard: false}, hasAddons: false});
    assert.strictEqual(await dispatch.body({query: {uid: 'u'}}, {}), 'book');
    assert.strictEqual(calls.bookBody, 1);
    assert.strictEqual(calls.addonsBody, 0);
});

test('direct=1 форсирует карточку даже при false + hasAddons', async () => {
    const {dispatch, calls} = make({config: {opdsBookAddonsInCard: false}, hasAddons: true});
    assert.strictEqual(await dispatch.body({query: {uid: 'u', direct: '1'}}, {}), 'book');
    assert.strictEqual(calls.bookBody, 1);
    assert.strictEqual(calls.hasAddons, 0);
});