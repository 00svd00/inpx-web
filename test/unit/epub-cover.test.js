const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { extractEpubCover } = require('../../server/core/epub/epubCover');
const { makeEpubZip } = require('../helpers/epub');
const { makeTmpDir, cleanup } = require('../helpers/tmpdir');
const { SIG } = require('../helpers/jxl');

// минимальные «картинки»: isJpgBuffer/isPngBuffer смотрят только на первые байты
const JPEG = Buffer.concat([SIG.jpeg, Buffer.from([0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46])]);
const PNG = Buffer.concat([SIG.png, Buffer.from([0x00, 0x00, 0x00, 0x0D])]);

function opf(manifestXml, metadataXml = '') {
    return `<?xml version="1.0" encoding="utf-8"?><package version="3.0">`
        + `<metadata>${metadataXml}</metadata>`
        + `<manifest>${manifestXml}</manifest>`
        + `</package>`;
}

test('epubCover: properties="cover-image" → .jpg', async () => {
    const dir = await makeTmpDir();
    try {
        const zip = path.join(dir, 'b.epub');
        await makeEpubZip(zip, {
            fullPath: 'content.opf',
            files: {
                'content.opf': Buffer.from(opf(
                    '<item id="c" href="cover.jpg" media-type="image/jpeg" properties="cover-image"/>'
                )),
                'cover.jpg': JPEG,
            },
        });
        const res = await extractEpubCover(zip);
        assert.ok(res);
        assert.strictEqual(res.ext, '.jpg');
        assert.deepStrictEqual(res.buffer, JPEG);
    } finally { await cleanup(dir); }
});

test('epubCover: meta name="cover" + id → .jpg (резолв от OEBPS/)', async () => {
    const dir = await makeTmpDir();
    try {
        const zip = path.join(dir, 'b.epub');
        await makeEpubZip(zip, {
            fullPath: 'OEBPS/content.opf',
            files: {
                'OEBPS/content.opf': Buffer.from(opf(
                    '<item id="cov" href="Images/cover.jpg" media-type="image/jpeg"/>',
                    '<meta name="cover" content="cov"/>'
                )),
                'OEBPS/Images/cover.jpg': JPEG,
            },
        });
        const res = await extractEpubCover(zip);
        assert.ok(res);
        assert.strictEqual(res.ext, '.jpg');
        assert.deepStrictEqual(res.buffer, JPEG);
    } finally { await cleanup(dir); }
});

test('epubCover: id="cover" → .png (по сигнатуре)', async () => {
    const dir = await makeTmpDir();
    try {
        const zip = path.join(dir, 'b.epub');
        await makeEpubZip(zip, {
            fullPath: 'content.opf',
            files: {
                'content.opf': Buffer.from(opf(
                    '<item id="cover" href="cover.png" media-type="image/png"/>'
                )),
                'cover.png': PNG,
            },
        });
        const res = await extractEpubCover(zip);
        assert.ok(res);
        assert.strictEqual(res.ext, '.png');
        assert.deepStrictEqual(res.buffer, PNG);
    } finally { await cleanup(dir); }
});

test('epubCover: fallback Cover.jpg в корне (OPF без маркера)', async () => {
    const dir = await makeTmpDir();
    try {
        const zip = path.join(dir, 'b.epub');
        await makeEpubZip(zip, {
            fullPath: 'content.opf',
            files: {
                'content.opf': Buffer.from(opf(
                    '<item id="x" href="page.xhtml" media-type="application/xhtml+xml"/>'
                )),
                'Cover.jpg': JPEG,
            },
        });
        const res = await extractEpubCover(zip);
        assert.ok(res);
        assert.strictEqual(res.ext, '.jpg');
        assert.deepStrictEqual(res.buffer, JPEG);
    } finally { await cleanup(dir); }
});

test('epubCover: fallback OEBPS/images/cover.jpg', async () => {
    const dir = await makeTmpDir();
    try {
        const zip = path.join(dir, 'b.epub');
        await makeEpubZip(zip, {
            fullPath: 'OEBPS/content.opf',
            files: {
                'OEBPS/content.opf': Buffer.from(opf(
                    '<item id="x" href="page.xhtml" media-type="application/xhtml+xml"/>'
                )),
                'OEBPS/images/cover.jpg': JPEG,
            },
        });
        const res = await extractEpubCover(zip);
        assert.ok(res);
        assert.strictEqual(res.ext, '.jpg');
        assert.deepStrictEqual(res.buffer, JPEG);
    } finally { await cleanup(dir); }
});

test('epubCover: нет обложки → null', async () => {
    const dir = await makeTmpDir();
    try {
        const zip = path.join(dir, 'b.epub');
        await makeEpubZip(zip, {
            fullPath: 'content.opf',
            files: {
                'content.opf': Buffer.from(opf(
                    '<item id="x" href="page.xhtml" media-type="application/xhtml+xml"/>'
                )),
            },
        });
        assert.strictEqual(await extractEpubCover(zip), null);
    } finally { await cleanup(dir); }
});

test('epubCover: не zip (gzip/мусор) → null', async () => {
    const dir = await makeTmpDir();
    try {
        const f = path.join(dir, 'b.epub');
        // gzip-магия
        require('fs-extra').writeFileSync(f, Buffer.from([0x1F, 0x8B, 0x08, 0x00]));
        assert.strictEqual(await extractEpubCover(f), null);
        // просто мусор
        require('fs-extra').writeFileSync(f, Buffer.from('not a zip'));
        assert.strictEqual(await extractEpubCover(f), null);
    } finally { await cleanup(dir); }
});

test('epubCover: ext по сигнатуре, не по имени', async () => {
    const dir = await makeTmpDir();
    try {
        // cover.png с JPEG-байтами → .jpg
        let zip = path.join(dir, 'a.epub');
        await makeEpubZip(zip, {
            fullPath: 'content.opf',
            files: {
                'content.opf': Buffer.from(opf('<item id="cover" href="cover.png" media-type="image/png"/>')),
                'cover.png': JPEG,
            },
        });
        let res = await extractEpubCover(zip);
        assert.ok(res);
        assert.strictEqual(res.ext, '.jpg');

        // cover.jpg с PNG-байтами → .png
        zip = path.join(dir, 'c.epub');
        await makeEpubZip(zip, {
            fullPath: 'content.opf',
            files: {
                'content.opf': Buffer.from(opf('<item id="cover" href="cover.jpg" media-type="image/jpeg"/>')),
                'cover.jpg': PNG,
            },
        });
        res = await extractEpubCover(zip);
        assert.ok(res);
        assert.strictEqual(res.ext, '.png');
    } finally { await cleanup(dir); }
});