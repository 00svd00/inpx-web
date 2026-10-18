const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const path = require('path');
const http = require('http');
const express = require('express');
const initAuthorPhoto = require('../../server/core/AuthorPhotoRoute');
const { makeTmpDir, cleanup } = require('../helpers/tmpdir');

async function withServer(app, fn) {
    const server = http.createServer(app);
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    try { return await fn(`http://127.0.0.1:${port}`); }
    finally { await new Promise(r => server.close(r)); }
}

function makeConfig(over = {}) {
    return Object.assign({authorsBioEnabled: true, rootPathStatic: ''}, over);
}

function makeWebWorker(over = {}) {
    return Object.assign({
        getAuthorPhoto: async () => null,
        getAuthorPhotoMime: () => 'image/jpeg',
    }, over);
}

test('hash невалидный → 400', async () => {
    const app = express();
    initAuthorPhoto(app, makeConfig(), {webWorker: makeWebWorker()});
    await withServer(app, async (base) => {
        const res = await fetch(`${base}/author/photo?hash=zzz`);
        assert.strictEqual(res.status, 400);
    });
});

test('getAuthorPhoto → null → 404 + Cache-Control: no-cache', async () => {
    const app = express();
    initAuthorPhoto(app, makeConfig(), {webWorker: makeWebWorker()});
    await withServer(app, async (base) => {
        const res = await fetch(`${base}/author/photo?hash=${'a'.repeat(32)}`);
        assert.strictEqual(res.status, 404);
        assert.strictEqual(res.headers.get('cache-control'), 'no-cache');
    });
});

test('getAuthorPhoto → {path, ext} → 200 + Content-Type + public, max-age', async () => {
    const dir = await makeTmpDir();
    try {
        const imgPath = path.join(dir, 'h.jpg');
        await fs.writeFile(imgPath, 'jpg-data');

        const app = express();
        initAuthorPhoto(app, makeConfig(), {webWorker: makeWebWorker({
            getAuthorPhoto: async () => ({path: imgPath, ext: '.jpg'}),
            getAuthorPhotoMime: (ext) => (ext === '.jpg' ? 'image/jpeg' : 'application/octet-stream'),
        })});
        await withServer(app, async (base) => {
            const res = await fetch(`${base}/author/photo?hash=${'a'.repeat(32)}`);
            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.headers.get('content-type'), 'image/jpeg');
            assert.strictEqual(res.headers.get('cache-control'), 'public, max-age=604800');
            assert.strictEqual(await res.text(), 'jpg-data');
        });
    } finally { await cleanup(dir); }
});

test('rootPathStatic учитывается в пути', async () => {
    const app = express();
    initAuthorPhoto(app, makeConfig({rootPathStatic: '/flibusta'}), {webWorker: makeWebWorker()});
    await withServer(app, async (base) => {
        const r1 = await fetch(`${base}/author/photo?hash=${'a'.repeat(32)}`);
        assert.strictEqual(r1.status, 404); // без префикса — Express не нашёл роут

        const r2 = await fetch(`${base}/flibusta/author/photo?hash=${'a'.repeat(32)}`);
        assert.strictEqual(r2.status, 404); // наш обработчик (no-cache)
        assert.strictEqual(r2.headers.get('cache-control'), 'no-cache');
    });
});

test('authorsBioEnabled: false → роут не регистрируется', async () => {
    const app = express();
    initAuthorPhoto(app, makeConfig({authorsBioEnabled: false}), {webWorker: makeWebWorker()});
    await withServer(app, async (base) => {
        const res = await fetch(`${base}/author/photo?hash=${'a'.repeat(32)}`);
        assert.strictEqual(res.status, 404);
        assert.notStrictEqual(res.headers.get('cache-control'), 'no-cache');
    });
});