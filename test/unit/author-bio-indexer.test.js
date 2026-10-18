const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const path = require('path');
const AuthorBioIndexer = require('../../server/core/AuthorBioIndexer');
const FakeDb = require('../helpers/fakeDb');
const FakeArchive = require('../helpers/fakeArchive');
const { makeTmpDir, cleanup } = require('../helpers/tmpdir');

test('build: «последний wins» — дубли по hash, наибольший archiveId', async () => {
    const dir = await makeTmpDir();
    try {
        const authorsDir = path.join(dir, 'etc', 'authors');
        await fs.ensureDir(authorsDir);
        await fs.writeFile(path.join(authorsDir, '0.7z'), '');
        await fs.writeFile(path.join(authorsDir, '5.7z'), '');
        await fs.writeFile(path.join(authorsDir, '10.7z'), '');

        const a0 = path.join(authorsDir, '0.7z');
        const a5 = path.join(authorsDir, '5.7z');
        const a10 = path.join(authorsDir, '10.7z');

        const fake = new FakeArchive({
            lists: new Map([
                [a0, ['deadbeef', 'aaa']],
                [a5, ['deadbeef']],
                [a10, ['deadbeef', 'bbb']],
            ]),
        });

        const db = new FakeDb();
        const indexer = new AuthorBioIndexer({libDir: dir, lowMemoryMode: false});
        indexer.archive = fake;

        const len = await indexer.build(db, () => {});

        assert.strictEqual(len, 3);
        const rows = db.tables.get('authors_info');
        const byHash = new Map(rows.map(r => [r._uid, r.archiveId]));

        assert.strictEqual(byHash.get('deadbeef'), '10');
        assert.strictEqual(byHash.get('aaa'), '0');
        assert.strictEqual(byHash.get('bbb'), '10');
        assert.ok(db.hashes.get('authors_info').has('_uid'));
    } finally { await cleanup(dir); }
});

test('build: нет архивов → 0', async () => {
    const dir = await makeTmpDir();
    try {
        await fs.ensureDir(path.join(dir, 'etc', 'authors'));
        const db = new FakeDb();
        const indexer = new AuthorBioIndexer({libDir: dir, lowMemoryMode: false});
        indexer.archive = new FakeArchive({});
        assert.strictEqual(await indexer.build(db, () => {}), 0);
    } finally { await cleanup(dir); }
});