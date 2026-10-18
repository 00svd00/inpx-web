const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const path = require('path');
const zlib = require('zlib');
const DbCreator = require('../../server/core/DbCreator');
const FakeDb = require('../helpers/fakeDb');
const { makeTmpDir, cleanup } = require('../helpers/tmpdir');

test('loadIndexFromDump: columns → rows, чанки, hash-индекс, return len', async () => {
    const dir = await makeTmpDir();
    try {
        const cols = { _uid: ['a', 'b', 'c'], x: [1, 2, 3] };
        const gz = path.join(dir, 'dump.json.gz');
        await fs.writeFile(gz, zlib.gzipSync(JSON.stringify(cols)));

        const db = new FakeDb();
        const creator = new DbCreator({ lowMemoryMode: false, dataDir: dir });
        const progress = [];
        const len = await creator.loadIndexFromDump(db, 'reviews_index', gz, p => progress.push(p));

        assert.strictEqual(len, 3);
        assert.deepStrictEqual(db.tables.get('reviews_index'), [
            { _uid: 'a', x: 1 }, { _uid: 'b', x: 2 }, { _uid: 'c', x: 3 },
        ]);
        assert.ok(db.created.some(o => o.table === 'reviews_index'));
        assert.ok(db.hashes.get('reviews_index').has('_uid'));
        assert.strictEqual(progress[progress.length - 1].progress, 1);
    } finally { await cleanup(dir); }
});

test('loadIndexFromDump: пустой columns → 0, hash-индекс создан', async () => {
    const dir = await makeTmpDir();
    try {
        const gz = path.join(dir, 'empty.json.gz');
        await fs.writeFile(gz, zlib.gzipSync(JSON.stringify({})));
        const db = new FakeDb();
        const creator = new DbCreator({ lowMemoryMode: false, dataDir: dir });
        const len = await creator.loadIndexFromDump(db, 'authors_info', gz, () => {});
        assert.strictEqual(len, 0);
        assert.ok(db.hashes.get('authors_info').has('_uid'));
    } finally { await cleanup(dir); }
});