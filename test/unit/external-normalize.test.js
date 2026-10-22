const test = require('node:test');
const assert = require('node:assert');
const { normalizeExternal } = require('../../server/core/externalTools');

test('normalizeExternal: невалидный ключ → active: false', () => {
    const ext = { 'foo-bar': { active: true, cmd: 'x', type: 'download' } };
    normalizeExternal(ext);
    assert.strictEqual(ext['foo-bar'].active, false);
});

test('normalizeExternal: нет cmd → active: false', () => {
    const ext = { a: { active: true, type: 'download' } };
    normalizeExternal(ext);
    assert.strictEqual(ext.a.active, false);
});

test('normalizeExternal: пустой cmd → active: false', () => {
    const ext = { a: { active: true, cmd: '   ', type: 'download' } };
    normalizeExternal(ext);
    assert.strictEqual(ext.a.active, false);
});

test('normalizeExternal: невалидный type → active: false', () => {
    const ext = { a: { active: true, cmd: 'x', type: 'unknown' } };
    normalizeExternal(ext);
    assert.strictEqual(ext.a.active, false);
});

test('normalizeExternal: onlyExt нормализуется (lower, без точки, пустые отброшены)', () => {
    const ext = { a: { active: true, cmd: 'x', type: 'download', onlyExt: ['.EPUB', 'docx', ''] } };
    normalizeExternal(ext);
    assert.deepStrictEqual(ext.a.onlyExt, ['epub', 'docx']);
});

test('normalizeExternal: onlyExt не массив → []', () => {
    const ext = { a: { active: true, cmd: 'x', type: 'download', onlyExt: 'epub' } };
    normalizeExternal(ext);
    assert.deepStrictEqual(ext.a.onlyExt, []);
});

test('normalizeExternal: валидный конфиг сохраняет active: true, debug → boolean', () => {
    const ext = { fbz: { active: true, cmd: 'fb2c ${BOOKFILE}', type: 'download', title: 'FB2', onlyExt: ['fb2'] } };
    normalizeExternal(ext);
    assert.strictEqual(ext.fbz.active, true);
    assert.deepStrictEqual(ext.fbz.onlyExt, ['fb2']);
    assert.strictEqual(ext.fbz.debug, false);
});

test('normalizeExternal: null/undefined → {}', () => {
    assert.deepStrictEqual(normalizeExternal(null), {});
    assert.deepStrictEqual(normalizeExternal(undefined), {});
});