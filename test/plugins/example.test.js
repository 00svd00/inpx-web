const assert = require('node:assert');
const test = require('node:test');
const express = require('express');

const hooks = require('../../server/core/hooks');
const routes = require('../../server/core/routes');
const example = require('../../plugins/example');

const TEST_PLUGIN_ID = 'example-test';
const TEST_CONFIG = { greeting: 'Hi from test', logStatsOnStart: false };

// mock api — минимум, чтобы start() прошёл все ветки
function makeApi(overrides = {}) {
    return Object.assign({
        version: '1.0',
        config: {
            name: 'inpx-web', version: '1.6.5', branch: 'test', dbVersion: '14',
        },
        dataDir: '/tmp/data',
        pluginsDir: '/tmp/plugins',
        log: () => {},

        waitReady: async () => true,
        getStats: async () => ({ reviewsEnabled: false, authorsBioEnabled: false, inpxHash: '' }),
        getGenreTree: async () => ({ genreTree: [], langList: [], extList: [] }),
        search: async () => ({ found: [], totalFound: 0 }),
        bookSearch: async () => ({ found: [], totalFound: 0 }),
        getBookLink: async () => ({ link: '/x', libFolder: '', libFile: '', downFileName: '' }),
        getBookInfo: async (uid) => {
            throw new Error('404 Файл не найден');
        },
        getBookReviewsCount: async () => ({ declaredCount: 0, sum: 0 }),
        getBookReviews: async () => ({ foundCount: 0, months: [] }),
        getReviewLink: async () => ({ link: '' }),
        getBookAuthors: async () => [],
        getAuthorBio: async () => null,
        getPhotoLink: async () => ({ link: '' }),

        registerRoute: (path, handler, opts) => routes.registerRoute(TEST_PLUGIN_ID, path, handler, opts),
        registerOpdsPageMutator: (fn, name) => hooks.registerOpdsPageMutator(TEST_PLUGIN_ID, name, fn),
        registerOpdsBookLinks: (fn, name) => hooks.registerOpdsBookLinks(TEST_PLUGIN_ID, name, fn),
        registerWebBookLinks: (fn, name) => hooks.registerWebBookLinks(TEST_PLUGIN_ID, name, fn),
    }, overrides);
}

function startApp() {
    const app = express();
    routes.mount(app, '/plugin');
    app.use((err, req, res, next) => res.status(500).send('err: ' + err.message));   // eslint-disable-line no-unused-vars
    return new Promise(resolve => {
        const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
    });
}

function urlOf(srv, p) {
    return `http://127.0.0.1:${srv.address().port}${p}`;
}

function cleanup() {
    hooks.unregisterPlugin(TEST_PLUGIN_ID);
    routes.unregisterPlugin(TEST_PLUGIN_ID);
}

// ---------------------------------------------------------------------------
// Contract smoke
// ---------------------------------------------------------------------------

test('example: start() не падает с mock api', async () => {
    try {
        await example.start(makeApi(), TEST_CONFIG);
    } finally {
        cleanup();
    }
});

test('example: start() регистрирует все 4 точки расширения', async () => {
    try {
        await example.start(makeApi(), TEST_CONFIG);
        const h = hooks.snapshot();
        assert.strictEqual(h.opdsPageMutators.length, 1);
        assert.strictEqual(h.opdsBookLinks.length, 1);
        assert.strictEqual(h.webBookLinks.length, 1);
        const r = routes.snapshot();
        assert.ok(r[TEST_PLUGIN_ID]);
        assert.strictEqual(r[TEST_PLUGIN_ID].length, 4);   // /hello, /api/info, /book, /download
    } finally {
        cleanup();
    }
});

test('example: unregisterPlugin снимает всё', async () => {
    await example.start(makeApi(), TEST_CONFIG);

    assert.strictEqual(hooks.snapshot().opdsPageMutators.length, 1);
    assert.strictEqual(hooks.snapshot().opdsBookLinks.length, 1);
    assert.strictEqual(hooks.snapshot().webBookLinks.length, 1);
    assert.ok(routes.snapshot()[TEST_PLUGIN_ID]);

    cleanup();

    assert.strictEqual(hooks.snapshot().opdsPageMutators.length, 0);
    assert.strictEqual(hooks.snapshot().opdsBookLinks.length, 0);
    assert.strictEqual(hooks.snapshot().webBookLinks.length, 0);
    assert.strictEqual(routes.snapshot()[TEST_PLUGIN_ID], undefined);
});

test('example: apiVersion 2.0 → не регистрирует', async () => {
    try {
        await example.start(makeApi({version: '2.0'}), TEST_CONFIG);
        assert.strictEqual(hooks.snapshot().opdsPageMutators.length, 0);
        assert.strictEqual(hooks.snapshot().opdsBookLinks.length, 0);
        assert.strictEqual(hooks.snapshot().webBookLinks.length, 0);
        assert.strictEqual(routes.snapshot()[TEST_PLUGIN_ID], undefined);
    } finally {
        cleanup();
    }
});

// ---------------------------------------------------------------------------
// End-to-end: routes
// ---------------------------------------------------------------------------

test('example: GET /plugin/<id>/hello → 200 HTML с greeting', async () => {
    const srv = await startApp();
    try {
        await example.start(makeApi(), TEST_CONFIG);
        const r = await fetch(urlOf(srv, `/plugin/${TEST_PLUGIN_ID}/hello`));
        assert.strictEqual(r.status, 200);
        assert.match(r.headers.get('content-type') || '', /text\/html/);
        assert.ok((await r.text()).includes('Hi from test'));
    } finally {
        cleanup();
        srv.close();
    }
});

test('example: GET /plugin/<id>/api/info → 200 JSON с core', async () => {
    const srv = await startApp();
    try {
        await example.start(makeApi(), TEST_CONFIG);
        const r = await fetch(urlOf(srv, `/plugin/${TEST_PLUGIN_ID}/api/info`));
        assert.strictEqual(r.status, 200);
        const data = await r.json();
        assert.strictEqual(data.plugin, 'example');
        assert.strictEqual(data.apiVersion, '1.0');
        assert.strictEqual(data.core.name, 'inpx-web');
    } finally {
        cleanup();
        srv.close();
    }
});

test('example: GET /plugin/<id>/book?uid=u1 → 404 (книги нет)', async () => {
    const srv = await startApp();
    try {
        // mock getBookInfo возвращает {bookInfo: null} — bookPageHandler должен ответить 404
        await example.start(makeApi(), TEST_CONFIG);
        const r = await fetch(urlOf(srv, `/plugin/${TEST_PLUGIN_ID}/book?uid=u1`));
        assert.strictEqual(r.status, 404);
    } finally {
        cleanup();
        srv.close();
    }
});

test('example: GET /plugin/<id>/book без uid → 400', async () => {
    const srv = await startApp();
    try {
        await example.start(makeApi(), TEST_CONFIG);
        const r = await fetch(urlOf(srv, `/plugin/${TEST_PLUGIN_ID}/book`));
        assert.strictEqual(r.status, 400);
    } finally {
        cleanup();
        srv.close();
    }
});