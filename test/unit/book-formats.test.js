const test = require('node:test');
const assert = require('node:assert');
const { bookContentType, bookFormats } = require('../../server/core/book/bookFormats');

test('bookContentType: epub/epub.zip → application/epub+zip', () => {
    assert.strictEqual(bookContentType('b.epub'), 'application/epub+zip');
    assert.strictEqual(bookContentType('b.epub.zip'), 'application/epub+zip');
});

test('bookContentType: fb2/fb2.zip', () => {
    assert.strictEqual(bookContentType('b.fb2'), 'application/fb2');
    assert.strictEqual(bookContentType('b.fb2.zip'), 'application/fb2+zip');
});

test('bookContentType: mobi → x-mobipocket-ebook', () => {
    assert.strictEqual(bookContentType('b.mobi'), 'application/x-mobipocket-ebook');
});

test('bookContentType: zip без внутреннего ext → application/zip', () => {
    assert.strictEqual(bookContentType('b.zip'), 'application/zip');
});

test('bookContentType: без ext', () => {
    assert.strictEqual(bookContentType('b'), '');
});

test('bookFormats: epub → только epub+zip', () => {
    assert.deepStrictEqual(bookFormats('epub', '/b/h'), {
        'epub+zip': '/b/h',
    });
});

test('bookFormats: fb2 → fb2+zip → /zip, fb2 → link', () => {
    assert.deepStrictEqual(bookFormats('fb2', '/b/h'), {
        'fb2+zip': '/b/h/zip',
        'fb2': '/b/h',
    });
});

test('bookFormats: mobi → +zip, mobi, x-mobipocket-ebook', () => {
    assert.deepStrictEqual(bookFormats('mobi', '/b/h'), {
        'mobi+zip': '/b/h/zip',
        'mobi': '/b/h',
        'x-mobipocket-ebook': '/b/h',
    });
});

test('bookFormats: djvu → djvu+zip, djvu', () => {
    assert.deepStrictEqual(bookFormats('djvu', '/b/h'), {
        'djvu+zip': '/b/h/zip',
        'djvu': '/b/h',
    });
});