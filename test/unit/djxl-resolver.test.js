const test = require('node:test');
const assert = require('node:assert');
const { resolveDjxl, setDjxlPath } = require('../../server/core/DjxlResolver');
const { hasDjxl } = require('../helpers/tools');

test('resolveDjxl: не бросает, возвращает строку или null', () => {
    const p = resolveDjxl();
    assert.ok(p === null || typeof p === 'string');
});

test('resolveDjxl: идемпотентен (кэш)', () => {
    assert.strictEqual(resolveDjxl(), resolveDjxl());
});

test('resolveDjxl: невалидный setDjxlPath → fallback, не бросает', () => {
    setDjxlPath('/nonexistent/djxl-xyz');
    const p = resolveDjxl();
    assert.ok(p === null || typeof p === 'string');
});

test('resolveDjxl: валидный setDjxlPath → возвращает его', {skip: !hasDjxl()}, () => {
    const p = resolveDjxl();
    setDjxlPath(p);
    assert.strictEqual(resolveDjxl(), p);
});