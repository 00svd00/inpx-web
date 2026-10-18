const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const path = require('path');
const { execFileSync } = require('child_process');
const SevenZipHelper = require('../../server/core/SevenZipHelper');
const ZipReader = require('../../server/core/ZipReader');
const { makeTmpDir, cleanup } = require('../helpers/tmpdir');
const { resetSingletons } = require('../helpers/instances');
const { has7z } = require('../helpers/tools');

test('getSevenZipPath: не бросает, возвращает строку', () => {
    resetSingletons();
    assert.strictEqual(typeof SevenZipHelper.getSevenZipPath(), 'string');
});

test('getSevenZipPath: идемпотентен (кэш _sevenZipCmd)', () => {
    resetSingletons();
    assert.strictEqual(SevenZipHelper.getSevenZipPath(), SevenZipHelper.getSevenZipPath());
});

test('getSevenZipPath: невалидный _configuredPath → fallback, не бросает', () => {
    resetSingletons();
    SevenZipHelper.setSevenZipPath('/nonexistent/7z-xyz');
    assert.strictEqual(typeof SevenZipHelper.getSevenZipPath(), 'string');
});

test('getSevenZipPath: валидный _configuredPath → возвращает его', {skip: !has7z()}, () => {
    resetSingletons();
    const p = SevenZipHelper.getSevenZipPath();
    SevenZipHelper.setSevenZipPath(p);
    SevenZipHelper._sevenZipCmd = undefined;
    assert.strictEqual(SevenZipHelper.getSevenZipPath(), p);
});

test('list/extract/extractAll на реальном 7z', {skip: !has7z()}, async () => {
    resetSingletons();
    const dir = await makeTmpDir();
    try {
        const src = path.join(dir, 'a.txt');
        await fs.writeFile(src, 'hello-7z');
        const archive = path.join(dir, 'a.7z');
        execFileSync(SevenZipHelper.getSevenZipPath(), ['a', archive, src], {stdio: 'ignore'});

        const h = new SevenZipHelper();
        assert.ok((await h.list(archive)).includes('a.txt'));
        assert.strictEqual((await h.extract(archive, 'a.txt')).toString('utf8'), 'hello-7z');

        const outDir = path.join(dir, 'out');
        await fs.ensureDir(outDir);
        await h.extractAll(archive, outDir);
        assert.strictEqual(await fs.readFile(path.join(outDir, 'a.txt'), 'utf8'), 'hello-7z');
    } finally { await cleanup(dir); resetSingletons(); }
});

test('PPMd (метод 98): ZipReader fallback на 7z', {skip: !has7z()}, async () => {
    resetSingletons();
    const dir = await makeTmpDir();
    try {
        const src = path.join(dir, 'p.txt');
        await fs.writeFile(src, 'ppmd-data');
        const zipArchive = path.join(dir, 'p.zip');
        execFileSync(SevenZipHelper.getSevenZipPath(), ['a', '-tzip', '-mm=PPMd', zipArchive, src], {stdio: 'ignore'});

        const zr = new ZipReader();
        await zr.open(zipArchive);
        try {
            assert.strictEqual((await zr.extractToBuf('p.txt')).toString('utf8'), 'ppmd-data');
        } finally { await zr.close(); }
    } finally { await cleanup(dir); resetSingletons(); }
});