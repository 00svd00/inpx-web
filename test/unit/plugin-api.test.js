const { test, describe } = require('node:test');
const assert = require('node:assert');

const { PluginApi, API_VERSION, safeConfig } = require('../../server/core/PluginApi');

// LM_* — глобальные (Logger.js), доступны в тестах через preload.
// Если preload не грузит Logger — определим локально (тесты не должны зависеть от глобалов).
if (typeof LM_INFO === 'undefined') global.LM_INFO = 1;
if (typeof LM_WARN === 'undefined') global.LM_WARN = 2;
if (typeof LM_ERR === 'undefined') global.LM_ERR = 3;

function makeConfig(overrides = {}) {
    return Object.assign({
        name: 'inpx-web',
        version: '1.6.4',
        branch: 'production',
        dbVersion: '14',
        bookReadLink: '',
        rootPathStatic: '',
        reviewsEnabled: true,
        authorsBioEnabled: true,
        opdsBookAddonsInCard: true,
        extendedSearch: true,
        favorites: { enabled: true, autoAdd: true, maxCount: 5000 },
        uiDefaults: { limit: 20 },
        dataDir: '/data',
        pluginsDir: '',
        libDir: '/lib',
        remoteLib: false,
        accessPassword: 'secret',
        server: { host: '0.0.0.0', port: '12380' },
        opds: { enabled: true, user: 'u', password: 'p' },
        external: { 'ext-fb2': { cmd: 'x', active: true } },
    }, overrides);
}

function makeLogger() {
    const calls = [];
    return {
        calls,
        log: (...args) => calls.push(args),
    };
}

function makeWebWorker(overrides = {}) {
    return Object.assign({
        myState: 'normal',
        dbConfig: async () => ({ stats: { reviewsEnabled: true, authorsBioEnabled: true }, inpxHash: 'abc' }),
        search: async () => ({ found: [], totalFound: 0 }),
        bookSearch: async () => ({ found: [], totalFound: 0 }),
        getBookLink: async () => ({ link: '/book/x', downFileName: 'x.fb2' }),
        resolveBookFile: async () => ({ path: '/book/x', filename: 'x.fb2.zip', mime: 'application/zip', gzipped: false }),
        getBookInfo: async () => ({ bookInfo: {} }),
        getAuthorBookList: async () => ({ author: '', books: [] }),
        getAuthorSeriesList: async () => ({ author: '', series: [] }),
        getGenreTree: async () => ({ genreTree: [], langList: [], extList: [] }),
        getBookReviewsCount: async () => ({ declaredCount: 0, sum: 0 }),
        getBookReviews: async () => ({ reviews: [] }),
        getReviewLink: async () => ({ link: '/book/x.review' }),
        getBookAuthors: async () => [],
        getAuthorBio: async () => null,
        getAuthorPhoto: async () => null,
        getBioLink: async () => ({ link: '/author/x.bio' }),
        getPhotoLink: async () => ({ link: '/author/x.jpg' }),
        getAuthorPhotoMime: () => 'image/jpeg',
        getFavorites: async () => ({ books: [], total: 0 }),
        getFavoriteUids: async () => ({ uids: [] }),
        addFavorite: async () => {},
        removeFavorite: async () => {},
        materializeBio: async () => ({ hash: 'h', bio: null, photo: null }),
    }, overrides);
}

function makeApi(opts = {}) {
    const config = opts.config || makeConfig();
    const webWorker = opts.webWorker || makeWebWorker();
    const logger = opts.logger || makeLogger();
    return new PluginApi({ config, webWorker, pluginId: 'test', logger });
}

describe('PluginApi: safeConfig', () => {
    test('не содержит секретов', () => {
        const c = safeConfig(makeConfig());
        assert.strictEqual(c.accessPassword, undefined);
        assert.strictEqual(c.remoteLib, undefined);
        assert.strictEqual(c.server, undefined);
        assert.strictEqual(c.opds, undefined);
        assert.strictEqual(c.external, undefined);
    });

    test('содержит безопасные поля', () => {
        const c = safeConfig(makeConfig());
        assert.strictEqual(c.name, 'inpx-web');
        assert.strictEqual(c.version, '1.6.4');
        assert.strictEqual(c.dbVersion, '14');
        assert.strictEqual(c.reviewsEnabled, true);
    });

    test('libDir только при !remoteLib', () => {
        assert.strictEqual(safeConfig(makeConfig()).libDir, '/lib');
        assert.strictEqual(safeConfig(makeConfig({ remoteLib: true })).libDir, undefined);
    });

    test('deep clone: мутация не влияет на исходный config', () => {
        const config = makeConfig();
        const c = safeConfig(config);
        c.favorites.enabled = false;
        assert.strictEqual(config.favorites.enabled, true);
    });

    test('api.config — новый объект при каждом обращении', () => {
        const api = makeApi();
        const a = api.config;
        const b = api.config;
        assert.notStrictEqual(a, b);
        assert.deepStrictEqual(a, b);
    });
});

describe('PluginApi: waitReady', () => {
    test('normal сразу → true', async () => {
        const api = makeApi();
        const t0 = Date.now();
        assert.strictEqual(await api.waitReady({ timeoutMs: 1000, intervalMs: 10 }), true);
        assert.ok(Date.now() - t0 < 100);
    });

    test('становится normal через intervalMs → true', async () => {
        const ww = makeWebWorker({ myState: 'db_loading' });
        const api = makeApi({ webWorker: ww });
        setTimeout(() => { ww.myState = 'normal'; }, 30);
        assert.strictEqual(await api.waitReady({ timeoutMs: 1000, intervalMs: 10 }), true);
    });

    test('не становится normal → DB_NOT_READY', async () => {
        const api = makeApi({ webWorker: makeWebWorker({ myState: 'db_loading' }) });
        await assert.rejects(
            () => api.waitReady({ timeoutMs: 50, intervalMs: 10 }),
            /DB_NOT_READY/
        );
    });
});

describe('PluginApi: _call (через search)', () => {
    test('server_busy → waitReady → повтор → успех', async () => {
        let calls = 0;
        const ww = makeWebWorker({
            search: async () => {
                calls++;
                if (calls === 1) throw new Error('server_busy');
                return { found: ['ok'], totalFound: 1 };
            },
        });
        const api = makeApi({ webWorker: ww });
        const r = await api.search('author', { author: 'x' });
        assert.deepStrictEqual(r.found, ['ok']);
        assert.strictEqual(calls, 2);
    });

    test('server_busy → waitReady timeout → DB_NOT_READY', async () => {
        const ww = makeWebWorker({
            myState: 'db_loading',
            search: async () => { throw new Error('server_busy'); },
        });
        const api = makeApi({ webWorker: ww });
        // waitReady по умолчанию 30с — сократим через прямой вызов с коротким timeout
        // (в _call timeout не передаётся; используем короткий через переопределение)
        await assert.rejects(async () => {
            // эмулируем: _call → waitReady с коротким timeout
            const orig = api.waitReady.bind(api);
            api.waitReady = (opts) => orig({ timeoutMs: 50, intervalMs: 10, ...opts });
            return api.search('author', { author: 'x' });
        }, /DB_NOT_READY/);
    });

    test('другая ошибка → пробрасывается без повтора', async () => {
        let calls = 0;
        const ww = makeWebWorker({
            search: async () => { calls++; throw new Error('404 Файл не найден'); },
        });
        const api = makeApi({ webWorker: ww });
        await assert.rejects(() => api.search('author', { author: 'x' }), /404/);
        assert.strictEqual(calls, 1);
    });

    test('server_busy дважды → второй раз пробрасывается', async () => {
        let calls = 0;
        const ww = makeWebWorker({
            search: async () => { calls++; throw new Error('server_busy'); },
        });
        const api = makeApi({ webWorker: ww });
        // myState='normal' → waitReady сразу true → повтор → снова server_busy → throw
        await assert.rejects(() => api.search('author', { author: 'x' }), /server_busy/);
        assert.strictEqual(calls, 2);
    });
});

describe('PluginApi: getStats', () => {
    test('stats есть → корректные поля', async () => {
        const api = makeApi({
            webWorker: makeWebWorker({
                dbConfig: async () => ({ stats: { reviewsEnabled: true, authorsBioEnabled: false }, inpxHash: 'h' }),
            }),
        });
        const s = await api.getStats();
        assert.deepStrictEqual(s, { reviewsEnabled: true, authorsBioEnabled: false, inpxHash: 'h' });
    });

    test('stats нет → false/пусто', async () => {
        const api = makeApi({ webWorker: makeWebWorker({ dbConfig: async () => ({}) }) });
        const s = await api.getStats();
        assert.deepStrictEqual(s, { reviewsEnabled: false, authorsBioEnabled: false, inpxHash: '' });
    });

    test('вызывается dbConfig, не getStats', async () => {
        let dbConfigCalls = 0;
        const api = makeApi({
            webWorker: makeWebWorker({
                dbConfig: async () => { dbConfigCalls++; return {}; },
            }),
        });
        await api.getStats();
        assert.strictEqual(dbConfigCalls, 1);
    });
});

describe('PluginApi: log', () => {
    test('api.log("msg") → logger.log("msg")', () => {
        const logger = makeLogger();
        const api = makeApi({ logger });
        api.log('hello');
        assert.deepStrictEqual(logger.calls, [['hello']]);
    });

    test('api.log(LM_WARN, "msg") → logger.log(LM_WARN, "msg")', () => {
        const logger = makeLogger();
        const api = makeApi({ logger });
        api.log(LM_WARN, 'warn');
        assert.deepStrictEqual(logger.calls, [[LM_WARN, 'warn']]);
    });

    test('logger.log бросает → fallback console.log, не падает', () => {
        const logger = { log: () => { throw new Error('boom'); } };
        const api = makeApi({ logger });
        const orig = console.log;
        let fallback = null;
        console.log = (...args) => { fallback = args; };
        try {
            assert.doesNotThrow(() => api.log('x'));
        } finally {
            console.log = orig;
        }
        assert.ok(fallback && fallback[0].includes('[test]'));
    });
});

describe('PluginApi: getFavorites', () => {
    test('дефолты offset=0, limit=50', async () => {
        let args = null;
        const api = makeApi({
            webWorker: makeWebWorker({
                getFavorites: async (...a) => { args = a; return { books: [], total: 0 }; },
            }),
        });
        await api.getFavorites();
        assert.deepStrictEqual(args, [0, 50]);
    });

    test('явные offset/limit пробрасываются', async () => {
        let args = null;
        const api = makeApi({
            webWorker: makeWebWorker({
                getFavorites: async (...a) => { args = a; return { books: [], total: 0 }; },
            }),
        });
        await api.getFavorites(10, 20);
        assert.deepStrictEqual(args, [10, 20]);
    });
});

describe('PluginApi: getAuthorPhotoMime', () => {
    test('синхронный, вызывает webWorker', () => {
        let arg = null;
        const api = makeApi({
            webWorker: makeWebWorker({
                getAuthorPhotoMime: (ext) => { arg = ext; return 'image/png'; },
            }),
        });
        assert.strictEqual(api.getAuthorPhotoMime('.png'), 'image/png');
        assert.strictEqual(arg, '.png');
    });
});

describe('PluginApi: getBookFile', () => {
    test('default format=zip: getBookLink → resolveBookFile(hash, "zip")', async () => {
        let resolveArgs = null;
        const api = makeApi({
            webWorker: makeWebWorker({
                getBookLink: async () => ({ link: '/book/abc123', downFileName: 'x.fb2' }),
                resolveBookFile: async (hash, format) => {
                    resolveArgs = [hash, format];
                    return { path: '/data/book/abc123.zip', filename: 'x.fb2.zip', mime: 'application/zip', gzipped: false };
                },
            }),
        });
        const r = await api.getBookFile('uid-1');
        assert.deepStrictEqual(resolveArgs, ['abc123', 'zip']);
        assert.strictEqual(r.filename, 'x.fb2.zip');
    });

    test('format=raw: resolveBookFile(hash, "raw")', async () => {
        let resolveArgs = null;
        const api = makeApi({
            webWorker: makeWebWorker({
                getBookLink: async () => ({ link: '/book/abc123', downFileName: 'x.fb2' }),
                resolveBookFile: async (hash, format) => {
                    resolveArgs = [hash, format];
                    return { path: '/data/book/abc123.raw', filename: 'x.fb2', mime: 'application/fb2+xml', gzipped: false };
                },
            }),
        });
        await api.getBookFile('uid-1', { format: 'raw' });
        assert.deepStrictEqual(resolveArgs, ['abc123', 'raw']);
    });

    test('server_busy → waitReady → повтор', async () => {
        let calls = 0;
        const api = makeApi({
            webWorker: makeWebWorker({
                getBookLink: async () => {
                    calls++;
                    if (calls === 1) throw new Error('server_busy');
                    return { link: '/book/abc123', downFileName: 'x.fb2' };
                },
                resolveBookFile: async () => ({ path: '/x', filename: 'x', mime: 'application/zip' }),
            }),
        });
        const r = await api.getBookFile('uid-1');
        assert.strictEqual(calls, 2);
        assert.ok(r.path);
    });
});

describe('PluginApi: pluginsDir', () => {
    test('config.pluginsDir задан → возвращает его', () => {
        const api = makeApi({ config: makeConfig({ pluginsDir: '/custom/plugins' }) });
        assert.strictEqual(api.pluginsDir, '/custom/plugins');
    });

    test('пуст → path.join(dataDir, "plugins")', () => {
        const api = makeApi({ config: makeConfig({ pluginsDir: '', dataDir: '/data' }) });
        assert.strictEqual(api.pluginsDir, '/data/plugins');
    });
});

describe('PluginApi: getAuthorBookList / getAuthorSeriesList', () => {
    test('getAuthorBookList пробрасывает authorId и возвращает {author, books}', async () => {
        let arg = null;
        const api = makeApi({
            webWorker: makeWebWorker({
                getAuthorBookList: async (id) => { arg = id; return { author: 'A', books: [{ _uid: 'u1' }] }; },
            }),
        });
        const r = await api.getAuthorBookList(42);
        assert.strictEqual(arg, 42);
        assert.strictEqual(r.author, 'A');
        assert.strictEqual(r.books.length, 1);
    });

    test('getAuthorSeriesList пробрасывает authorId и возвращает {author, series}', async () => {
        let arg = null;
        const api = makeApi({
            webWorker: makeWebWorker({
                getAuthorSeriesList: async (id) => { arg = id; return { author: 'A', series: [{ id: 1, series: 'S', bookCount: 3 }] }; },
            }),
        });
        const r = await api.getAuthorSeriesList(42);
        assert.strictEqual(arg, 42);
        assert.strictEqual(r.series.length, 1);
    });
});

describe('PluginApi: API_VERSION', () => {
    test('api.version = "1.0"', () => {
        assert.strictEqual(API_VERSION, '1.0');
        assert.strictEqual(makeApi().version, '1.0');
    });
});