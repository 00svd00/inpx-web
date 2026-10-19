const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const path = require('path');
const { execFileSync } = require('child_process');

const BookAppendImages = require('../../server/core/BookAppendImages');
const SevenZipHelper = require('../../server/core/SevenZipHelper');
const { makeTmpDir, cleanup } = require('../helpers/tmpdir');
const { resetSingletons } = require('../helpers/instances');
const { has7z, hasDjxl } = require('../helpers/tools');
const { MINIMAL_JXL_B64, SIG } = require('../helpers/jxl');
const { make7z } = require('../helpers/sevenZip');
const { makeEpub7z } = require('../helpers/epub');
const { makeLib, FB2 } = require('../helpers/book');
const { readZip } = require('../helpers/zip');

const hasTools = has7z() && hasDjxl();

function make7zFromFile(libDir, libName, filePath) {
    const archive = path.join(libDir, `${libName}.7z`);
    execFileSync(SevenZipHelper.getSevenZipPath(), ['a', archive, filePath], {stdio: 'ignore'});
    return archive;
}

test('BookAppendImages: ext=epub → epub-обработчик (7z-в-7z)', {skip: !hasTools}, async () => {
    resetSingletons();
    const dir = await makeTmpDir();
    try {
        const libDir = path.join(dir, 'lib');
        const tempDir = path.join(dir, 'tmp');
        await fs.ensureDir(libDir);
        await fs.ensureDir(tempDir);

        const libFolder = 'lib0.zip';
        const bookId = '673407';
        const jxl = Buffer.from(MINIMAL_JXL_B64, 'base64');

        const epubPath = makeEpub7z(dir, '673407.epub', {
            bookId,
            fullPath: 'content.opf',
            manifest: [{id: 'cover.jpg', num: -1}],
        });
        make7zFromFile(libDir, 'lib0', epubPath);
        await makeLib(libDir, {libFolder, covers: {[bookId]: jxl}});

        const outFile = path.join(dir, 'out.epub');
        await BookAppendImages({libDir, tempDir, sevenZipPath: SevenZipHelper.getSevenZipPath()}, libFolder, '673407.epub', outFile);

        const {entries, data} = await readZip(outFile);
        assert.ok(entries.includes('mimetype'));
        assert.strictEqual(data['mimetype'].toString(), 'application/epub+zip');
        assert.ok(entries.includes('META-INF/container.xml'));
        assert.ok(entries.includes('content.opf'));
        assert.ok(entries.includes('cover.jpg'));
        assert.ok(data['cover.jpg'].subarray(0, 3).equals(SIG.jpeg));
        assert.ok(!entries.includes('FLibraryImageIndex.json'));
        assert.ok(!entries.some(e => e.startsWith(`${bookId}/`)));
    } finally { //await cleanup(dir); 
        resetSingletons(); }
});

test('BookAppendImages: ext=fb2 → fb2-обработчик (без images — cover не теряется)', {skip: !hasTools}, async () => {
    resetSingletons();
    const dir = await makeTmpDir();
    try {
        const libDir = path.join(dir, 'lib');
        const tempDir = path.join(dir, 'tmp');
        await fs.ensureDir(libDir);
        await fs.ensureDir(tempDir);

        const libFolder = 'lib0.zip';
        const bookId = 'book';
        const jxl = Buffer.from(MINIMAL_JXL_B64, 'base64');

        const fb2Path = path.join(dir, 'book.fb2');
        await fs.writeFile(fb2Path, FB2, 'utf8');
        make7zFromFile(libDir, 'lib0', fb2Path);
        await makeLib(libDir, {libFolder, covers: {[bookId]: jxl}});   // images нет

        const outFile = path.join(dir, 'out.fb2');
        await BookAppendImages({libDir, tempDir, sevenZipPath: SevenZipHelper.getSevenZipPath()}, libFolder, 'book.fb2', outFile);

        const out = await fs.readFile(outFile, 'utf8');
        assert.ok(out.includes('<binary id="cover" content-type="image/png">'));
        assert.ok(out.includes('encoding="utf-8"'));
    } finally { await cleanup(dir); resetSingletons(); }
});

test('BookAppendImages: ext=djvu → как есть', {skip: !has7z()}, async () => {
    resetSingletons();
    const dir = await makeTmpDir();
    try {
        const libDir = path.join(dir, 'lib');
        const tempDir = path.join(dir, 'tmp');
        await fs.ensureDir(libDir);
        await fs.ensureDir(tempDir);

        const djvuBytes = Buffer.from([0x41, 0x54, 0x26, 0x54, 0x46, 0x4F, 0x52, 0x4D]);
        const djvuPath = path.join(dir, 'book.djvu');
        await fs.writeFile(djvuPath, djvuBytes);
        make7zFromFile(libDir, 'lib0', djvuPath);

        const outFile = path.join(dir, 'out.djvu');
        await BookAppendImages({libDir, tempDir, sevenZipPath: SevenZipHelper.getSevenZipPath()}, 'lib0.zip', 'book.djvu', outFile);
        assert.deepStrictEqual(await fs.readFile(outFile), djvuBytes);
    } finally { await cleanup(dir); resetSingletons(); }
});

test('BookAppendImages: нет 7z → return без падения', async () => {
    const dir = await makeTmpDir();
    try {
        const config = {libDir: path.join(dir, 'lib'), tempDir: path.join(dir, 'tmp'), sevenZipPath: ''};
        await fs.ensureDir(config.libDir);
        await fs.ensureDir(config.tempDir);
        const outFile = path.join(dir, 'out.fb2');
        await BookAppendImages(config, 'lib0.zip', 'book.fb2', outFile);
        assert.ok(!await fs.pathExists(outFile));
    } finally { await cleanup(dir); resetSingletons(); }
});