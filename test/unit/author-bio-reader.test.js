const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const path = require('path');
const zlib = require('zlib');
const AuthorBioReader = require('../../server/core/AuthorBioReader');
const FakeDb = require('../helpers/fakeDb');
const FakeArchive = require('../helpers/fakeArchive');
const { makeTmpDir, cleanup } = require('../helpers/tmpdir');
const { preparePictures } = require('../helpers/photos');


function makeReader(db, config, archive) {
    const reader = new AuthorBioReader(config, db);
    if (archive) reader.archive = archive;
    return reader;
}

test('getBio: archiveId нет → null', async () => {
    const db = new FakeDb();
    db.tables.set('authors_info', []);
    const reader = makeReader(db, { authorDir: '/tmp', libDir: '' });
    assert.strictEqual(await reader.getBio('h'), null);
});

test('getBio: кэш с тем же archiveId → возвращает html', async () => {
    const dir = await makeTmpDir();
    try {
        const db = new FakeDb();
        db.tables.set('authors_info', [{ _uid: 'h', archiveId: 5 }]);
        const reader = makeReader(db, { authorDir: dir, libDir: '' });
        await fs.writeFile(path.join(dir, 'h.bio'), zlib.gzipSync(JSON.stringify({ archiveId: 5, html: '<b>x</b>' })));
        assert.strictEqual(await reader.getBio('h'), '<b>x</b>');
    } finally { await cleanup(dir); }
});

test('getBio: кэш с другим archiveId → удаляется, fake-архив', async () => {
    const dir = await makeTmpDir();
    try {
        const db = new FakeDb();
        db.tables.set('authors_info', [{ _uid: 'h', archiveId: 7 }]);
        await fs.writeFile(path.join(dir, 'h.bio'), zlib.gzipSync(JSON.stringify({ archiveId: 5, html: 'old' })));

        const archivePath = path.join('/lib', 'etc', 'authors', '7.7z');
        const fake = new FakeArchive({ files: new Map([[`${archivePath}#h`, Buffer.from('<b>new</b>')]]) });
        const reader = makeReader(db, { authorDir: dir, libDir: '/lib' }, fake);

        assert.strictEqual(await reader.getBio('h'), '<b>new</b>');
        // кэш перезаписан с archiveId 7
        const cached = JSON.parse(zlib.gunzipSync(await fs.readFile(path.join(dir, 'h.bio'))).toString());
        assert.strictEqual(cached.archiveId, 7);
    } finally { await cleanup(dir); }
});

test('getBio: !libDir → null без кэша', async () => {
    const dir = await makeTmpDir();
    try {
        const db = new FakeDb();
        db.tables.set('authors_info', [{ _uid: 'h', archiveId: 5 }]);
        const reader = makeReader(db, { authorDir: dir, libDir: '' });
        assert.strictEqual(await reader.getBio('h'), null);
    } finally { await cleanup(dir); }
});

// --- removeCached ---------------------------------------------------------

test('removeCached: сносит .bio, <hash>.<ext>, .nophoto; .tmp/.dev не трогает', async () => {
    const dir = await makeTmpDir();
    try {
        await fs.writeFile(path.join(dir, 'h.bio'), 'bio');
        await fs.writeFile(path.join(dir, 'h.jpg'), 'jpg');
        await fs.writeFile(path.join(dir, 'h.nophoto'), '');
        await fs.writeFile(path.join(dir, 'h.tmp'), 'tmp');
        await fs.writeFile(path.join(dir, 'h.dev'), 'dev');

        const db = new FakeDb();
        const reader = makeReader(db, { authorDir: dir, libDir: '' });

        assert.strictEqual(await reader.removeCached('h'), true);
        for (const f of ['h.bio', 'h.jpg', 'h.nophoto'])
            assert.ok(!await fs.pathExists(path.join(dir, f)), `${f} must be removed`);
        for (const f of ['h.tmp', 'h.dev'])
            assert.ok(await fs.pathExists(path.join(dir, f)), `${f} must stay`);
    } finally { await cleanup(dir); }
});

test('removeCached: пусто → false, не падает', async () => {
    const dir = await makeTmpDir();
    try {
        const db = new FakeDb();
        const reader = makeReader(db, { authorDir: dir, libDir: '' });
        assert.strictEqual(await reader.removeCached('nope'), false);
    } finally { await cleanup(dir); }
});

test('removeCached: только .nophoto → сносит, true', async () => {
    const dir = await makeTmpDir();
    try {
        await fs.writeFile(path.join(dir, 'h.nophoto'), '');
        const db = new FakeDb();
        const reader = makeReader(db, { authorDir: dir, libDir: '' });
        assert.strictEqual(await reader.removeCached('h'), true);
        assert.ok(!await fs.pathExists(path.join(dir, 'h.nophoto')));
    } finally { await cleanup(dir); }
});

// --- getBio: инвалидация через removeCached --------------------------------

test('getBio: валидный кэш (archiveId 7) → html из кэша, фото/архив не трогаются', async () => {
    const dir = await makeTmpDir();
    try {
        const db = new FakeDb();
        db.tables.set('authors_info', [{ _uid: 'h', archiveId: 7 }]);
        await fs.writeFile(path.join(dir, 'h.bio'), zlib.gzipSync(JSON.stringify({ archiveId: 7, html: '<b>cached</b>' })));
        await fs.writeFile(path.join(dir, 'h.jpg'), 'jpg');

        const { libDir } = await preparePictures(dir, 7);
        const fake = new FakeArchive();
        const reader = makeReader(db, { authorDir: dir, libDir }, fake);

        assert.strictEqual(await reader.getBio('h'), '<b>cached</b>');
        assert.ok(await fs.pathExists(path.join(dir, 'h.jpg')));
        assert.strictEqual(fake.listCalls.length, 0);
    } finally { await cleanup(dir); }
});

test('getBio: невалидный кэш (5) + индекс 7 → новое био, фото/.nophoto снесены', async () => {
    const dir = await makeTmpDir();
    try {
        const db = new FakeDb();
        db.tables.set('authors_info', [{ _uid: 'h', archiveId: 7 }]);
        await fs.writeFile(path.join(dir, 'h.bio'), zlib.gzipSync(JSON.stringify({ archiveId: 5, html: '<b>old</b>' })));
        await fs.writeFile(path.join(dir, 'h.jpg'), 'jpg');
        await fs.writeFile(path.join(dir, 'h.nophoto'), '');

        const { libDir } = await preparePictures(dir, 7);
        const archivePath = path.join(dir, 'etc', 'authors', '7.7z');
        // getBio читает <authorsDir>/<archiveId>.7z — authorsDir = <libDir>/etc/authors
        const fake = new FakeArchive({
            files: new Map([[`${archivePath}#h`, Buffer.from('<b>new</b>')]]),
        });
        const reader = makeReader(db, { authorDir: dir, libDir }, fake);

        assert.strictEqual(await reader.getBio('h'), '<b>new</b>');
        const cached = JSON.parse(zlib.gunzipSync(await fs.readFile(path.join(dir, 'h.bio'))).toString());
        assert.strictEqual(cached.archiveId, 7);
        assert.ok(!await fs.pathExists(path.join(dir, 'h.jpg')));
        assert.ok(!await fs.pathExists(path.join(dir, 'h.nophoto')));
    } finally { await cleanup(dir); }
});

test('getBio: .bio нет, .nophoto/.jpg есть, индекс 7 → био из архива, .nophoto/.jpg снесены', async () => {
    const dir = await makeTmpDir();
    try {
        const db = new FakeDb();
        db.tables.set('authors_info', [{ _uid: 'h', archiveId: 7 }]);
        await fs.writeFile(path.join(dir, 'h.jpg'), 'jpg');
        await fs.writeFile(path.join(dir, 'h.nophoto'), '');

        const { libDir } = await preparePictures(dir, 7);
        const archivePath = path.join(dir, 'etc', 'authors', '7.7z');
        const fake = new FakeArchive({
            files: new Map([[`${archivePath}#h`, Buffer.from('<b>new</b>')]]),
        });
        const reader = makeReader(db, { authorDir: dir, libDir }, fake);

        assert.strictEqual(await reader.getBio('h'), '<b>new</b>');
        assert.ok(!await fs.pathExists(path.join(dir, 'h.jpg')));
        assert.ok(!await fs.pathExists(path.join(dir, 'h.nophoto')));
    } finally { await cleanup(dir); }
});

test('getBio: archiveId null → null, .nophoto не трогается', async () => {
    const dir = await makeTmpDir();
    try {
        const db = new FakeDb();
        db.tables.set('authors_info', []);
        await fs.writeFile(path.join(dir, 'h.nophoto'), '');

        const reader = makeReader(db, { authorDir: dir, libDir: '' });
        assert.strictEqual(await reader.getBio('h'), null);
        assert.ok(await fs.pathExists(path.join(dir, 'h.nophoto')));
    } finally { await cleanup(dir); }
});

test('getBio → getPhoto: .nophoto снесён инвалидацией, фото материализуется из архива', async () => {
    const dir = await makeTmpDir();
    try {
        const db = new FakeDb();
        db.tables.set('authors_info', [{ _uid: 'h', archiveId: 7 }]);
        await fs.writeFile(path.join(dir, 'h.nophoto'), '');      // старый маркер
        await fs.writeFile(path.join(dir, 'h.bio'), zlib.gzipSync(JSON.stringify({ archiveId: 5, html: 'old' })));

        const { libDir, archivePath: picturesArchive } = await preparePictures(dir, 7);
        const bioArchive = path.join(dir, 'etc', 'authors', '7.7z');
        const fake = new FakeArchive({
            files: new Map([
                [`${bioArchive}#h`, Buffer.from('<b>new</b>')],
                [`${picturesArchive}#h/photo.jpg`, Buffer.from('jpg')],
            ]),
            lists: new Map([[picturesArchive, ['h/photo.jpg']]]),
        });
        const reader = makeReader(db, { authorDir: dir, libDir }, fake);

        await reader.getBio('h');
        assert.ok(!await fs.pathExists(path.join(dir, 'h.nophoto')));

        const photo = await reader.getPhoto('h');
        assert.ok(photo);
        assert.strictEqual(photo.ext, '.jpg');
        assert.ok(await fs.pathExists(path.join(dir, 'h.jpg')));
    } finally { await cleanup(dir); }
});