const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');

const PluginManager = require('../../server/core/PluginManager');

if (typeof LM_WARN === 'undefined') global.LM_WARN = 2;
if (typeof LM_ERR === 'undefined') global.LM_ERR = 3;

let tmpDir;
let logCalls;

function makeLogger() {
    logCalls = [];
    return { log: (...args) => logCalls.push(args) };
}

function makeConfig(overrides = {}) {
    return Object.assign({
        dataDir: tmpDir,
        pluginsDir: path.join(tmpDir, 'plugins'),
        pluginsEnabled: true,
    }, overrides);
}

function makeWebWorker() {
    return { myState: 'normal' };
}

function makeManager(overrides = {}, logger = makeLogger()) {
    return new PluginManager(makeConfig(overrides), makeWebWorker(), logger);
}

async function writePlugin(id, cfg, indexJs) {
    const dir = path.join(tmpDir, 'plugins', id);
    await fs.ensureDir(dir);
    await fs.writeFile(path.join(dir, 'config.json'), JSON.stringify(cfg));
    if (indexJs !== undefined)
        await fs.writeFile(path.join(dir, 'index.js'), indexJs);
}

function allLogs() {
    return logCalls.map(c => c.join(' ')).join('\n');
}

describe('PluginManager', () => {
    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'inpx-web-plugins-'));
    });

    afterEach(async () => {
        await fs.remove(tmpDir);
    });

    test('pluginsEnabled: false → no-op', async () => {
        const pm = makeManager({ pluginsEnabled: false });
        await pm.start();
        assert.strictEqual(pm.plugins.size, 0);
    });

    test('плагин enabled: false → skip', async () => {
        await writePlugin('off', { enabled: false, apiVersion: '1.0' }, 'module.exports={start(){}};');
        const pm = makeManager();
        await pm.start();
        assert.strictEqual(pm.plugins.size, 0);
    });

    test('плагин enabled: true + index.js → загружен', async () => {
        await writePlugin('on', { enabled: true, apiVersion: '1.0' },
            'module.exports = { start(api, cfg) { global.__pluginStarted = { version: api.version, cfg }; } };');
        const pm = makeManager();
        await pm.start();
        assert.strictEqual(pm.plugins.size, 1);
        assert.strictEqual(global.__pluginStarted.version, '1.0');
        delete global.__pluginStarted;
    });

    test('без index.js → skip', async () => {
        await writePlugin('noindex', { enabled: true, apiVersion: '1.0' });
        const pm = makeManager();
        await pm.start();
        assert.strictEqual(pm.plugins.size, 0);
    });

    test('apiVersion major mismatch → skip', async () => {
        await writePlugin('v2', { enabled: true, apiVersion: '2.0' },
            'module.exports = { start() { global.__v2Started = true; } };');
        const pm = makeManager();
        await pm.start();
        assert.strictEqual(pm.plugins.size, 0);
        assert.strictEqual(global.__v2Started, undefined);
    });

    test('start() бросает → не загружен, сервер не падает', async () => {
        await writePlugin('boom', { enabled: true, apiVersion: '1.0' },
            'module.exports = { start() { throw new Error("boom"); } };');
        const pm = makeManager();
        await assert.doesNotReject(() => pm.start());
        assert.strictEqual(pm.plugins.size, 0);
    });

    test('маскирование: token в логах → "***"', async () => {
        await writePlugin('secret', { enabled: true, apiVersion: '1.0', token: 'secret123' },
            'module.exports = { start() {} };');
        const pm = makeManager();
        await pm.start();
        const all = allLogs();
        assert.ok(all.includes('"token":"***"'), `token не замаскирован: ${all}`);
        assert.ok(!all.includes('secret123'), 'token утёк в лог');
    });

    test('stopAll → вызывает stop() у загруженных', async () => {
        await writePlugin('stoppable', { enabled: true, apiVersion: '1.0' },
            'module.exports = { start() {}, stop() { global.__stopped = true; } };');
        const pm = makeManager();
        await pm.start();
        await pm.stopAll();
        assert.strictEqual(global.__stopped, true);
        assert.strictEqual(pm.plugins.size, 0);
        delete global.__stopped;
    });

    test('несуществующий pluginsDir → ensureDir, пусто', async () => {
        const pm = makeManager({ pluginsDir: path.join(tmpDir, 'nonexistent') });
        await pm.start();
        assert.strictEqual(pm.plugins.size, 0);
        assert.ok(await fs.pathExists(path.join(tmpDir, 'nonexistent')));
    });

    test('api получает тот же logger, что и manager', async () => {
        // плагин логирует через api.log — сообщение должно попасть в тот же logCalls
        await writePlugin('logapi', { enabled: true, apiVersion: '1.0' },
            'module.exports = { start(api) { api.log("from-api"); } };');
        const pm = makeManager();
        await pm.start();
        assert.ok(allLogs().includes('from-api'), `api.log не в общем логе: ${allLogs()}`);
    });
});