const test = require('node:test');
const assert = require('node:assert');
const DbSearcher = require('../../server/core/DbSearcher');

function make(recStruct = []) {
    const s = Object.create(DbSearcher.prototype);
    s.recStruct = recStruct;
    return s;
}

// --- parseRatingCount ---

test('parseRatingCount: N', () => {
    assert.deepStrictEqual(make().parseRatingCount('5'), {from: 5, to: 5});
});

test('parseRatingCount: N..', () => {
    assert.deepStrictEqual(make().parseRatingCount('5..'), {from: 5, to: null});
});

test('parseRatingCount: ..M', () => {
    assert.deepStrictEqual(make().parseRatingCount('..10'), {from: null, to: 10});
});

test('parseRatingCount: N..M', () => {
    assert.deepStrictEqual(make().parseRatingCount('5..10'), {from: 5, to: 10});
});

test('parseRatingCount: 0', () => {
    assert.deepStrictEqual(make().parseRatingCount('0'), {from: 0, to: 0});
});

test('parseRatingCount: невалидно → null', () => {
    const s = make();
    for (const v of ['abc', '..', '', null, undefined, '5..abc', 'abc..5', '1..2..3'])
        assert.strictEqual(s.parseRatingCount(v), null, `value: ${v}`);
});

test('parseRatingCount: trim', () => {
    const s = make();
    assert.deepStrictEqual(s.parseRatingCount(' 5 '), {from: 5, to: 5});
    assert.deepStrictEqual(s.parseRatingCount(' 5..10 '), {from: 5, to: 10});
});

// --- queryKey ---

test('queryKey: включает ratingCount', () => {
    const s = make([{field: 'author'}, {field: 'title'}]);
    assert.ok(s.queryKey({author: 'A', title: 'T', ratingCount: '3..5'}).includes('3..5'));
});

test('queryKey: пустой ratingCount → как без него', () => {
    const s = make([{field: 'author'}]);
    assert.strictEqual(
        s.queryKey({author: 'A'}),
        s.queryKey({author: 'A', ratingCount: ''})
    );
});

test('queryKey: разный ratingCount → разный ключ', () => {
    const s = make([{field: 'author'}]);
    assert.notStrictEqual(
        s.queryKey({author: 'A', ratingCount: '3..'}),
        s.queryKey({author: 'A', ratingCount: '5..'})
    );
});

test('queryKey: порядок recStruct + ratingCount в конце', () => {
    const s = make([{field: 'author'}, {field: 'series'}, {field: 'title'}]);
    assert.strictEqual(
        s.queryKey({author: 'A', series: 'S', title: 'T'}),
        JSON.stringify(['A', 'S', 'T', ''])
    );
});