const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const {
    isAvailable, resolveExternal, parseExternalKey, resolveExternalByFileType, normExt,
    getOpdsExternalLinks,
} = require('../../server/core/externalTools');


const config = {
    externalToolsConfig: '/data/external_tools.json',
    external: {
        pdf: {active: true, cmd: 'pdfcmd', type: 'download', ext: 'pdf', title: 'PDF'},
        fbz: {active: true, cmd: 'echo ${BOOKEXT} ${EXTDIR} ${HASHFILE} ${FILENAME}', type: 'download', ext: 'fb2.zip', onlyExt: ['epub', 'docx']},
        off: {active: false, cmd: 'z', type: 'download'},
        gui: {active: true, cmd: 'g', type: 'gui'},
    },
};

test('normExt', () => {
    assert.strictEqual(normExt('.EPUB'), 'epub');
    assert.strictEqual(normExt('epub'), 'epub');
    assert.strictEqual(normExt(''), '');
});

test('isAvailable: active/cmd', () => {
    assert.strictEqual(isAvailable(config, 'pdf', 'fb2'), true);
    assert.strictEqual(isAvailable(config, 'off', 'fb2'), false);
    assert.strictEqual(isAvailable(config, 'nope', 'fb2'), false);
});

test('isAvailable: onlyExt (lower, точка, регистр)', () => {
    assert.strictEqual(isAvailable(config, 'fbz', 'epub'), true);
    assert.strictEqual(isAvailable(config, 'fbz', '.EPUB'), true);
    assert.strictEqual(isAvailable(config, 'fbz', 'docx'), true);
    assert.strictEqual(isAvailable(config, 'fbz', 'fb2'), false);
});

test('parseExternalKey', () => {
    assert.strictEqual(parseExternalKey('ext-pdf'), 'pdf');
    assert.strictEqual(parseExternalKey('ext-fb2_zip'), 'fb2_zip');
    assert.strictEqual(parseExternalKey('ext-a.b'), null);
    assert.strictEqual(parseExternalKey('ext-'), null);
    assert.strictEqual(parseExternalKey('foo'), null);
});

test('resolveExternalByFileType: null для невалидного/неактивного', () => {
    assert.strictEqual(resolveExternalByFileType(config, 'foo', {bookExt: 'fb2', bookFile: '/b/h'}), null);
    assert.strictEqual(resolveExternalByFileType(config, 'ext-off', {bookExt: 'fb2', bookFile: '/b/h'}), null);
    assert.strictEqual(resolveExternalByFileType(config, 'ext-fbz', {bookExt: 'fb2', bookFile: '/b/h'}), null); // onlyExt
});

test('resolveExternal: BOOKEXT/EXTDIR/RESULTFILE/FILENAME/cmdLine', () => {
    const t = resolveExternal(config, 'fbz', {
        bookExt: '.EPUB',
        bookFile: '/b/h',
        downFileName: 'bookname.epub',
    });
    assert.ok(t);
    assert.strictEqual(t.type, 'download');
    assert.strictEqual(t.extVar.BOOKEXT, 'epub');
    assert.strictEqual(t.extVar.EXTDIR, path.dirname(config.externalToolsConfig));
    assert.strictEqual(t.resultFile, '/b/h.fb2.zip');
    assert.strictEqual(t.filename, 'bookname.fb2.zip');
    assert.ok(t.cmdLine.includes('epub'));
    assert.ok(t.cmdLine.includes(path.dirname(config.externalToolsConfig)));
    assert.ok(t.cmdLine.includes('h'));          // HASHFILE
    assert.ok(t.cmdLine.includes('bookname.fb2.zip')); // FILENAME
});

test('resolveExternal: null если не активен/не разрешён', () => {
    assert.strictEqual(resolveExternal(config, 'off', {bookExt: 'fb2', bookFile: '/b/h'}), null);
    assert.strictEqual(resolveExternal(config, 'fbz', {bookExt: 'fb2', bookFile: '/b/h'}), null);
});

// --- getOpdsExternalLinks ---

test('getOpdsExternalLinks: только type=download, rel=acquisition', () => {
    const bookInfo = {book: {ext: 'epub'}, link: '/book/hash'};
    const links = getOpdsExternalLinks(config, bookInfo);

    // pdf (download, onlyExt нет) + fbz (download, onlyExt epub/docx → epub проходит)
    assert.strictEqual(links.length, 2);
    for (const l of links) {
        assert.strictEqual(l.rel, 'http://opds-spec.org/acquisition');
        assert.ok(l.href.startsWith('/book/hash/ext-'));
        assert.ok(l.type.startsWith('application/'));
    }
    const keys = links.map(l => l.href.split('ext-')[1]).sort();
    assert.deepStrictEqual(keys, ['fbz', 'pdf']);
});

test('getOpdsExternalLinks: gui/off не попадают', () => {
    const bookInfo = {book: {ext: 'fb2'}, link: '/book/hash'};
    const links = getOpdsExternalLinks(config, bookInfo);
    const hrefs = links.map(l => l.href);
    assert.ok(!hrefs.some(h => h.includes('ext-gui')));
    assert.ok(!hrefs.some(h => h.includes('ext-off')));
});

test('getOpdsExternalLinks: externalToolsEnabled: false → []', () => {
    const bookInfo = {book: {ext: 'fb2'}, link: '/book/hash'};
    const cfg = Object.assign({}, config, {externalToolsEnabled: false});
    assert.deepStrictEqual(getOpdsExternalLinks(cfg, bookInfo), []);
});

test('getOpdsExternalLinks: bookInfo: null → []', () => {
    assert.deepStrictEqual(getOpdsExternalLinks(config, null), []);
    assert.deepStrictEqual(getOpdsExternalLinks(config, {}), []);
    assert.deepStrictEqual(getOpdsExternalLinks(config, {book: null}), []);
});

test('getOpdsExternalLinks: только base acquisition без external (config.external пуст)', () => {
    const cfg = {external: null};
    assert.deepStrictEqual(getOpdsExternalLinks(cfg, {book: {ext: 'fb2'}, link: '/b/h'}), []);
});