const test = require('node:test');
const assert = require('node:assert');
const { normExt, getExternalItems } = require('../../client/share/externalItems');

test('normExt: lower, без точки', () => {
    assert.strictEqual(normExt('.EPUB'), 'epub');
    assert.strictEqual(normExt('epub'), 'epub');
    assert.strictEqual(normExt('.epub'), 'epub');
    assert.strictEqual(normExt(''), '');
    assert.strictEqual(normExt(undefined), '');
});

test('getExternalItems: пустой/нет external → []', () => {
    assert.deepStrictEqual(getExternalItems(undefined, 'fb2'), []);
    assert.deepStrictEqual(getExternalItems({}, 'fb2'), []);
});

test('getExternalItems: active/cmd', () => {
    const external = {
        a: {active: true, cmd: 'x', title: 'A'},
        b: {active: false, cmd: 'y', title: 'B'},
        c: {active: true, title: 'C'},
    };
    const items = getExternalItems(external, 'fb2');
    assert.deepStrictEqual(items.map(i => i.key), ['a']);
    assert.strictEqual(items[0].title, 'A');
});

test('getExternalItems: onlyExt (lower, точка, регистр)', () => {
    const external = {
        a: {active: true, cmd: 'x', onlyExt: ['epub', 'docx']},
    };
    assert.deepStrictEqual(getExternalItems(external, 'epub').map(i => i.key), ['a']);
    assert.deepStrictEqual(getExternalItems(external, '.EPUB').map(i => i.key), ['a']);
    assert.deepStrictEqual(getExternalItems(external, 'docx').map(i => i.key), ['a']);
    assert.deepStrictEqual(getExternalItems(external, 'fb2'), []);
});

test('getExternalItems: onlyExt пуст/нет → все', () => {
    const external = {
        a: {active: true, cmd: 'x', onlyExt: []},
        b: {active: true, cmd: 'y'},
    };
    assert.deepStrictEqual(getExternalItems(external, 'fb2').map(i => i.key), ['a', 'b']);
});

test('getExternalItems: title fallback key, hint', () => {
    const external = {
        fbz: {active: true, cmd: 'x', hint: 'h'},
    };
    const items = getExternalItems(external, 'fb2');
    assert.strictEqual(items[0].title, 'fbz');
    assert.strictEqual(items[0].hint, 'h');
});