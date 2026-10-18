const test = require('node:test');
const assert = require('node:assert');
const { PROTOCOL_VERSION } = require('../../server/core/Protocol');

test('PROTOCOL_VERSION — снапшот (менять только при релизе)', () => {
    assert.strictEqual(PROTOCOL_VERSION, 2);
});

test('PROTOCOL_VERSION — целое положительное', () => {
    assert.ok(Number.isInteger(PROTOCOL_VERSION));
    assert.ok(PROTOCOL_VERSION >= 1);
});