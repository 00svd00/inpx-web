const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');

const epubAppendImages = require('../../server/core/book/epubAppendImages');
const { makeTmpDir, cleanup } = require('../helpers/tmpdir');
const { has7z, hasDjxl } = require('../helpers/tools');
const { MINIMAL_JXL_B64, SIG } = require('../helpers/jxl');
const { makeEpub7z, makeEpubZip } = require('../helpers/epub');
const { makeLib } = require('../helpers/book');
const { readZip } = require('../helpers/zip');

const hasTools = has7z() && hasDjxl();

async function makeEnv(dir) {
    const libDir = path.join(dir, 'lib');
    const tempDir = path.join(dir, 'tmp');
    await fs.ensureDir(libDir);
    await fs.ensureDir(tempDir);
    return {libDir, tempDir};
}

async function sha256File(f) {
    const buf = await fs.readFile(f);
    return crypto.createHash('sha256').update(buf).digest('hex');
}

test('epubAppendImages: 7z-внутренний, манифест, full-path=content.opf', {skip: !hasTools}, async () => {
    const dir = await makeTmpDir();
    try {
        const {libDir, tempDir} = await makeEnv(dir);
        const libFolder = 'lib0.zip';
        const fileName = '673407.epub';
        const bookId = '673407';
        const jxl = Buffer.from(MINIMAL_JXL_B64, 'base64');

        const sevenZipPath = makeEpub7z(dir, 'src.7z', {
            bookId,
            fullPath: 'content.opf',
            files: {
                'coverpage.xhtml': Buffer.from('<html><body><img src="cover.jpg"/></body></html>'),
                'index_split_000.html': Buffer.from('<html><body><img src="index-1_1.jpg"/></body></html>'),
            },
        });
        await makeLib(libDir, {
            libFolder,
            covers: {[bookId]: jxl},
            images: {[`${bookId}/1`]: jxl},
        });

        const outZip = path.join(dir, 'out.epub');
        await epubAppendImages({libDir, tempDir}, libFolder, fileName, sevenZipPath, outZip);

        const {entries, data} = await readZip(outZip);
        assert.ok(entries.includes('mimetype'));
        assert.strictEqual(data['mimetype'].toString(), 'application/epub+zip');
        assert.ok(entries.includes('META-INF/container.xml'));
        assert.ok(entries.includes('content.opf'));
        assert.ok(entries.includes('cover.jpg'));
        assert.ok(entries.includes('index-1_1.jpg'));
        assert.ok(data['cover.jpg'].subarray(0, 3).equals(SIG.jpeg));
        assert.ok(data['index-1_1.jpg'].subarray(0, 3).equals(SIG.jpeg));
        assert.ok(!entries.includes('FLibraryImageIndex.json'));
        assert.ok(!entries.some(e => e.startsWith(`${bookId}/`)));
    } finally { await cleanup(dir); }
});

test('epubAppendImages: 7z-внутренний, full-path=OEBPS/content.opf', {skip: !hasTools}, async () => {
    const dir = await makeTmpDir();
    try {
        const {libDir, tempDir} = await makeEnv(dir);
        const libFolder = 'lib0.zip';
        const bookId = '673407';
        const jxl = Buffer.from(MINIMAL_JXL_B64, 'base64');

        const sevenZipPath = makeEpub7z(dir, 'src.7z', {
            bookId,
            fullPath: 'OEBPS/content.opf',
            manifest: [{id: 'OEBPS/cover.jpg', num: -1}],   // id от корня epub (с OEBPS/),
        });
        await makeLib(libDir, {libFolder, covers: {[bookId]: jxl}});

        const outZip = path.join(dir, 'out.epub');
        await epubAppendImages({libDir, tempDir}, libFolder, '673407.epub', sevenZipPath, outZip);

        const {entries, data} = await readZip(outZip);
        assert.ok(entries.includes('mimetype'));
        assert.ok(entries.includes('META-INF/container.xml'));
        assert.ok(entries.includes('OEBPS/content.opf'));
        assert.ok(entries.includes('OEBPS/cover.jpg'));
        assert.ok(data['OEBPS/cover.jpg'].subarray(0, 3).equals(SIG.jpeg));
        assert.ok(!entries.includes('FLibraryImageIndex.json'));
        assert.ok(!entries.some(e => e.startsWith(`${bookId}/`)));
    } finally { await cleanup(dir); }
});

test('epubAppendImages: 7z-внутренний без манифеста → выпрямление', {skip: !has7z()}, async () => {
    const dir = await makeTmpDir();
    try {
        const {libDir, tempDir} = await makeEnv(dir);
        const bookId = '673407';

        const sevenZipPath = makeEpub7z(dir, 'src.7z', {bookId, fullPath: 'content.opf', manifest: null});

        const outZip = path.join(dir, 'out.epub');
        await epubAppendImages({libDir, tempDir}, 'lib0.zip', '673407.epub', sevenZipPath, outZip);

        const {entries} = await readZip(outZip);
        assert.ok(entries.includes('mimetype'));
        assert.ok(entries.includes('META-INF/container.xml'));
        assert.ok(entries.includes('content.opf'));
        assert.ok(!entries.some(e => e.startsWith(`${bookId}/`)));
        assert.ok(!entries.includes('FLibraryImageIndex.json'));
    } finally { await cleanup(dir); }
});

test('epubAppendImages: zip-внутренний (формат 1) → как есть', async () => {
    const dir = await makeTmpDir();
    try {
        const {libDir, tempDir} = await makeEnv(dir);
        const epubPath = path.join(dir, 'src.epub');
        await makeEpubZip(epubPath);
        const before = await fs.readFile(epubPath);

        const outZip = path.join(dir, 'out.epub');
        await epubAppendImages({libDir, tempDir}, 'lib0.zip', 'book.epub', epubPath, outZip);
        assert.deepStrictEqual(await fs.readFile(outZip), before);
    } finally { await cleanup(dir); }
});

test('epubAppendImages: 7z-не наш контейнер → как есть', {skip: !has7z()}, async () => {
    const dir = await makeTmpDir();
    try {
        const {libDir, tempDir} = await makeEnv(dir);
        const sevenZipPath = require('../helpers/sevenZip').make7z(dir, 'src.7z', {'foo.txt': Buffer.from('hello')});
        const before = await fs.readFile(sevenZipPath);

        const outZip = path.join(dir, 'out.epub');
        await epubAppendImages({libDir, tempDir}, 'lib0.zip', 'book.epub', sevenZipPath, outZip);
        assert.deepStrictEqual(await fs.readFile(outZip), before);
    } finally { await cleanup(dir); }
});

test('epubAppendImages: стабильный hash (mtime=1980), два прогона', {skip: !has7z()}, async () => {
    const dir = await makeTmpDir();
    try {
        const {libDir, tempDir} = await makeEnv(dir);
        const sevenZipPath = makeEpub7z(dir, 'src.7z', {bookId: '673407', fullPath: 'content.opf', manifest: null});

        const out1 = path.join(dir, 'out1.epub');
        const out2 = path.join(dir, 'out2.epub');
        await epubAppendImages({libDir, tempDir}, 'lib0.zip', '673407.epub', sevenZipPath, out1);
        await epubAppendImages({libDir, tempDir}, 'lib0.zip', '673407.epub', sevenZipPath, out2);

        assert.strictEqual(await sha256File(out1), await sha256File(out2));

        const {entries, data} = await readZip(out1);
        assert.ok(entries.includes('mimetype'));
        assert.strictEqual(data['mimetype'].toString(), 'application/epub+zip');
        assert.ok(entries.includes('content.opf'));
    } finally { await cleanup(dir); }
});