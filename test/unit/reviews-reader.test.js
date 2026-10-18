const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const path = require('path');
const zlib = require('zlib');
const ReviewsReader = require('../../server/core/ReviewsReader');
const FakeDb = require('../helpers/fakeDb');
const FakeArchive = require('../helpers/fakeArchive');
const { makeTmpDir, cleanup } = require('../helpers/tmpdir');

function makeReader(db, config, archive) {
    const reader = new ReviewsReader(config, db);
    if (archive) reader.archive = archive;
    return reader;
}

test('getCount: .zip → .7z нормализация, нет записи → {0,0}', async () => {
    const db = new FakeDb();
    db.tables.set('reviews_index', []);
    const reader = makeReader(db, { bookDir: '/tmp' });
    const res = await reader.getCount('folder.zip', 'file.fb2');
    assert.deepStrictEqual(res, { declaredCount: 0, sum: 0 });
});

test('read: !libDir → без архивов, пустой результат', async () => {
    const db = new FakeDb();
    db.tables.set('reviews_index', []);
    const reader = makeReader(db, { bookDir: '/tmp', libDir: '' });
    const res = await reader.read('f', 'file', '');
    assert.deepStrictEqual(res.reviews, []);
});

test('read: кэш gzip + months совпадают → cached', async () => {
    const dir = await makeTmpDir();
    try {
        const db = new FakeDb();
        db.tables.set('reviews_index', [
            { _uid: 'f#file', declaredCount: 2, sum: 10, months: ['202401'] },
        ]);
        const reader = makeReader(db, { bookDir: dir, libDir: '' });
        const hash = 'h1';
        const cached = { declaredCount: 0, sum: 0, foundCount: 1, reviews: [{ name: 'x', text: 'y', time: '' }], months: ['202401'] };
        await fs.writeFile(path.join(dir, `${hash}.review`), zlib.gzipSync(JSON.stringify(cached)));

        const res = await reader.read('f', 'file', hash);
        assert.strictEqual(res.declaredCount, 2);
        assert.strictEqual(res.sum, 10);
        assert.strictEqual(res.reviews.length, 1);
    } finally { await cleanup(dir); }
});

test('read: months не совпадают → кэш удаляется, идёт в архив (fake)', async () => {
    const dir = await makeTmpDir();
    try {
        const db = new FakeDb();
        db.tables.set('reviews_index', [
            { _uid: 'f#file', declaredCount: 1, sum: 5, months: ['202402'] },
        ]);
        const hash = 'h2';
        const cached = { reviews: [], months: ['202401'] };
        await fs.writeFile(path.join(dir, `${hash}.review`), zlib.gzipSync(JSON.stringify(cached)));

        const fake = new FakeArchive({
            files: new Map([[`${path.join('', 'etc', 'reviews', '202402.7z')}#f#file`, Buffer.from(JSON.stringify([{ name: 'n', text: 't', time: '2024-02' }]))]]),
        });
        const reader = makeReader(db, { bookDir: dir, libDir: '/lib' }, fake);
        // путь архива строится из config.libDir — подменим reviewsDir
        reader.reviewsDir = path.join('', 'etc', 'reviews');

        const res = await reader.read('f', 'file', hash);
        assert.strictEqual(res.reviews.length, 1);
        assert.deepStrictEqual(res.months, ['202402']);
    } finally { await cleanup(dir); }
});

test('read: битый gzip → кэш удаляется, не падает', async () => {
    const dir = await makeTmpDir();
    try {
        const db = new FakeDb();
        db.tables.set('reviews_index', [
            { _uid: 'f#file', declaredCount: 1, sum: 1, months: [] },
        ]);
        const hash = 'h3';
        await fs.writeFile(path.join(dir, `${hash}.review`), Buffer.from('not gzip'));
        const reader = makeReader(db, { bookDir: dir, libDir: '' });
        const res = await reader.read('f', 'file', hash);
        assert.strictEqual(res.reviews.length, 0);
        assert.ok(!await fs.pathExists(path.join(dir, `${hash}.review`)));
    } finally { await cleanup(dir); }
});