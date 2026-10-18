const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const RemoteLib = require('../../server/core/RemoteLib');
const { PROTOCOL_VERSION } = require('../../server/core/Protocol');
const { makeTmpDir, cleanup } = require('../helpers/tmpdir');

// fakeThis: без конструктора (singleton + фоновые циклы не нужны)
function makeFakeThis({ wsRequest, wsc, down, config } = {}) {
    return {
        config: config || { remoteLib: { url: 'ws://host/flibusta' }, dataDir: '' },
        wsc: wsc || null,
        down: down || null,
        remoteHost: 'http://host',
        remoteBasePath: '/flibusta',
        handshakeDone: false,
        providerProtocolVersion: 0,
        providerFeatures: {},
        wsRequest: wsRequest || (async () => ({})),
        downloadRemote: RemoteLib.prototype.downloadRemote,
    };
}

test('handshake: provider_too_old (нет protocolVersion)', async () => {
    const fake = makeFakeThis({ wsRequest: async () => ({}) });
    await assert.rejects(
        () => RemoteLib.prototype.handshake.call(fake),
        /provider_too_old/
    );
});

test('handshake: protocol_mismatch', async () => {
    const fake = makeFakeThis({ wsRequest: async () => ({ protocolVersion: PROTOCOL_VERSION + 1 }) });
    await assert.rejects(
        () => RemoteLib.prototype.handshake.call(fake),
        /protocol_mismatch/
    );
});

test('handshake: ok — заполняет providerFeatures', async () => {
    const features = { reviewsEnabled: true, authorsBioEnabled: true, indexes: ['reviews_index'] };
    const fake = makeFakeThis({ wsRequest: async () => ({ protocolVersion: PROTOCOL_VERSION, features }) });
    await RemoteLib.prototype.handshake.call(fake);
    assert.strictEqual(fake.handshakeDone, true);
    assert.strictEqual(fake.providerProtocolVersion, PROTOCOL_VERSION);
    assert.deepStrictEqual(fake.providerFeatures, features);
});

test('handshake: идемпотентен', async () => {
    let calls = 0;
    const fake = makeFakeThis({ wsRequest: async () => { calls++; return { protocolVersion: PROTOCOL_VERSION }; } });
    await RemoteLib.prototype.handshake.call(fake);
    await RemoteLib.prototype.handshake.call(fake);
    assert.strictEqual(calls, 1);
});

test('isDumpValid: ok / нет файла / hash не совпал / битый hash', async () => {
    const dir = await makeTmpDir();
    try {
        const config = { dataDir: dir };
        const fake = makeFakeThis();
        const file = path.join(dir, 'reviews_index.json.gz');
        const hashFile = `${file}.hash`;

        // нет файлов
        assert.strictEqual(await RemoteLib.prototype.isDumpValid.call(fake, config, 'reviews_index.json.gz'), false);

        // ok
        const buf = Buffer.from('data');
        await fs.writeFile(file, buf);
        await fs.writeFile(hashFile, crypto.createHash('sha256').update(buf).digest('hex'));
        assert.strictEqual(await RemoteLib.prototype.isDumpValid.call(fake, config, 'reviews_index.json.gz'), true);

        // hash не совпал
        await fs.writeFile(hashFile, 'deadbeef');
        assert.strictEqual(await RemoteLib.prototype.isDumpValid.call(fake, config, 'reviews_index.json.gz'), false);

        // пустой hash
        await fs.writeFile(hashFile, '');
        assert.strictEqual(await RemoteLib.prototype.isDumpValid.call(fake, config, 'reviews_index.json.gz'), false);
    } finally { await cleanup(dir); }
});

test('downloadRemote: basePath добавляется, если link без него', async () => {
    const dir = await makeTmpDir();
    try {
        const out = path.join(dir, 'book');
        let loadedUrl = null;
        const down = { load: async (url) => { loadedUrl = url; return Buffer.from('x'); } };
        const fake = makeFakeThis({ down });

        await RemoteLib.prototype.downloadRemote.call(fake, '/book/abc', out);
        assert.strictEqual(loadedUrl, 'http://host/flibusta/book/abc');
        assert.strictEqual(await fs.readFile(out, 'utf8'), 'x');
    } finally { await cleanup(dir); }
});

test('downloadRemote: basePath не дублируется', async () => {
    const dir = await makeTmpDir();
    try {
        let loadedUrl = null;
        const down = { load: async (url) => { loadedUrl = url; return Buffer.from('x'); } };
        const fake = makeFakeThis({ down });

        await RemoteLib.prototype.downloadRemote.call(fake, '/flibusta/book/abc', path.join(dir, 'out'));
        assert.strictEqual(loadedUrl, 'http://host/flibusta/book/abc');
    } finally { await cleanup(dir); }
});

test('downloadRemote: пустой link → no link', async () => {
    const fake = makeFakeThis({ down: { load: async () => Buffer.from('') } });
    await assert.rejects(
        () => RemoteLib.prototype.downloadRemote.call(fake, '', '/tmp/x'),
        /no link/
    );
});

test('downloadBook: ошибка wsRequest → 502', async () => {
    const fake = makeFakeThis({ wsRequest: async () => { throw new Error('boom'); } });
    await assert.rejects(
        () => RemoteLib.prototype.downloadBook.call(fake, 'uid'),
        /502/
    );
});

test('downloadReview: hash без .review', async () => {
    const dir = await makeTmpDir();
    try {
        const fake = makeFakeThis({
            wsRequest: async () => ({ link: '/book/abc.review' }),
            down: { load: async () => Buffer.from('r') },
        });
        fake.config.bookDir = dir;
        const hash = await RemoteLib.prototype.downloadReview.call(fake, 'uid');
        assert.strictEqual(hash, 'abc');
        assert.ok(await fs.pathExists(path.join(dir, 'abc.review')));
    } finally { await cleanup(dir); }
});

test('downloadPhoto: hash без .ext / .nophoto', async () => {
    const dir = await makeTmpDir();
    try {
        const fake = makeFakeThis({
            wsRequest: async () => ({ link: '/author/deadbeef.jpg' }),
            down: { load: async () => Buffer.from('p') },
        });
        fake.config.authorDir = dir;
        await RemoteLib.prototype.downloadPhoto.call(fake, 'deadbeef');
        assert.ok(await fs.pathExists(path.join(dir, 'deadbeef.jpg')));
    } finally { await cleanup(dir); }
});