const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const path = require('path');
const { execFileSync } = require('child_process');
const yazl = require('yazl');

const Fb2AppendImages = require('../../server/core/Fb2AppendImages');
const SevenZipHelper = require('../../server/core/SevenZipHelper');
const { resolveDjxl } = require('../../server/core/DjxlResolver');
const { makeTmpDir, cleanup } = require('../helpers/tmpdir');
const { resetSingletons } = require('../helpers/instances');
const { has7z, hasDjxl } = require('../helpers/tools');
const { MINIMAL_JXL_B64, SIG, pngSize } = require('../helpers/jxl');

const hasTools = has7z() && hasDjxl();

function makeZip(zipFile, files) {
    return new Promise(async (resolve, reject) => {
        try {
            await fs.ensureDir(path.dirname(zipFile));
        } catch (e) {
            return reject(e);
        }
        const zip = new yazl.ZipFile();
        for (const [name, buf] of files)
            zip.addBuffer(buf, name);
        zip.outputStream
            .pipe(fs.createWriteStream(zipFile))
            .on('error', reject)
            .on('finish', () => resolve(zipFile));
        zip.end();
    });
}

const FB2 = '<?xml version="1.0" encoding="utf-8"?>\n<FictionBook><description><title-info><book-title>T</book-title></title-info></description><body><section><p>x</p></section></body></FictionBook>';

async function make7z(libDir, libName, fb2Path) {
    const archive = path.join(libDir, `${libName}.7z`);
    execFileSync(SevenZipHelper.getSevenZipPath(), ['a', archive, fb2Path], {stdio: 'ignore'});
    return archive;
}

test('Fb2AppendImages: JXL→JPEG; полученный JPEG и PNG не трогаются; content-type по имени',
    {skip: !hasTools}, async () => {
    resetSingletons();
    const dir = await makeTmpDir();
    try {
        const libDir = path.join(dir, 'lib');
        const tempDir = path.join(dir, 'tmp');
        await fs.ensureDir(libDir);
        await fs.ensureDir(tempDir);

        const fileName = 'book.fb2';
        const bookId = 'book';
        const fb2Path = path.join(dir, fileName);
        await fs.writeFile(fb2Path, FB2, 'utf8');

        const jxl = Buffer.from(MINIMAL_JXL_B64, 'base64');

        // PNG на лету из JXL (JPEG получим из прогона 1 — это валидный выход djxl)
        const jxlPath = path.join(dir, 'src.jxl');
        await fs.writeFile(jxlPath, jxl);
        const pngPath = path.join(dir, 'src.png');
        execFileSync(resolveDjxl(), [jxlPath, pngPath], {stdio: 'pipe'});
        const png = await fs.readFile(pngPath);
        assert.ok(png.subarray(0, 8).equals(SIG.png));
        assert.deepStrictEqual(pngSize(png), {width: 4, height: 4});

        // ---- Прогон 1: JXL (обложка, img1) + PNG (img3) ----
        await make7z(libDir, 'lib0', fb2Path);
        await makeZip(path.join(libDir, 'covers', 'lib0.zip'), [[bookId, jxl]]);
        await makeZip(path.join(libDir, 'images', 'lib0.zip'), [
            [`${bookId}_img1.jxl`, jxl],
            [`${bookId}_img3.png`, png],
        ]);

        const config = {libDir, tempDir, sevenZipPath: SevenZipHelper.getSevenZipPath()};
        const out1 = path.join(dir, 'out1.fb2');
        await Fb2AppendImages(config, 'lib0.zip', fileName, out1);
        const fb2_1 = await fs.readFile(out1, 'utf8');

        // обложка: JXL → JPEG; сохраняем валидный JPEG для прогона 2
        const cover = fb2_1.match(/<binary id="cover" content-type="image\/png">([^<]+)<\/binary>/);
        assert.ok(cover, 'cover: id="cover", content-type=image/png (by name)');
        const coverJpeg = Buffer.from(cover[1], 'base64');
        assert.ok(coverJpeg.subarray(0, 3).equals(SIG.jpeg), 'cover bytes must be JPEG (valid djxl output)');

        // img1.jxl: JXL → JPEG
        const img1 = fb2_1.match(new RegExp(`<binary id="${bookId}_img1.jxl" content-type="image/png">([^<]+)</binary>`));
        assert.ok(img1, 'img1: content-type=image/png (by name)');
        assert.ok(Buffer.from(img1[1], 'base64').subarray(0, 3).equals(SIG.jpeg), 'img1 bytes must be JPEG');

        // img3.png: PNG не трогается (байты совпадают)
        const img3 = fb2_1.match(new RegExp(`<binary id="${bookId}_img3.png" content-type="image/png">([^<]+)</binary>`));
        assert.ok(img3, 'img3: content-type=image/png');
        assert.deepStrictEqual(Buffer.from(img3[1], 'base64'), png, 'PNG must not be converted');

        // ---- Прогон 2: полученный JPEG (обложка и img2) ----
        await make7z(libDir, 'lib1', fb2Path);
        await makeZip(path.join(libDir, 'covers', 'lib1.zip'), [[bookId, coverJpeg]]);
        await makeZip(path.join(libDir, 'images', 'lib1.zip'), [
            [`${bookId}_img2.jpg`, coverJpeg],
        ]);

        const out2 = path.join(dir, 'out2.fb2');
        await Fb2AppendImages(config, 'lib1.zip', fileName, out2);
        const fb2_2 = await fs.readFile(out2, 'utf8');

        // обложка: JPEG не трогается (байты совпадают), content-type по имени = image/png
        const cover2 = fb2_2.match(/<binary id="cover" content-type="image\/png">([^<]+)<\/binary>/);
        assert.ok(cover2, 'cover2: id="cover", content-type=image/png');
        assert.deepStrictEqual(Buffer.from(cover2[1], 'base64'), coverJpeg, 'JPEG cover must not be converted');

        // img2.jpg: JPEG не трогается (байты совпадают), content-type = image/jpeg
        const img2 = fb2_2.match(new RegExp(`<binary id="${bookId}_img2.jpg" content-type="image/jpeg">([^<]+)</binary>`));
        assert.ok(img2, 'img2: content-type=image/jpeg');
        assert.deepStrictEqual(Buffer.from(img2[1], 'base64'), coverJpeg, 'JPEG must not be converted');

        assert.ok(fb2_1.includes('encoding="utf-8"'));
        assert.ok(fb2_2.includes('encoding="utf-8"'));
    } finally { await cleanup(dir); resetSingletons(); }
});

test('Fb2AppendImages: нет 7z → return без падения', async () => {
    const dir = await makeTmpDir();
    try {
        const config = {libDir: path.join(dir, 'lib'), tempDir: path.join(dir, 'tmp'), sevenZipPath: ''};
        await fs.ensureDir(config.libDir);
        await fs.ensureDir(config.tempDir);
        const outFile = path.join(dir, 'out.fb2');
        await Fb2AppendImages(config, 'lib0.zip', 'book.fb2', outFile);
        assert.ok(!await fs.pathExists(outFile));
    } finally { await cleanup(dir); resetSingletons(); }
});