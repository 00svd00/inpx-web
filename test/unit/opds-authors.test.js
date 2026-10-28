const test = require('node:test');
const assert = require('node:assert');
const BookAuthorsPage = require('../../server/core/opds/BookAuthorsPage');
const { makePage } = require('../helpers/opdsPage');
const { makeFakeWebWorker } = require('../helpers/fakeWebWorker');

function make(opts = {}) {
    const webWorker = makeFakeWebWorker(opts.ww || {});
    const page = makePage(BookAuthorsPage, { config: opts.config, webWorker });
    return {page, webWorker};
}

function bookInfo(title = 'T') {
    return {
        bookInfo: {
            book: {title, ext: 'fb2'},
            link: '/book/hash',
            cover: '',
            fb2: false,
        },
    };
}

test('entries на каждого found-автора; imgLink на /author/photo?hash=...', async () => {
    const {page} = make({
        config: {authorsBioEnabled: true, rootPathStatic: ''},
        ww: {
            getBookInfo: () => bookInfo('Книга'),
            getBookAuthors: () => [
                {name: 'A', hash: 'h1', found: true},
                {name: 'B', hash: 'h2', found: false},
                {name: 'C', hash: 'h3', found: true},
            ],
            getAuthorBio: (hash) => (hash === 'h1' ? '<b>bio A</b>' : null),
        },
    });
    const xml = await page.body({query: {uid: 'u'}, originalUrl: '/opds/book/authors?uid=u'});

    assert.ok(xml.includes('author-h1'));
    assert.ok(xml.includes('author-h3'));
    assert.ok(!xml.includes('author-h2'));
    assert.ok(xml.includes('/author/photo?hash=h1'));
    assert.ok(xml.includes('rel="http://opds-spec.org/image"'));
    assert.ok(xml.includes('rel="http://opds-spec.org/image/thumbnail"'));
    // fallback acquisition на книгу
    assert.ok(xml.includes('/book/hash'));
});

test('Promise.all: не более 5 getAuthorBio одновременно', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const authors = [];
    for (let i = 0; i < 12; i++)
        authors.push({name: `A${i}`, hash: `h${i}`, found: true});

    const {page} = make({
        config: {authorsBioEnabled: true, rootPathStatic: ''},
        ww: {
            getBookInfo: () => bookInfo(),
            getBookAuthors: () => authors,
            getAuthorBio: async () => {
                inFlight++;
                maxInFlight = Math.max(maxInFlight, inFlight);
                await new Promise(r => setTimeout(r, 5));
                inFlight--;
                return null;
            },
        },
    });

    await page.body({query: {uid: 'u'}, originalUrl: '/opds/book/authors?uid=u'});
    assert.ok(maxInFlight <= 5, `maxInFlight=${maxInFlight}, expected <= 5`);
    assert.ok(maxInFlight >= 2, `maxInFlight=${maxInFlight}, expected >= 2 (Promise.all works)`);
});

test('authorsBioEnabled: false → пустой фид', async () => {
    const {page, webWorker} = make({config: {authorsBioEnabled: false}});
    const xml = await page.body({query: {uid: 'u'}, originalUrl: '/opds/book/authors?uid=u'});
    assert.ok(!xml.includes('author-h'));
    assert.strictEqual(webWorker.calls.getBookInfo, 0);
    assert.strictEqual(webWorker.calls.getBookAuthors, 0);
});

test('пустой bookUid → пустой фид', async () => {
    const {page, webWorker} = make({config: {authorsBioEnabled: true}});
    const xml = await page.body({query: {}, originalUrl: '/opds/book/authors'});
    assert.ok(!xml.includes('author-h'));
    assert.strictEqual(webWorker.calls.getBookInfo, 0);
});

test('bookInfo null → пустой фид, getBookAuthors не дёргается', async () => {
    const {page, webWorker} = make({
        config: {authorsBioEnabled: true, rootPathStatic: ''},
        ww: {
            getBookInfo: () => ({bookInfo: null}),
            getBookAuthors: () => [{name: 'A', hash: 'h1', found: true}],
            getAuthorBio: () => null,
        },
    });
    const xml = await page.body({query: {uid: 'u'}, originalUrl: '/opds/book/authors?uid=u'});
    assert.ok(!xml.includes('author-h1'));
    assert.ok(!xml.includes('/book/hash'));
    assert.strictEqual(webWorker.calls.getBookAuthors, 0);
});

test('rootPathStatic учитывается в imgLink', async () => {
    const {page} = make({
        config: {authorsBioEnabled: true, rootPathStatic: '/flibusta'},
        ww: {
            getBookInfo: () => bookInfo(),
            getBookAuthors: () => [{name: 'A', hash: 'h1', found: true}],
            getAuthorBio: () => null,
        },
    });
    const xml = await page.body({query: {uid: 'u'}, originalUrl: '/opds/book/authors?uid=u'});
    assert.ok(xml.includes('/flibusta/author/photo?hash=h1'));
});

test('found-автор: related «Все книги», не subsection', async () => {
    const {page} = make({
        config: {authorsBioEnabled: true, rootPathStatic: ''},
        ww: {
            getBookInfo: () => bookInfo('Книга'),
            getBookAuthors: () => [{name: 'Иванов Иван', hash: 'h1', found: true}],
            getAuthorBio: () => '<b>bio</b>',
        },
    });
    const xml = await page.body({query: {uid: 'u'}, originalUrl: '/opds/book/authors?uid=u'});

    assert.ok(xml.includes('rel="related"'));
    assert.ok(xml.includes('Все книги: Иванов Иван'));
    assert.ok(xml.includes('/opds/author?author=%3D'));
});

test('не found-автор: без навигации «Все книги»', async () => {
    const {page} = make({
        config: {authorsBioEnabled: true, rootPathStatic: ''},
        ww: {
            getBookInfo: () => bookInfo(),
            getBookAuthors: () => [{name: 'A', hash: 'h1', found: false}],
            getAuthorBio: () => null,
        },
    });
    const xml = await page.body({query: {uid: 'u'}, originalUrl: '/opds/book/authors?uid=u'});
    assert.ok(!xml.includes('Все книги:'));
});

test('регресс Tolino: в entry автора нет plain-ссылки без rel (нет subsection)', async () => {
    const {page} = make({
        config: {authorsBioEnabled: true, rootPathStatic: ''},
        ww: {
            getBookInfo: () => bookInfo(),
            getBookAuthors: () => [{name: 'A', hash: 'h1', found: true}],
            getAuthorBio: () => null,
        },
    });
    const xml = await page.body({query: {uid: 'u'}, originalUrl: '/opds/book/authors?uid=u'});

    // все <link> в entry имеют rel=
    const entryMatch = xml.match(/<entry>[\s\S]*?<\/entry>/);
    assert.ok(entryMatch, 'entry expected');
    const links = entryMatch[0].match(/<link [^>]*\/>/g) || [];
    for (const l of links) {
        assert.ok(/\brel="/.test(l), `plain link found (без rel): ${l}`);
    }
});