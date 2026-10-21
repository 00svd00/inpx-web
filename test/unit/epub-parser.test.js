const test = require('node:test');
const assert = require('node:assert');
const EpubParser = require('../../server/core/epub/EpubParser');
const { makeEpubZip } = require('../helpers/epub');
const { makeTmpDir, cleanup } = require('../helpers/tmpdir');
const { readArchiveEntry, listArchiveEntries } = require('../../server/core/book/bookImages');
const { sanitizeHtml } = require('../../server/core/sanitize');
const fs = require('fs-extra');
const path = require('path');

function opfText({title = 'T', creators = [], subjects = [], lang = 'ru', date = '2020-01-01', description = '', series = null, seriesIndex = null, identifier = null} = {}) {
    const creatorsXml = creators.map(c => `<dc:creator>${c}</dc:creator>`).join('');
    const subjectsXml = subjects.map(s => `<dc:subject>${s}</dc:subject>`).join('');
    let metaXml = '';
    if (series !== null)
        metaXml += `<meta name="calibre:series" content="${series}"/>`;
    if (seriesIndex !== null)
        metaXml += `<meta name="calibre:series_index" content="${seriesIndex}"/>`;
    if (identifier !== null)
        metaXml += `<dc:identifier>${identifier}</dc:identifier>`;
    return `<?xml version="1.0" encoding="utf-8"?><package><metadata>`
        + `<dc:title>${title}</dc:title>`
        + creatorsXml
        + subjectsXml
        + `<dc:language>${lang}</dc:language>`
        + `<dc:date>${date}</dc:date>`
        + (description ? `<dc:description>${description}</dc:description>` : '')
        + metaXml
        + `</metadata><manifest/><spine/></package>`;
}

async function parseZip(zipFile) {
    const entries = await listArchiveEntries(zipFile);
    const opfEntry = entries.find(e => e === 'content.opf');
    const buf = await readArchiveEntry(zipFile, opfEntry);
    const parser = new EpubParser();
    parser.fromString(buf.toString('utf8'), {
        lowerCase: true,
        pickNode: route => route.indexOf('package/metadata') === 0 || route === 'package',
    });
    return parser;
}

test('EpubParser: bookInfo (title/author/genre/lang/date/annotation)', async () => {
    const dir = await makeTmpDir();
    try {
        const zip = path.join(dir, 'b.epub');
        const opf = opfText({
            title: 'Название',
            creators: ['Автор 1', 'Автор 2'],
            subjects: ['sf', 'detective'],
            lang: 'ru',
            date: '2020-01-01',
            description: 'Аннотация',
        });
        await makeEpubZip(zip, {fullPath: 'content.opf', files: {'content.opf': Buffer.from(opf)}});

        const parser = await parseZip(zip);
        const bi = parser.bookInfo();

        assert.ok(bi.titleInfo);
        assert.strictEqual(bi.titleInfo.bookTitle, 'Название');
        assert.deepStrictEqual(bi.titleInfo.author, ['Автор 1', 'Автор 2']);
        assert.deepStrictEqual(bi.titleInfo.genre, ['sf', 'detective']);
        assert.strictEqual(bi.titleInfo.lang, 'ru');
        assert.strictEqual(bi.titleInfo.date, '2020-01-01');
        assert.strictEqual(bi.titleInfo.annotationHtml, 'Аннотация');
    } finally { await cleanup(dir); }
});

test('EpubParser: calibre:series/series_index', async () => {
    const dir = await makeTmpDir();
    try {
        const zip = path.join(dir, 'b.epub');
        const opf = opfText({series: 'Серия', seriesIndex: '3'});
        await makeEpubZip(zip, {fullPath: 'content.opf', files: {'content.opf': Buffer.from(opf)}});

        const parser = await parseZip(zip);
        const bi = parser.bookInfo();
        assert.deepStrictEqual(bi.titleInfo.sequence, [{name: 'Серия', num: '3', lang: null}]);
    } finally { await cleanup(dir); }
});

test('EpubParser: bookInfoList/getDesc', async () => {
    const dir = await makeTmpDir();
    try {
        const zip = path.join(dir, 'b.epub');
        const opf = opfText({title: 'T', creators: ['A'], subjects: ['sf'], identifier: 'id-1'});
        await makeEpubZip(zip, {fullPath: 'content.opf', files: {'content.opf': Buffer.from(opf)}});

        const parser = await parseZip(zip);
        const bi = parser.bookInfo();
        const info = parser.bookInfoList(bi);
        assert.ok(info.find(i => i.name === 'titleInfo'));
        const desc = parser.getDesc();
        assert.strictEqual(desc.title, 'T');
        assert.deepStrictEqual(desc.author, ['A']);
        assert.deepStrictEqual(desc.genre, ['sf']);
        assert.strictEqual(desc.identifier, 'id-1');
    } finally { await cleanup(dir); }
});

test('EpubParser: пустой OPF → {}', () => {
    const parser = new EpubParser();
    parser.fromString('<?xml version="1.0"?><package/>', {lowerCase: true});
    const bi = parser.bookInfo();
    assert.deepStrictEqual(bi, {});
});

test('EpubParser.bookInfo: dc:description с entities — annotation raw, annotationHtml decoded+sanitized', () => {
    const parser = new EpubParser();
    parser.fromString(
        '<package><metadata>' +
            '<dc:title>T</dc:title>' +
            '<dc:description>&lt;div&gt;text&lt;script&gt;alert(1)&lt;/script&gt;&lt;/div&gt;</dc:description>' +
        '</metadata></package>',
        { lowerCase: true, pickNode: route => route.indexOf('package/metadata') === 0 || route === 'package' }
    );

    const info = parser.bookInfo();

    // raw: entities сохранены как в OPF (симметрия с Fb2Parser.annotation)
    assert.equal(
        info.titleInfo.annotation,
        '&lt;div&gt;text&lt;script&gt;alert(1)&lt;/script&gt;&lt;/div&gt;'
    );

    // clean: entities декодированы (he), теги вне whitelist удалены (sanitizeHtml)
    assert.equal(info.titleInfo.annotationHtml, 'text');
});