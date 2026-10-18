const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const path = require('path');
const utils = require('../../server/core/utils');
const { makeTmpDir, cleanup } = require('../helpers/tmpdir');

test('getBufHash/getFileHash', async () => {
    const buf = Buffer.from('hello', 'utf8');
    const h1 = utils.getBufHash(buf, 'sha256', 'hex');
    const dir = await makeTmpDir();
    try {
        const f = path.join(dir, 'f');
        await fs.writeFile(f, buf);
        const h2 = await utils.getFileHash(f, 'sha256', 'hex');
        assert.strictEqual(h1, h2);
    } finally { await cleanup(dir); }
});

test('makeValidFileName / makeValidFileNameOrEmpty', () => {
    assert.strictEqual(utils.makeValidFileName('a/b\\c:d*e"f<g>h|i'), 'a_b_c_d_e_f_g_h_i');
    assert.strictEqual(utils.makeValidFileName('  name.  '), 'name');
    assert.strictEqual(utils.makeValidFileNameOrEmpty('///'), '');
});

test('intersectSet', () => {
    const a = new Set([1,2,3]), b = new Set([2,3,4]), c = new Set([3,2]);
    assert.deepStrictEqual([...utils.intersectSet([a,b,c])].sort(), [2,3]);
    assert.strictEqual(utils.intersectSet([]).size, 0);
});

test('wordEnding', () => {
    assert.strictEqual(utils.wordEnding(1), '');
    assert.strictEqual(utils.wordEnding(3), 'а');
    assert.strictEqual(utils.wordEnding(10), 'ов');
    assert.strictEqual(utils.wordEnding(15), 'ов');
    assert.strictEqual(utils.wordEnding(21), '');
    assert.strictEqual(utils.wordEnding(25), 'ов');
});

test('cutString', () => {
    assert.strictEqual(utils.cutString(null), '');
    assert.strictEqual(utils.cutString('abc', 10), 'abc');
    assert.match(utils.cutString('a'.repeat(20), 5), /^aaaaa \.\.\.$/);
});

test('gzipBuffer/gunzipBuffer round-trip', async () => {
    const src = Buffer.from('test-data', 'utf8');
    const gz = await utils.gzipBuffer(src);
    const back = await utils.gunzipBuffer(gz);
    assert.deepStrictEqual(back, src);
});

test('gzipFile/gunzipFile round-trip', async () => {
    const dir = await makeTmpDir();
    try {
        const inp = path.join(dir, 'in');
        const gz = path.join(dir, 'in.gz');
        const out = path.join(dir, 'out');
        await fs.writeFile(inp, 'file-data');
        await utils.gzipFile(inp, gz);
        await utils.gunzipFile(gz, out);
        assert.strictEqual(await fs.readFile(out, 'utf8'), 'file-data');
    } finally { await cleanup(dir); }
});