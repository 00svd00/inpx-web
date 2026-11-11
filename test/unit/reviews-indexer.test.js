const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const path = require('path');
const ReviewsIndexer = require('../../server/core/ReviewsIndexer');
const FakeDb = require('../helpers/fakeDb');
const FakeArchive = require('../helpers/fakeArchive');
const { makeTmpDir, cleanup } = require('../helpers/tmpdir');

async function prepareReviewsDir(dir, {months = {}} = {}) {
    const reviewsDir = path.join(dir, 'etc', 'reviews');
    await fs.ensureDir(reviewsDir);
    const additionalZip = path.join(reviewsDir, 'additional.zip');
    await fs.writeFile(additionalZip, '');
    for (const m of Object.keys(months))
        await fs.writeFile(path.join(reviewsDir, `${m}.7z`), '');
    return {reviewsDir, additionalZip};
}

test('build: booksMap + monthsMap → rows, _uid = folder#file, hash-индекс', async () => {
    const dir = await makeTmpDir();
    try {
        const {reviewsDir, additionalZip} = await prepareReviewsDir(dir, {months: {'202401': 1, '202402': 1}});
        const a202401 = path.join(reviewsDir, '202401.7z');
        const a202402 = path.join(reviewsDir, '202402.7z');

        const fake = new FakeArchive({
            files: new Map([[`${additionalZip}#books.json`, Buffer.from(JSON.stringify([
                {count: 3, file: 'f1.fb2', folder: 'fo.7z', sum: 15},
                {count: 1, file: 'f2.fb2', folder: 'fo.7z', sum: 5},
            ]))]]),
            lists: new Map([
                [a202401, ['fo.7z#f1.fb2', 'fo.7z#f3.fb2']],
                [a202402, ['fo.7z#f1.fb2']],
            ]),
        });

        const db = new FakeDb();
        const bookRows = [
            {id: 1, folder: 'fo.zip', file: 'f1', ext: 'fb2'},
            {id: 2, folder: 'fo.zip', file: 'f2', ext: 'fb2'},
            {id: 3, folder: 'fo.zip', file: 'f3', ext: 'fb2'},
        ];
        const origSelect = db.select.bind(db);
        db.select = async (opts) => {
            if (opts.table === 'book' && opts.rawResult)
                return [{rawResult: bookRows}];
            return origSelect(opts);
        };
        const indexer = new ReviewsIndexer({libDir: dir, lowMemoryMode: false});
        indexer.archive = fake;

        const progress = [];
        const len = await indexer.build(db, p => progress.push(p));

        assert.strictEqual(len, 3);
        const rows = db.tables.get('reviews_index');
        const byUid = new Map(rows.map(r => [r._uid, r]));

        assert.deepStrictEqual(byUid.get('fo.7z#f1.fb2').months, ['202401', '202402']);
        assert.strictEqual(byUid.get('fo.7z#f1.fb2').declaredCount, 3);
        assert.strictEqual(byUid.get('fo.7z#f1.fb2').sum, 15);
        assert.strictEqual(byUid.get('fo.7z#f1.fb2').bookIds[0], 1);
        assert.deepStrictEqual(byUid.get('fo.7z#f2.fb2').months, []);
        assert.strictEqual(byUid.get('fo.7z#f2.fb2').declaredCount, 1);
        assert.strictEqual(byUid.get('fo.7z#f2.fb2').bookIds[0], 2);
        assert.deepStrictEqual(byUid.get('fo.7z#f3.fb2').months, ['202401']);
        assert.strictEqual(byUid.get('fo.7z#f3.fb2').declaredCount, 0);
        assert.strictEqual(byUid.get('fo.7z#f3.fb2').bookIds[0], 3);
        assert.ok(Array.isArray(byUid.get('fo.7z#f1.fb2').bookIds));

        assert.ok(db.hashes.get('reviews_index').has('_uid'));
        assert.strictEqual(progress[progress.length - 1].progress, 1);
    } finally { await cleanup(dir); }
});

test('build: нет YYYYMM-архивов → 0, progress 1', async () => {
    const dir = await makeTmpDir();
    try {
        const {additionalZip} = await prepareReviewsDir(dir, {months: {}});  // additional.zip есть, месяцев нет
        const db = new FakeDb();
        const bookRows = [
            {id: 1, folder: 'fo.zip', file: 'f1', ext: 'fb2'},
            {id: 2, folder: 'fo.zip', file: 'f2', ext: 'fb2'},
            {id: 3, folder: 'fo.zip', file: 'f3', ext: 'fb2'},
        ];
        const origSelect = db.select.bind(db);
        db.select = async (opts) => {
            if (opts.table === 'book' && opts.rawResult)
                return [{rawResult: bookRows}];
            return origSelect(opts);
        };
        const indexer = new ReviewsIndexer({libDir: dir, lowMemoryMode: false});
        indexer.archive = new FakeArchive({
            files: new Map([[`${additionalZip}#books.json`, Buffer.from('[]')]]),
        });
        const progress = [];
        const len = await indexer.build(db, p => progress.push(p));
        assert.strictEqual(len, 0);
        assert.strictEqual(progress[progress.length - 1].progress, 1);
    } finally { await cleanup(dir); }
});