const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const path = require('path');

const { jxlConvert, isJxlBuffer, isPngBuffer, isJpgBuffer, readArchiveEntry, listArchiveEntries } = require('../../server/core/book/bookImages');
const { makeTmpDir, cleanup } = require('../helpers/tmpdir');
const { hasDjxl } = require('../helpers/tools');
const { makeZip } = require('../helpers/zip');
const { make7z } = require('../helpers/sevenZip');
const { has7z } = require('../helpers/tools');
const { MINIMAL_JXL_B64, SIG } = require('../helpers/jxl');

test('is*Buffer: магические байты', () => {
    // сигнатуры + хвост (реальные файлы длиннее 2 байт; is*Buffer требует length > 2)
    assert.strictEqual(isJxlBuffer(Buffer.from([0xFF, 0x0A, 0xFA, 0x13])), true);
    assert.strictEqual(isJxlBuffer(Buffer.from([0xFF, 0xD8, 0xFF, 0xE0])), false);
    assert.strictEqual(isPngBuffer(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])), true);
    assert.strictEqual(isJpgBuffer(Buffer.from([0xFF, 0xD8, 0xFF, 0xE0])), true);
    assert.strictEqual(isJxlBuffer(Buffer.alloc(0)), false);
    assert.strictEqual(isPngBuffer(Buffer.alloc(0)), false);
    assert.strictEqual(isJpgBuffer(Buffer.alloc(0)), false);
});

test('jxlConvert: солянка (JXL→JPEG, PNG/JPEG — как есть)', {skip: !hasDjxl()}, async () => {
    const dir = await makeTmpDir();
    try {
        const jxl = Buffer.from(MINIMAL_JXL_B64, 'base64');
        const {outputImg: jpgOut, ext: jpgExt} = await jxlConvert(jxl, dir, 'a');
        assert.strictEqual(jpgExt, 'jpeg');
        assert.ok((await fs.readFile(jpgOut)).subarray(0, 3).equals(SIG.jpeg));

        const png = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
        const {outputImg: pngOut, ext: pngExt} = await jxlConvert(png, dir, 'b');
        assert.strictEqual(pngExt, 'png');
        assert.deepStrictEqual(await fs.readFile(pngOut), png);

        const jpg = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]);
        const {outputImg: jpgOut2, ext: jpgExt2} = await jxlConvert(jpg, dir, 'c');
        assert.strictEqual(jpgExt2, 'jpeg');
        assert.deepStrictEqual(await fs.readFile(jpgOut2), jpg);
    } finally { await cleanup(dir); }
});

test('readArchiveEntry/listArchiveEntries: zip (ZipReader)', async () => {
    const dir = await makeTmpDir();
    try {
        const zipPath = require('path').join(dir, 'a.zip');
        await require('../helpers/zip').makeZip(zipPath, { 'f.txt': 'hello', 'sub/g.txt': 'world' });

        const entries = await listArchiveEntries(zipPath);
        assert.deepStrictEqual(entries.sort(), ['f.txt', 'sub/g.txt']);
        assert.strictEqual((await readArchiveEntry(zipPath, 'f.txt')).toString(), 'hello');
        assert.strictEqual(await readArchiveEntry(zipPath, 'missing'), null);
    } finally { await cleanup(dir); }
});

test('readArchiveEntry/listArchiveEntries: 7z (fallback на Bad archive)', {skip: !has7z()}, async () => {
    const dir = await makeTmpDir();
    try {
        const path = require('path');
        const { execFileSync } = require('child_process');
        const SevenZipHelper = require('../../server/core/SevenZipHelper');
        const src = path.join(dir, 'a.txt');
        await fs.writeFile(src, 'hello-7z');
        const archive = path.join(dir, 'a.7z');
        execFileSync(SevenZipHelper.getSevenZipPath(), ['a', archive, src], {stdio: 'ignore'});

        const entries = await listArchiveEntries(archive);
        assert.ok(entries.includes('a.txt'));
        assert.strictEqual((await readArchiveEntry(archive, 'a.txt')).toString(), 'hello-7z');
    } finally { await cleanup(dir); }
});

test('readArchiveEntry/listArchiveEntries: zip', async () => {
    const dir = await makeTmpDir();
    try {
        const zipPath = path.join(dir, 'a.zip');
        await makeZip(zipPath, {'f.txt': 'hello', 'sub/g.txt': 'world'});
        const entries = await listArchiveEntries(zipPath);
        assert.deepStrictEqual(entries.sort(), ['f.txt', 'sub/g.txt']);
        assert.strictEqual((await readArchiveEntry(zipPath, 'f.txt')).toString(), 'hello');
        assert.strictEqual(await readArchiveEntry(zipPath, 'missing'), null);
    } finally { await cleanup(dir); }
});

test('readArchiveEntry/listArchiveEntries: 7z (fallback)', {skip: !has7z()}, async () => {
    const dir = await makeTmpDir();
    try {
        const sevenZipPath = make7z(dir, 'a.7z', {'a.txt': Buffer.from('hello-7z')});
        const entries = await listArchiveEntries(sevenZipPath);
        assert.ok(entries.includes('a.txt'));
        assert.strictEqual((await readArchiveEntry(sevenZipPath, 'a.txt')).toString(), 'hello-7z');
    } finally { await cleanup(dir); }
});