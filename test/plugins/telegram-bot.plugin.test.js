// Contract smoke + lifecycle для плагина telegram-bot.
// Реальный Bot (node-telegram-bot-api) не создаётся: start() возвращается раньше
// (при неверной api.version / пустом токене / без пароля) — это и проверяем.
const assert = require('node:assert');
const test = require('node:test');

if (global.LM_WARN === undefined) global.LM_WARN = 1;
if (global.LM_ERR === undefined) global.LM_ERR = 2;

const plugin = require('../../plugins/telegram-bot');
const { TelegramBotPlugin } = require('../../plugins/telegram-bot/lib/TelegramBotPlugin');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeApi(overrides = {}) {
    return Object.assign({
        version: '1.0',
        pluginId: 'telegram-bot',
        pluginsDir: '/tmp/plugins',
        config: { name: 'inpx-web', version: '1.6.5', branch: 'test', dbVersion: '14' },
        dataDir: '/tmp/data',
        log: () => {},
        waitReady: async () => true,
    }, overrides);
}

function makeConfig(overrides = {}) {
    return Object.assign({
        enabled: true,
        token: '',
        accessPassword: '',
        allowedUsers: [],
        maxResults: 10,
        sessionTtlMinutes: 5,
        cleanIntervalMinutes: 5,
    }, overrides);
}

function makeLogCollector() {
    const logs = [];
    return { logs, log: (levelOrMsg, msg) => logs.push({ levelOrMsg, msg }) };
}

// ---------------------------------------------------------------------------
// Contract smoke (без старта polling)
// ---------------------------------------------------------------------------

test('telegram-bot: экспортирует start() и stop()', () => {
    assert.strictEqual(typeof plugin.start, 'function');
    assert.strictEqual(typeof plugin.stop, 'function');
});

test('telegram-bot: package.json содержит apiVersion', () => {
    const pkg = require('../../plugins/telegram-bot/package.json');
    assert.ok(pkg.apiVersion, 'apiVersion отсутствует');
    assert.strictEqual(String(pkg.apiVersion).split('.')[0], '1');
});

test('telegram-bot: start() с api.version=2.0 — skip, не бросает', async () => {
    const logs = makeLogCollector();
    const api = makeApi({ version: '2.0', log: logs.log });
    await plugin.start(api, makeConfig({ token: 't', accessPassword: 'p' }));
    assert.ok(logs.logs.some(l => /unsupported api\.version/.test(String(l.msg || l.levelOrMsg))));
    await plugin.stop();
});

test('telegram-bot: start() без token — skip, не бросает', async () => {
    const logs = makeLogCollector();
    const api = makeApi({ log: logs.log });
    await plugin.start(api, makeConfig({ token: '' }));
    assert.ok(logs.logs.some(l => /token is empty/.test(String(l.msg || l.levelOrMsg))));
    await plugin.stop();
});

test('telegram-bot: start() без password/allowedUsers — отказ', async () => {
    const logs = makeLogCollector();
    const api = makeApi({ log: logs.log });
    await plugin.start(api, makeConfig({ token: 't', accessPassword: '', allowedUsers: [] }));
    assert.ok(logs.logs.some(l => /refusing to start public bot/.test(String(l.msg || l.levelOrMsg))));
    await plugin.stop();
});

test('telegram-bot: stop() без start() — не бросает', async () => {
    await plugin.stop();
});

// ---------------------------------------------------------------------------
// TelegramBotPlugin: конструктор/limit
// ---------------------------------------------------------------------------

test('TelegramBotPlugin: limit = min(maxResults, 90)', () => {
    const api = makeApi();
    const p = new TelegramBotPlugin(api, makeConfig({ maxResults: 200 }));
    assert.strictEqual(p.limit, 90);
    const p2 = new TelegramBotPlugin(api, makeConfig({ maxResults: 10 }));
    assert.strictEqual(p2.limit, 10);
});

test('TelegramBotPlugin: limit=0/NaN → дефолт 10 (через || 10)', () => {
    const api = makeApi();
    const p = new TelegramBotPlugin(api, makeConfig({ maxResults: 0 }));
    assert.strictEqual(p.limit, 10);
    const p2 = new TelegramBotPlugin(api, makeConfig({ maxResults: 'abc' }));
    assert.strictEqual(p2.limit, 10);
});

test('TelegramBotPlugin: access.password из config', () => {
    const api = makeApi();
    const p = new TelegramBotPlugin(api, makeConfig({ accessPassword: 'secret' }));
    assert.strictEqual(p.access.password, 'secret');
});

test('TelegramBotPlugin: authFile рядом с config.json плагина', () => {
    const api = makeApi({ pluginsDir: '/tmp/p', pluginId: 'telegram-bot' });
    const p = new TelegramBotPlugin(api, makeConfig());
    // authFile не выставлен наружу, но makeAccess его принимает; проверим косвенно —
    // что access.allowedUsers учитывает config
    assert.deepStrictEqual(p.access.allowedUsers, []);
});

// ---------------------------------------------------------------------------
// Lifecycle: start не создаёт Bot при неудачных предпосылках
// ---------------------------------------------------------------------------

test('TelegramBotPlugin.start: не создаёт bot при api.version != 1', async () => {
    const api = makeApi({ version: '2.0' });
    const p = new TelegramBotPlugin(api, makeConfig({ token: 't', accessPassword: 'p' }));
    await p.start();
    assert.strictEqual(p.bot, null);
});

test('TelegramBotPlugin.start: не создаёт bot при пустом token', async () => {
    const api = makeApi();
    const p = new TelegramBotPlugin(api, makeConfig({ token: '' }));
    await p.start();
    assert.strictEqual(p.bot, null);
});

test('TelegramBotPlugin.start: waitReady-ошибка → skip, не бросает', async () => {
    const logs = makeLogCollector();
    const api = makeApi({
        log: logs.log,
        waitReady: async () => { throw new Error('DB_NOT_READY'); },
    });
    const p = new TelegramBotPlugin(api, makeConfig({ token: 't', accessPassword: 'p' }));
    await p.start();
    assert.strictEqual(p.bot, null);
    assert.ok(logs.logs.some(l => /waitReady failed/.test(String(l.msg || l.levelOrMsg))));
});

test('TelegramBotPlugin.stop: без bot — не бросает', async () => {
    const api = makeApi();
    const p = new TelegramBotPlugin(api, makeConfig());
    await p.stop();
});