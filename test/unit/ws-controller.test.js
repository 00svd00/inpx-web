const test = require('node:test');
const assert = require('node:assert');
const { WebSocketController } = require('../../server/controllers');
const { PROTOCOL_VERSION } = require('../../server/core/Protocol');
const hooks = require('../../server/core/hooks');

function makeFakeThis({ config, webWorker, webAccess } = {}) {
    return {
        config: config || {},
        webWorker: webWorker || {},
        webAccess: webAccess || { freeAccess: true },
        sent: [],
        send(res, req, ws) { this.sent.push(res); },
    };
}

test('getConfig: protocolVersion + features.indexes по stats', async () => {
    const fake = makeFakeThis({
        config: { webConfigParams: ['name', 'version'], name: 'n', version: '1' },
        webWorker: {
            dbConfig: async () => ({ stats: { reviewsEnabled: true, authorsBioEnabled: false } }),
        },
    });
    await WebSocketController.prototype.getConfig.call(fake, {}, {});
    const res = fake.sent[0];
    assert.strictEqual(res.protocolVersion, PROTOCOL_VERSION);
    assert.strictEqual(res.features.reviewsEnabled, true);
    assert.strictEqual(res.features.authorsBioEnabled, false);
    assert.deepStrictEqual(res.features.indexes, ['reviews_index']);
});

test('getIndex: guard allowRemoteLib', async () => {
    const fake = makeFakeThis({ config: { allowRemoteLib: false } });
    await assert.rejects(
        () => WebSocketController.prototype.getIndex.call(fake, { table: 'reviews_index' }, {}),
        /Remote lib access disabled/
    );
});

test('getIndex: table обязателен', async () => {
    const fake = makeFakeThis({ config: { allowRemoteLib: true } });
    await assert.rejects(
        () => WebSocketController.prototype.getIndex.call(fake, {}, {}),
        /table is empty/
    );
});

test('getIndex: неизвестный table', async () => {
    const fake = makeFakeThis({
        config: { allowRemoteLib: true },
        webWorker: { dbConfig: async () => ({ stats: { reviewsEnabled: true, authorsBioEnabled: false } }) },
    });
    await assert.rejects(
        () => WebSocketController.prototype.getIndex.call(fake, { table: 'authors_info' }, {}),
        /unknown_index/
    );
});

test('getIndex: hash совпал → data:null, hash', async () => {
    const fake = makeFakeThis({
        config: { allowRemoteLib: true },
        webWorker: {
            dbConfig: async () => ({ stats: { reviewsEnabled: true, authorsBioEnabled: false } }),
            dumpIndex: async () => ({ data: Buffer.from('x'), hash: 'h' }),
        },
    });
    await WebSocketController.prototype.getIndex.call(fake, { table: 'reviews_index', hash: 'h' }, {});
    assert.deepStrictEqual(fake.sent[0], { data: null, hash: 'h' });
});

test('getReviewLink/getBioLink/getPhotoLink: guard allowRemoteLib', async () => {
    const fake = makeFakeThis({ config: { allowRemoteLib: false } });
    await assert.rejects(() => WebSocketController.prototype.getReviewLink.call(fake, { bookUid: 'u' }, {}), /Remote lib access disabled/);
    await assert.rejects(() => WebSocketController.prototype.getBioLink.call(fake, { hash: 'h' }, {}), /Remote lib access disabled/);
    await assert.rejects(() => WebSocketController.prototype.getPhotoLink.call(fake, { hash: 'h' }, {}), /Remote lib access disabled/);
});

// --- getBookLinks / getBooksLinks ---

function fakeWithHooks(pluginId = 'ws-test') {
    // Регистрируем пустой плагин, чтобы hasWebBookLinks() был true
    hooks.registerWebBookLinks(pluginId, 'stub', async () => ({}));
    return pluginId;
}

function cleanupHooks(pluginId) {
    hooks.unregisterPlugin(pluginId);
}

test('getBookLinks: без плагинов (hasWebBookLinks=false) → {items: []}', async () => {
    // Без регистрации: реестр может быть пуст
    const fake = makeFakeThis({
        webWorker: { getBookRecord: async () => ({_uid: 'u'}) },
    });
    await WebSocketController.prototype.getBookLinks.call(fake, {bookUid: 'u'}, {});
    assert.deepStrictEqual(fake.sent[0], {items: []});
});

test('getBookLinks: книга не найдена → {items: []}', async () => {
    const pid = fakeWithHooks();
    try {
        const fake = makeFakeThis({
            webWorker: { getBookRecord: async () => null },
        });
        await WebSocketController.prototype.getBookLinks.call(fake, {bookUid: 'u'}, {});
        assert.deepStrictEqual(fake.sent[0], {items: []});
    } finally {
        cleanupHooks(pid);
    }
});

test('getBookLinks: есть книга + плагин → runWebBookLinks', async () => {
    const pid = 'ws-test-booklinks';
    hooks.registerWebBookLinks(pid, 'stub', async (items) => {
        const out = {};
        for (const {uid} of items)
            out[uid] = [{key: 'k', title: 'T', href: '/x'}];
        return out;
    });
    try {
        const fake = makeFakeThis({
            webWorker: {
                getBookRecord: async (uid) => ({_uid: uid, title: 'B'}),
            },
        });
        await WebSocketController.prototype.getBookLinks.call(fake, {bookUid: 'u'}, {});
        assert.strictEqual(fake.sent[0].items.length, 1);
        assert.strictEqual(fake.sent[0].items[0].key, 'k');
    } finally {
        cleanupHooks(pid);
    }
});

test('getBookLinks: без bookUid → throw', async () => {
    const fake = makeFakeThis({});
    await assert.rejects(
        () => WebSocketController.prototype.getBookLinks.call(fake, {}, {}),
        /bookUid is empty/
    );
});

test('getBooksLinks: пустой uids → {links: {}}', async () => {
    const fake = makeFakeThis({});
    await WebSocketController.prototype.getBooksLinks.call(fake, {uids: []}, {});
    assert.deepStrictEqual(fake.sent[0], {links: {}});
});

test('getBooksLinks: не массив → throw', async () => {
    const fake = makeFakeThis({});
    await assert.rejects(
        () => WebSocketController.prototype.getBooksLinks.call(fake, {uids: 'notarray'}, {}),
        /uids is not an array/
    );
});

test('getBooksLinks: батч через getBooks + runWebBookLinksBatch', async () => {
    const pid = 'ws-test-batch';
    hooks.registerWebBookLinks(pid, 'stub', async (items) => {
        const out = {};
        for (const {uid} of items)
            out[uid] = [{key: 'k', title: uid, href: `/x/${uid}`}];
        return out;
    });
    try {
        let getBooksCalls = 0;
        const fake = makeFakeThis({
            webWorker: {
                getBooks: async (uids) => {
                    getBooksCalls++;
                    return uids.map(u => ({_uid: u, title: `T-${u}`}));
                },
            },
        });
        await WebSocketController.prototype.getBooksLinks.call(fake, {uids: ['u1', 'u2', 'u3']}, {});
        assert.strictEqual(getBooksCalls, 1);  // один db.select
        assert.deepStrictEqual(Object.keys(fake.sent[0].links).sort(), ['u1', 'u2', 'u3']);
        assert.strictEqual(fake.sent[0].links.u1[0].title, 'u1');
    } finally {
        cleanupHooks(pid);
    }
});

test('getBooksLinks: книга не найдена → не падает, links без uid', async () => {
    const pid = 'ws-test-batch-miss';
    hooks.registerWebBookLinks(pid, 'stub', async (items) => {
        const out = {};
        for (const {uid, book} of items) {
            if (book)
                out[uid] = [{key: 'k', title: 'T', href: '/x'}];
        }
        return out;
    });
    try {
        const fake = makeFakeThis({
            webWorker: {
                getBooks: async (uids) => [],  // ни одна не найдена
            },
        });
        await WebSocketController.prototype.getBooksLinks.call(fake, {uids: ['u1']}, {});
        assert.deepStrictEqual(fake.sent[0].links, {});
    } finally {
        cleanupHooks(pid);
    }
});