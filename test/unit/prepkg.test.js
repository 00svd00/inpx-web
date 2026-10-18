const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const { makeTmpDir, cleanup } = require('../helpers/tmpdir');

const prepkgPath = path.resolve(__dirname, '../../build/prepkg.js');
const pkg = require('../../package.json');

function hasCmd(cmd, args = ['-v']) {
    try { execFileSync(cmd, args, {stdio: 'ignore'}); return true; }
    catch (e) { return false; }
}

// prepkg использует `zip`; тест распаковывает через `unzip`.
// Если любого нет — skip (Linux-сборка обычно имеет оба).
const hasTools = hasCmd('zip') && hasCmd('unzip');

async function setupPublic(distDir) {
    const publicDir = path.join(distDir, 'tmp', 'public');
    await fs.ensureDir(publicDir);
    await fs.writeFile(path.join(publicDir, 'index.html'), '<html>v1</html>');
    await fs.writeFile(path.join(publicDir, 'app.js'), 'console.log(1)');
    await fs.ensureDir(path.join(publicDir, 'sub'));
    await fs.writeFile(path.join(publicDir, 'sub', 'x.css'), 'a{}');
    await fs.writeFile(path.join(publicDir, 'version.txt'), 'v');
    await fs.writeFile(path.join(publicDir, '.manifest.json'), '{}');
    return publicDir;
}

function runPrepkg(distDir, platform = 'linux') {
    execFileSync(process.execPath, [prepkgPath, platform, '--no-readme'], {
        env: Object.assign({}, process.env, {INPX_DIST_DIR: distDir}),
        stdio: 'pipe',
    });
}

function unzipBuf(buf, outDir) {
    const zipPath = path.join(outDir, '_data.zip');
    fs.writeFileSync(zipPath, buf);
    execFileSync('unzip', ['-o', '-q', zipPath, '-d', outDir]);
}

test('prepkg: manifest {version, hash, entries}, entries без служебных', {skip: !hasTools}, async () => {
    const distDir = await makeTmpDir();
    try {
        await setupPublic(distDir);
        runPrepkg(distDir);

        const out = path.join(distDir, 'public.json');
        assert.ok(await fs.pathExists(out));
        const {data, manifest} = JSON.parse(await fs.readFile(out, 'utf8'));

        assert.strictEqual(manifest.version, pkg.version);
        assert.match(manifest.hash, /^[a-f0-9]{64}$/);
        assert.deepStrictEqual(manifest.entries, ['app.js', 'index.html', 'sub']);
        assert.ok(!manifest.entries.includes('version.txt'));
        assert.ok(!manifest.entries.includes('.manifest.json'));
        assert.ok(data.length > 0);

        const expected = crypto.createHash('sha256').update(data).digest('hex');
        assert.strictEqual(manifest.hash, expected);

        const buf = Buffer.from(data, 'base64');
        const outDir = path.join(distDir, '_unzip');
        await fs.ensureDir(outDir);
        unzipBuf(buf, outDir);
        assert.strictEqual(await fs.readFile(path.join(outDir, 'app.js'), 'utf8'), 'console.log(1)');
        assert.strictEqual(await fs.readFile(path.join(outDir, 'index.html'), 'utf8'), '<html>v1</html>');
        assert.strictEqual(await fs.readFile(path.join(outDir, 'sub', 'x.css'), 'utf8'), 'a{}');
    } finally { await cleanup(distDir); }
});

test('prepkg: hash меняется при изменении содержимого public', {skip: !hasTools}, async () => {
    const distDir = await makeTmpDir();
    try {
        const publicDir = await setupPublic(distDir);
        runPrepkg(distDir);
        const out = path.join(distDir, 'public.json');
        const h1 = JSON.parse(await fs.readFile(out, 'utf8')).manifest.hash;

        await fs.writeFile(path.join(publicDir, 'app.js'), 'console.log(2)');
        runPrepkg(distDir);
        const h2 = JSON.parse(await fs.readFile(out, 'utf8')).manifest.hash;

        assert.notStrictEqual(h1, h2);
    } finally { await cleanup(distDir); }
});

test('prepkg: --no-readme не создаёт readme.html', {skip: !hasTools}, async () => {
    const distDir = await makeTmpDir();
    try {
        await setupPublic(distDir);
        runPrepkg(distDir);
        assert.ok(!await fs.pathExists(path.join(distDir, 'linux', 'readme.html')));
    } finally { await cleanup(distDir); }
});