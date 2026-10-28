const test = require('node:test');
const assert = require('node:assert');
const BasePage = require('../../server/core/opds/BasePage');

test('addPlainNavLinks: одна subsection → plain-дубль без rel', () => {
    const page = Object.create(BasePage.prototype);
    const content = {entry: [{link: [
        {'*ATTRS': {href: '/x', rel: 'subsection', type: 'application/atom+xml;profile=opds-catalog'}},
    ]}]};
    page.addPlainNavLinks(content);
    assert.strictEqual(content.entry[0].link.length, 2);
    assert.ok(!content.entry[0].link[1]['*ATTRS'].rel);
});

test('addPlainNavLinks: две subsection → plain-дубль один (первая)', () => {
    const page = Object.create(BasePage.prototype);
    const content = {entry: [{link: [
        {'*ATTRS': {href: '/a', rel: 'subsection'}},
        {'*ATTRS': {href: '/b', rel: 'subsection'}},
    ]}]};
    page.addPlainNavLinks(content);
    const plain = content.entry[0].link.filter(l => !l['*ATTRS'].rel);
    assert.strictEqual(plain.length, 1);
    assert.strictEqual(plain[0]['*ATTRS'].href, '/a');
});

test('addPlainNavLinks: acquisition + subsection → acquisition не тронут', () => {
    const page = Object.create(BasePage.prototype);
    const content = {entry: [{link: [
        {'*ATTRS': {href: '/d', rel: 'http://opds-spec.org/acquisition', type: 'application/fb2'}},
        {'*ATTRS': {href: '/a', rel: 'subsection'}},
    ]}]};
    page.addPlainNavLinks(content);
    assert.ok(content.entry[0].link.some(l => l['*ATTRS'].rel === 'http://opds-spec.org/acquisition'));
    assert.ok(content.entry[0].link.some(l => !l['*ATTRS'].rel));
});

test('addPlainNavLinks: related + acquisition → plain-дубля нет (нет subsection)', () => {
    const page = Object.create(BasePage.prototype);
    const content = {entry: [{link: [
        {'*ATTRS': {href: '/d', rel: 'http://opds-spec.org/acquisition'}},
        {'*ATTRS': {href: '/r', rel: 'related'}},
    ]}]};
    page.addPlainNavLinks(content);
    assert.ok(!content.entry[0].link.some(l => !l['*ATTRS'].rel));
});