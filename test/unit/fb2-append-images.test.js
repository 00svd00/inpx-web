const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const path = require('path');
const { execFileSync } = require('child_process');

const fb2AppendImages = require('../../server/core/book/fb2AppendImages');
const { resolveDjxl } = require('../../server/core/DjxlResolver');
const { makeTmpDir, cleanup } = require('../helpers/tmpdir');
const { hasDjxl } = require('../helpers/tools');
const { MINIMAL_JXL_B64, SIG } = require('../helpers/jxl');
const { makeLib, FB2 } = require('../helpers/book');

test('fb2AppendImages: JXL→JPEG; JPEG/PNG не трогаются; content-type по имени', {skip: !hasDjxl()}, async () => {
    const dir = await makeTmpDir();
    try {
        const libDir = path.join(dir, 'lib');
        const tempDir = path.join(dir, 'tmp');
        await fs.ensureDir(libDir);
        await fs.ensureDir(tempDir);

        const libFolder = 'lib0.zip';
        const fileName = 'book.fb2';
        const bookId = 'book';
        const jxl = Buffer.from(MINIMAL_JXL_B64, 'base64');

        // PNG — на лету из JXL (djxl)
        const jxlPath = path.join(dir, 'src.jxl');
        const pngPath = path.join(dir, 'src.png');
        await fs.writeFile(jxlPath, jxl);
        execFileSync(resolveDjxl(), [jxlPath, pngPath], {stdio: 'pipe'});
        const png = await fs.readFile(pngPath);
        assert.ok(png.subarray(0, 8).equals(SIG.png));

        const jpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01]);
        await makeLib(libDir, {
            libFolder,
            covers: {[bookId]: jxl},
            images: {
                [`${bookId}_img1.jxl`]: jxl,
                [`${bookId}_img2.jpg`]: jpeg,
                [`${bookId}_img3.png`]: png,
            },
        });

        const outFile = path.join(dir, 'out.fb2');
        await fb2AppendImages({libDir, tempDir}, libFolder, fileName, Buffer.from(FB2, 'utf8'), outFile);

        const out = await fs.readFile(outFile, 'utf8');
        assert.ok(out.includes('encoding="utf-8"'));

        const cover = out.match(/<binary id="cover" content-type="image\/png">([^<]+)<\/binary>/);
        assert.ok(cover, 'cover: id="cover", content-type=image/png (by name)');
        assert.ok(Buffer.from(cover[1], 'base64').subarray(0, 3).equals(SIG.jpeg));

        const img1 = out.match(/<binary id="book_img1.jxl" content-type="image\/png">([^<]+)<\/binary>/);
        assert.ok(img1, 'img1: content-type=image/png');
        assert.ok(Buffer.from(img1[1], 'base64').subarray(0, 3).equals(SIG.jpeg));

        const img2 = out.match(/<binary id="book_img2.jpg" content-type="image\/jpeg">([^<]+)<\/binary>/);
        assert.ok(img2);
        assert.deepStrictEqual(Buffer.from(img2[1], 'base64'), jpeg);

        const img3 = out.match(/<binary id="book_img3.png" content-type="image\/png">([^<]+)<\/binary>/);
        assert.ok(img3);
        assert.deepStrictEqual(Buffer.from(img3[1], 'base64'), png);
    } finally { await cleanup(dir); }
});

test('fb2AppendImages: без images — cover не теряется', {skip: !hasDjxl()}, async () => {
    const dir = await makeTmpDir();
    try {
        const libDir = path.join(dir, 'lib');
        const tempDir = path.join(dir, 'tmp');
        await fs.ensureDir(libDir);
        await fs.ensureDir(tempDir);

        const libFolder = 'lib0.zip';
        const bookId = 'book';
        const jxl = Buffer.from(MINIMAL_JXL_B64, 'base64');
        await makeLib(libDir, {libFolder, covers: {[bookId]: jxl}});   // images нет

        const outFile = path.join(dir, 'out.fb2');
        await fb2AppendImages({libDir, tempDir}, libFolder, 'book.fb2', Buffer.from(FB2, 'utf8'), outFile);

        const out = await fs.readFile(outFile, 'utf8');
        assert.ok(out.includes('<binary id="cover" content-type="image/png">'));
    } finally { await cleanup(dir); }
});