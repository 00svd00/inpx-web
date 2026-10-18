const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const path = require('path');
const Favorites = require('../../server/core/Favorites');
const { makeTmpDir, cleanup } = require('../helpers/tmpdir');
const { resetSingletons } = require('../helpers/instances');

function makeConfig(dataDir, maxCount = 5000) {
    return { dataDir, favorites: { enabled: true, autoAdd: true, maxCount } };
}

test('add/list/remove/remove(array)', async () => {
    const dir = await makeTmpDir();
    try {
        resetSingletons();
        const fav = new Favorites(makeConfig(dir));
        await fav.add('a', { author: 'A', title: 'T' });
        await fav.add('b', { author: 'B', title: 'U' });
        let list = await fav.list();
        assert.deepStrictEqual(list.map(x => x.uid), ['b', 'a']);

        await fav.remove('a');
        list = await fav.list();
        assert.deepStrictEqual(list.map(x => x.uid), ['b']);

        await fav.remove(['b']);
        list = await fav.list();
        assert.deepStrictEqual(list, []);
    } finally { await cleanup(dir); resetSingletons(); }
});

test('downloadCount++ / addedAt сохраняется / lastAt обновляется', async () => {
    const dir = await makeTmpDir();
    try {
        resetSingletons();
        const fav = new Favorites(makeConfig(dir));
        await fav.add('a', {});
        const [first] = await fav.list();
        assert.strictEqual(first.downloadCount, 1);
        const addedAt = first.addedAt;

        await new Promise(r => setTimeout(r, 5));
        await fav.add('a', {});
        const [second] = await fav.list();
        assert.strictEqual(second.downloadCount, 2);
        assert.strictEqual(second.addedAt, addedAt);
        assert.notStrictEqual(second.lastAt, addedAt);
    } finally { await cleanup(dir); resetSingletons(); }
});

test('maxCount ограничивает список', async () => {
    const dir = await makeTmpDir();
    try {
        resetSingletons();
        const fav = new Favorites(makeConfig(dir, 2));
        await fav.add('a', {});
        await fav.add('b', {});
        await fav.add('c', {});
        const list = await fav.list();
        assert.strictEqual(list.length, 2);
        assert.deepStrictEqual(list.map(x => x.uid), ['c', 'b']);
    } finally { await cleanup(dir); resetSingletons(); }
});

test('битый favorites.json → пусто, не падает', async () => {
    const dir = await makeTmpDir();
    try {
        resetSingletons();
        await fs.writeFile(path.join(dir, 'favorites.json'), '{not json');
        const fav = new Favorites(makeConfig(dir));
        assert.deepStrictEqual(await fav.list(), []);
    } finally { await cleanup(dir); resetSingletons(); }
});