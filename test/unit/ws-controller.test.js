const test = require('node:test');
const assert = require('node:assert');
const { WebSocketController } = require('../../server/controllers');
const { PROTOCOL_VERSION } = require('../../server/core/Protocol');

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