const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const path = require('path');
const WebWorker = require('../../server/core/WebWorker');
const FakeDb = require('../helpers/fakeDb');
const { makeTmpDir, cleanup } = require('../helpers/tmpdir');

// fakeThis: без конструктора (singleton + фоновые циклы).
function makeFakeThis(opts = {}) {
    const config = Object.assign({
        bookDir: opts.bookDir || '/tmp/book',
        authorDir: opts.authorDir || '/tmp/author',
        bookPathStatic: '/book',
        rootPathStatic: '/static',
        libDir: opts.libDir || '',
    }, opts.config || {});

    const db = opts.db || new FakeDb();
    const fake = {
        config,
        db,
        remoteLib: opts.remoteLib || null,
        reviewsReader: opts.reviewsReader || null,
        authorBioReader: opts.authorBioReader || null,
        checkMyState() {},
        async getBookLink(uid) {
            if (opts.getBookLink) return opts.getBookLink(uid);
            return {link: '/book/abc'};
        },
        materializeReviews: WebWorker.prototype.materializeReviews,
        materializeBio: WebWorker.prototype.materializeBio,
    };
    return fake;
}

// --- materializeReviews ---------------------------------------------------

test('materializeReviews: hash из file_hash, reviewsReader.read', async () => {
    const db = new FakeDb();
    db.tables.set('book', [{_uid: 'u', folder: 'f', file: 'x', ext: 'fb2'}]);
    db.tables.set('file_hash', [{id: 'u', hash: 'H1'}]);

    let readArgs = null;
    const reviewsReader = {
        async read(folder, file, hash) { readArgs = {folder, file, hash}; return {reviews: []}; },
    };
    const fake = makeFakeThis({db, reviewsReader});

    const res = await WebWorker.prototype.materializeReviews.call(fake, 'u');
    assert.strictEqual(res.hash, 'H1');
    assert.deepStrictEqual(readArgs, {folder: 'f', file: 'x.fb2', hash: 'H1'});
});

test('materializeReviews: нет file_hash, !remoteLib → getBookLink', async () => {
    const db = new FakeDb();
    db.tables.set('book', [{_uid: 'u', folder: 'f', file: 'x', ext: 'fb2'}]);
    db.tables.set('file_hash', []);

    const reviewsReader = { async read() { return {}; } };
    const fake = makeFakeThis({db, reviewsReader, getBookLink: async () => ({link: '/book/LINK'})});

    const res = await WebWorker.prototype.materializeReviews.call(fake, 'u');
    assert.strictEqual(res.hash, 'LINK');
});

test('materializeReviews: remoteLib + нет .review → downloadReview', async () => {
    const dir = await makeTmpDir();
    try {
        const db = new FakeDb();
        db.tables.set('book', [{_uid: 'u', folder: 'f', file: 'x', ext: 'fb2'}]);
        db.tables.set('file_hash', []);

        let downloaded = 0;
        const remoteLib = { async downloadReview() { downloaded++; return 'H2'; } };
        const reviewsReader = { async read(folder, file, hash) { return {hash}; } };
        const fake = makeFakeThis({db, reviewsReader, remoteLib, bookDir: dir});

        const res = await WebWorker.prototype.materializeReviews.call(fake, 'u');
        assert.strictEqual(downloaded, 1);
        assert.strictEqual(res.hash, 'H2');
    } finally { await cleanup(dir); }
});

test('materializeReviews: reviewsReader null → reviews_disabled', async () => {
    const db = new FakeDb();
    db.tables.set('book', [{_uid: 'u'}]);
    const fake = makeFakeThis({db, reviewsReader: null});
    await assert.rejects(() => WebWorker.prototype.materializeReviews.call(fake, 'u'), /reviews_disabled/);
});

// --- materializeBio -------------------------------------------------------

test('materializeBio: getBio вызывается до downloadBio/downloadPhoto', async () => {
    const dir = await makeTmpDir();
    try {
        const order = [];
        const authorBioReader = {
            async getBio() { order.push('getBio'); return null; },
            async _findCachedPhoto() { order.push('_findCachedPhoto'); return null; },
            async getPhoto() { order.push('getPhoto'); return null; },
        };
        const remoteLib = {
            async downloadBio() { order.push('downloadBio'); },
            async downloadPhoto() { order.push('downloadPhoto'); },
        };
        const fake = makeFakeThis({authorBioReader, remoteLib, authorDir: dir});

        await WebWorker.prototype.materializeBio.call(fake, 'h');
        assert.deepStrictEqual(order, [
            'getBio', 'downloadBio', '_findCachedPhoto', 'downloadPhoto', 'getBio', 'getPhoto',
        ]);
    } finally { await cleanup(dir); }
});

test('materializeBio: .nophoto есть → downloadPhoto не вызывается', async () => {
    const dir = await makeTmpDir();
    try {
        await fs.writeFile(path.join(dir, 'h.nophoto'), '');
        let downloaded = 0;
        const authorBioReader = {
            async getBio() { return null; },
            async _findCachedPhoto() { return null; },
            async getPhoto() { return null; },
        };
        const remoteLib = {
            async downloadBio() {},
            async downloadPhoto() { downloaded++; },
        };
        const fake = makeFakeThis({authorBioReader, remoteLib, authorDir: dir});

        await WebWorker.prototype.materializeBio.call(fake, 'h');
        assert.strictEqual(downloaded, 0);
    } finally { await cleanup(dir); }
});

test('materializeBio: фото уже есть → downloadPhoto не вызывается', async () => {
    const dir = await makeTmpDir();
    try {
        let downloaded = 0;
        const authorBioReader = {
            async getBio() { return null; },
            async _findCachedPhoto() { return {path: '/x.jpg', ext: '.jpg'}; },
            async getPhoto() { return {path: '/x.jpg', ext: '.jpg'}; },
        };
        const remoteLib = { async downloadBio() {}, async downloadPhoto() { downloaded++; } };
        const fake = makeFakeThis({authorBioReader, remoteLib, authorDir: dir});

        await WebWorker.prototype.materializeBio.call(fake, 'h');
        assert.strictEqual(downloaded, 0);
    } finally { await cleanup(dir); }
});

test('materializeBio: authorsBioReader null → authors_disabled', async () => {
    const fake = makeFakeThis({authorBioReader: null});
    await assert.rejects(() => WebWorker.prototype.materializeBio.call(fake, 'h'), /authors_disabled/);
});

// --- getBookReviewsCount --------------------------------------------------

test('getBookReviewsCount: отдельный путь (не materializeReviews)', async () => {
    const db = new FakeDb();
    db.tables.set('book', [{_uid: 'u', folder: 'f', file: 'x', ext: 'fb2'}]);
    let countArgs = null;
    const reviewsReader = {
        async getCount(folder, file) { countArgs = {folder, file}; return {declaredCount: 2, sum: 8}; },
        async read() { throw new Error('read must not be called'); },
    };
    const fake = makeFakeThis({db, reviewsReader});
    const res = await WebWorker.prototype.getBookReviewsCount.call(fake, 'u');
    assert.deepStrictEqual(res, {declaredCount: 2, sum: 8});
    assert.deepStrictEqual(countArgs, {folder: 'f', file: 'x.fb2'});
});

// --- getReviewLink / getBioLink / getPhotoLink ----------------------------

test('getReviewLink: materializeReviews → link, 404 если нет .review', async () => {
    const dir = await makeTmpDir();
    try {
        const db = new FakeDb();
        db.tables.set('book', [{_uid: 'u', folder: 'f', file: 'x', ext: 'fb2'}]);
        db.tables.set('file_hash', [{id: 'u', hash: 'H1'}]);
        const reviewsReader = { async read() { return {}; } };
        const fake = makeFakeThis({db, reviewsReader, bookDir: dir, config: {bookPathStatic: '/book'}});

        // .review нет → 404
        await assert.rejects(() => WebWorker.prototype.getReviewLink.call(fake, 'u'), /404/);

        // .review есть → link
        await fs.writeFile(path.join(dir, 'H1.review'), 'x');
        const res = await WebWorker.prototype.getReviewLink.call(fake, 'u');
        assert.strictEqual(res.link, '/book/H1.review');
    } finally { await cleanup(dir); }
});

test('getBioLink: bio есть → link; bio нет → 404', async () => {
    const authorBioReader = {
        async getBio() { return 'html'; },
    };
    const fake = makeFakeThis({authorBioReader, config: {rootPathStatic: '/static'}});
    const res = await WebWorker.prototype.getBioLink.call(fake, 'h');
    assert.strictEqual(res.link, '/static/author/h.bio');

    authorBioReader.getBio = async () => null;
    await assert.rejects(() => WebWorker.prototype.getBioLink.call(fake, 'h'), /404/);
});

test('getPhotoLink: photo есть → <hash><ext>; нет → <hash>.nophoto', async () => {
    const authorBioReader = {
        async getPhoto() { return {ext: '.jpg'}; },
    };
    const fake = makeFakeThis({authorBioReader, config: {rootPathStatic: '/static'}});
    let res = await WebWorker.prototype.getPhotoLink.call(fake, 'h');
    assert.strictEqual(res.link, '/static/author/h.jpg');

    authorBioReader.getPhoto = async () => null;
    res = await WebWorker.prototype.getPhotoLink.call(fake, 'h');
    assert.strictEqual(res.link, '/static/author/h.nophoto');
});