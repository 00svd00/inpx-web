const test = require('node:test');
const assert = require('node:assert');
const makeBookDispatch = require('../../server/core/opds/bookDispatch');

function make(opts = {}) {
    const calls = {bookBody: 0, addonsBody: 0};
    const book = { body: async () => { calls.bookBody++; return 'book'; } };
    const bookAddons = { body: async () => { calls.addonsBody++; return 'addons'; } };
    const dispatch = makeBookDispatch(opts.config || {}, {book, bookAddons});
    return {dispatch, calls};
}

test('opdsBookAddonsInCard: true → book.body', async () => {
    const {dispatch, calls} = make({config: {opdsBookAddonsInCard: true}});
    assert.strictEqual(await dispatch.body({query: {}}, {}), 'book');
    assert.strictEqual(calls.bookBody, 1);
    assert.strictEqual(calls.addonsBody, 0);
});

test('opdsBookAddonsInCard: false → bookAddons.body', async () => {
    const {dispatch, calls} = make({config: {opdsBookAddonsInCard: false}});
    assert.strictEqual(await dispatch.body({query: {uid: 'u'}}, {}), 'addons');
    assert.strictEqual(calls.bookBody, 0);
    assert.strictEqual(calls.addonsBody, 1);
});

test('opdsBookAddonsInCard: false + direct=1 → book.body', async () => {
    const {dispatch, calls} = make({config: {opdsBookAddonsInCard: false}});
    assert.strictEqual(await dispatch.body({query: {uid: 'u', direct: '1'}}, {}), 'book');
    assert.strictEqual(calls.bookBody, 1);
    assert.strictEqual(calls.addonsBody, 0);
});