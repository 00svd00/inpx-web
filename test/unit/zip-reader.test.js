const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const path = require('path');
const ZipReader = require('../../server/core/ZipReader');
const SevenZipHelper = require('../../server/core/SevenZipHelper');
const { makeZip } = require('../helpers/zip');
const { makeTmpDir, cleanup } = require('../helpers/tmpdir');
const { resetSingletons } = require('../helpers/instances');

test('open/extractToBuf/extractToFile/extractAllToDir/close', async () => {
    const dir = await makeTmpDir();
    try {
        const zipFile = path.join(dir, 'a.zip');
        await makeZip(zipFile, { 'f1.txt': 'hello', 'sub/f2.txt': 'world' });

        const zr = new ZipReader();
        await zr.open(zipFile);
        assert.ok(zr.entries);

        const buf = await zr.extractToBuf('f1.txt');
        assert.strictEqual(buf.toString(), 'hello');

        const out = path.join(dir, 'out.txt');
        await zr.extractToFile('f1.txt', out);
        assert.strictEqual(await fs.readFile(out, 'utf8'), 'hello');

        const outDir = path.join(dir, 'all');
        await zr.extractAllToDir(outDir);
        assert.strictEqual(await fs.readFile(path.join(outDir, 'f1.txt'), 'utf8'), 'hello');

        await zr.close();
    } finally { await cleanup(dir); }
});

test('fallback: Unknown compression method + нет 7z → понятная ошибка', async () => {
    const dir = await makeTmpDir();
    try {
        resetSingletons();
        SevenZipHelper._sevenZipCmd = ''; // 7z «не найден»
        const zipFile = path.join(dir, 'b.zip');
        await makeZip(zipFile, { 'f.txt': 'x' });

        const zr = new ZipReader();
        await zr.open(zipFile);
        // подменяем entryData, чтобы сымитировать PPMd
        zr.zip.entryData = async () => { const e = new Error('Unknown compression method: 98'); throw e; };

        await assert.rejects(
            () => zr.extractToBuf('f.txt'),
            /Install 7-Zip/
        );
        await zr.close();
    } finally { await cleanup(dir); resetSingletons(); }
});