const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const createWebApp = require('../../server/createWebApp');
const { makeZip } = require('../helpers/zip');
const { makeTmpDir, cleanup } = require('../helpers/tmpdir');

async function makeWebApp(entries, version = '1.0.0') {
    const dir = await makeTmpDir();
    const zipFile = path.join(dir, 'public.zip');
    const files = new Map();
    for (const [name, content] of Object.entries(entries))
        files.set(name, content);
    await makeZip(zipFile, files);
    const buf = await fs.readFile(zipFile);
    await cleanup(dir);

    const data = buf.toString('base64');
    const hash = crypto.createHash('sha256').update(data).digest('hex');
    return {data, manifest: {version, hash, entries: Object.keys(entries).sort()}};
}

function makeConfig(dir, over = {}) {
    return Object.assign({
        publicDir: path.join(dir, 'public'),
        tempDir: path.join(dir, 'tmp'),
        rootPathStatic: '',
        version: '1.0.0',
    }, over);
}

test('createWebApp: распаковка, .replaced сносятся, version.txt пишется', async () => {
    const dir = await makeTmpDir();
    try {
        const config = makeConfig(dir);
        await fs.ensureDir(config.publicDir);
        await fs.writeFile(path.join(config.publicDir, 'app.js.replaced'), '/old');
        await fs.ensureDir(config.tempDir);

        const webApp = await makeWebApp({'app.js': 'v1', 'index.html': '<html>1</html>'});
        await createWebApp(config, {webApp});

        assert.strictEqual(await fs.readFile(path.join(config.publicDir, 'app.js'), 'utf8'), 'v1');
        assert.ok(!await fs.pathExists(path.join(config.publicDir, 'app.js.replaced')));
        assert.strictEqual(await fs.readFile(path.join(config.publicDir, 'version.txt'), 'utf8'), '1.0.0');

        const marker = JSON.parse(await fs.readFile(path.join(config.publicDir, '.manifest.json'), 'utf8'));
        assert.strictEqual(marker.hash, webApp.manifest.hash);
        assert.strictEqual(marker.rootPathStatic, '');
    } finally { await cleanup(dir); }
});

test('createWebApp: пользовательский reader/ сохраняется', async () => {
    const dir = await makeTmpDir();
    try {
        const config = makeConfig(dir);
        await fs.ensureDir(path.join(config.publicDir, 'reader'));
        await fs.writeFile(path.join(config.publicDir, 'reader', 'user.json'), '{}');
        await fs.ensureDir(config.tempDir);

        const webApp = await makeWebApp({'app.js': 'v1'});
        await createWebApp(config, {webApp});

        assert.ok(await fs.pathExists(path.join(config.publicDir, 'reader', 'user.json')));
    } finally { await cleanup(dir); }
});

test('createWebApp: осиротевшие entries прошлой сборки сносятся', async () => {
    const dir = await makeTmpDir();
    try {
        const config = makeConfig(dir);
        await fs.ensureDir(config.publicDir);
        await fs.writeFile(path.join(config.publicDir, 'app.js'), 'old');
        await fs.writeFile(path.join(config.publicDir, 'old.js'), 'old-only');
        await fs.writeFile(path.join(config.publicDir, '.manifest.json'), JSON.stringify({
            version: '0.9', hash: 'oldhash', entries: ['app.js', 'old.js'], rootPathStatic: '',
        }));
        await fs.ensureDir(config.tempDir);

        const webApp = await makeWebApp({'app.js': 'v1'});
        await createWebApp(config, {webApp});

        assert.ok(!await fs.pathExists(path.join(config.publicDir, 'old.js')), 'old.js must be removed');
        assert.strictEqual(await fs.readFile(path.join(config.publicDir, 'app.js'), 'utf8'), 'v1');
    } finally { await cleanup(dir); }
});

test('createWebApp: тот же hash+root → no-op (файлы не трогаются)', async () => {
    const dir = await makeTmpDir();
    try {
        const config = makeConfig(dir);
        await fs.ensureDir(config.tempDir);
        const webApp = await makeWebApp({'app.js': 'v1'});
        await createWebApp(config, {webApp});

        await fs.writeFile(path.join(config.publicDir, 'app.js'), 'user-touched');
        await createWebApp(config, {webApp});
        assert.strictEqual(await fs.readFile(path.join(config.publicDir, 'app.js'), 'utf8'), 'user-touched');
    } finally { await cleanup(dir); }
});

test('createWebApp: смена rootPathStatic → пересборка, version.txt с суффиксом', async () => {
    const dir = await makeTmpDir();
    try {
        const config = makeConfig(dir);
        await fs.ensureDir(config.tempDir);
        const webApp = await makeWebApp({'app.js': 'v1'});
        await createWebApp(config, {webApp});

        const config2 = Object.assign({}, config, {rootPathStatic: '/flibusta'});
        await createWebApp(config2, {webApp});

        const marker = JSON.parse(await fs.readFile(path.join(config.publicDir, '.manifest.json'), 'utf8'));
        assert.strictEqual(marker.rootPathStatic, '/flibusta');
        assert.strictEqual(await fs.readFile(path.join(config.publicDir, 'version.txt'), 'utf8'), '1.0.0/flibusta');
    } finally { await cleanup(dir); }
});