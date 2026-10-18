const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const InpxParser = require('../../server/core/InpxParser');
const { makeZip } = require('../helpers/zip');
const { makeTmpDir, cleanup } = require('../helpers/tmpdir');

async function makeInpx(dir, { structure, collection, version, inpFiles }) {
    const zipFile = path.join(dir, 'test.inpx');
    const files = new Map();
    files.set('collection.info', collection || 'test');
    files.set('version.info', version || '1.0');
    if (structure) files.set('structure.info', structure);
    for (const [name, content] of Object.entries(inpFiles))
        files.set(name, content);
    await makeZip(zipFile, files);
    return zipFile;
}

test('parse: структура по умолчанию, folder по basename, author/genre нормализация, parseInt, _uid', async () => {
    const dir = await makeTmpDir();
    try {
        const line = 'Иванов,Иван:Петров,Пётр:Сергеев,Сергей,Сергеевич:Филипп,Ауреол,Теофраст Бомбаст фон Гогенгейм по прозвищу Парацельс\x04sf:detective\x04Title\x04Series\x042\x04file1\x041024\x04libid1\x040\x04fb2\x042024-01-01\x04ru\x045\x04kw';
        const zipFile = await makeInpx(dir, { inpFiles: { 'col1.inp': line + '\x0D\n' } });

        let chunk = null;
        const parser = new InpxParser();
        await parser.parse(zipFile, async () => {}, async (c) => { chunk = c; });

        assert.ok(chunk);
        assert.strictEqual(chunk.length, 1);
        const rec = chunk[0];
        assert.strictEqual(rec.folder, 'col1.zip');
        assert.strictEqual(rec.author, 'Иванов Иван,Петров Пётр,Сергеев Сергей Сергеевич,Филипп Ауреол Теофраст Бомбаст фон Гогенгейм по прозвищу Парацельс'); // ':' → ',', ',' → ' '
        assert.strictEqual(rec.genre, 'sf,detective');
        assert.strictEqual(rec.serno, 2);
        assert.strictEqual(rec.size, 1024);
        assert.strictEqual(rec.del, 0);
        assert.strictEqual(rec.librate, 5);
        assert.strictEqual(rec._uid, crypto.createHash('sha256').update(line).digest('base64'));
    } finally { await cleanup(dir); }
});

test('parse: info.collection/version/structure из .info', async () => {
    const dir = await makeTmpDir();
    try {
        const zipFile = await makeInpx(dir, {
            collection: 'MyLib', version: '2.0', structure: 'AUTHOR;TITLE;FILE',
            inpFiles: { 'c.inp': 'A\x04T\x04f\n' },
        });
        const parser = new InpxParser();
        await parser.parse(zipFile, async () => {}, async () => {});
        assert.strictEqual(parser.info.collection, 'MyLib');
        assert.strictEqual(parser.info.version, '2.0');
        assert.strictEqual(parser.info.structure, 'AUTHOR;TITLE;FILE');
    } finally { await cleanup(dir); }
});