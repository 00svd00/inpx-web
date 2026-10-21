const test = require('node:test');
const assert = require('node:assert');
const BookPage = require('../../server/core/opds/BookPage');
const { makePage } = require('../helpers/opdsPage');
const { makeFakeWebWorker } = require('../helpers/fakeWebWorker');

function make(opts = {}) {
    const webWorker = makeFakeWebWorker(opts.ww || {});
    const page = makePage(BookPage, { config: opts.config, webWorker });
    return {page, webWorker};
}

function bookInfo(uid = 'u', ext = 'fb2') {
    return {
        bookInfo: {
            book: {title: 'T', author: 'A', genre: 'sf', ext, lang: 'ru', series: '', serno: 0, del: 0, size: 0, date: '2024-01-01', file: 'f', folder: 'fo', libid: '', insno: 0, librate: 0, keywords: ''},
            link: '/book/hash',
            cover: '',
            bookInfo: {
                titleInfo: {
                    author: ['A'],
                    bookTitle: 'T',
                    genre: ['sf'],
                    lang: 'ru',
                    date: '2024-01-01',
                    annotationHtml: '<p>Ann</p>',
                },
            },
        },
    };
}

test('related-ссылки на рецензии/авторов при opdsBookAddonsInCard: true', async () => {
    const {page, webWorker} = make({
        config: {opdsBookAddonsInCard: true, reviewsEnabled: true, authorsBioEnabled: true},
        ww: {
            getBookInfo: () => bookInfo(),
            getBookReviewsCount: () => ({declaredCount: 2, sum: 8}),
            getBookAuthors: () => [{name: 'A', hash: 'h1', found: true}],
        },
    });
    const xml = await page.body({query: {uid: 'u'}, originalUrl: '/opds/book?uid=u'});
    assert.ok(xml.includes('rel="related"'), 'related link expected');
    assert.ok(xml.includes('/opds/book/reviews?uid=u'));
    assert.ok(xml.includes('/opds/book/authors?uid=u'));
    assert.strictEqual(webWorker.calls.getBookReviewsCount, 1);
    assert.strictEqual(webWorker.calls.getBookAuthors, 1);
});

test('без related при opdsBookAddonsInCard: false; счётчики не дёргаются', async () => {
    const {page, webWorker} = make({
        config: {opdsBookAddonsInCard: false, reviewsEnabled: true, authorsBioEnabled: true},
        ww: {getBookInfo: () => bookInfo()},
    });
    const xml = await page.body({query: {uid: 'u'}, originalUrl: '/opds/book?uid=u'});
    assert.ok(!xml.includes('rel="related"'), 'no related expected');
    assert.ok(!xml.includes('/opds/book/reviews'));
    assert.ok(!xml.includes('/opds/book/authors'));
    assert.strictEqual(webWorker.calls.getBookReviewsCount, 0);
    assert.strictEqual(webWorker.calls.getBookAuthors, 0);
});

test('related на рецензии только если declaredCount > 0', async () => {
    const {page} = make({
        config: {opdsBookAddonsInCard: true, reviewsEnabled: true, authorsBioEnabled: false},
        ww: {
            getBookInfo: () => bookInfo(),
            getBookReviewsCount: () => ({declaredCount: 0, sum: 0}),
        },
    });
    const xml = await page.body({query: {uid: 'u'}, originalUrl: '/opds/book?uid=u'});
    assert.ok(!xml.includes('/opds/book/reviews'));
});

test('related на авторов только если есть found', async () => {
    const {page} = make({
        config: {opdsBookAddonsInCard: true, reviewsEnabled: false, authorsBioEnabled: true},
        ww: {
            getBookInfo: () => bookInfo(),
            getBookAuthors: () => [{name: 'A', hash: 'h1', found: false}],
        },
    });
    const xml = await page.body({query: {uid: 'u'}, originalUrl: '/opds/book?uid=u'});
    assert.ok(!xml.includes('/opds/book/authors'));
});

test('external: download-программы попадают в acquisition', async () => {
    const {page} = make({
        config: {
            opdsBookAddonsInCard: true, reviewsEnabled: false, authorsBioEnabled: false,
            external: {
                pdf: {active: true, cmd: 'x', type: 'download', ext: 'pdf', title: 'PDF'},
                gui: {active: true, cmd: 'y', type: 'gui'},
                off: {active: false, cmd: 'z', type: 'download'},
            },
        },
        ww: {getBookInfo: () => bookInfo()},
    });
    const xml = await page.body({query: {uid: 'u'}, originalUrl: '/opds/book?uid=u'});
    assert.ok(xml.includes('/book/hash/ext-pdf'));
    assert.ok(!xml.includes('/book/hash/ext-gui'));
    assert.ok(!xml.includes('/book/hash/ext-off'));
});

test('external: onlyExt фильтрует acquisition', async () => {
    const external = {
        fbz: {active: true, cmd: 'x', type: 'download', ext: 'fb2.zip', title: 'FB2 zip', onlyExt: ['epub', 'docx']},
    };

    // book.ext = 'fb2' → не пускает
    let {page} = make({
        config: {opdsBookAddonsInCard: true, reviewsEnabled: false, authorsBioEnabled: false, external},
        ww: {getBookInfo: () => bookInfo('u', 'fb2')},
    });
    let xml = await page.body({query: {uid: 'u'}, originalUrl: '/opds/book?uid=u'});
    assert.ok(!xml.includes('/book/hash/ext-fbz'));

    // book.ext = 'epub' → пускает
    ({page} = make({
        config: {opdsBookAddonsInCard: true, reviewsEnabled: false, authorsBioEnabled: false, external},
        ww: {getBookInfo: () => bookInfo('u', 'epub')},
    }));
    xml = await page.body({query: {uid: 'u'}, originalUrl: '/opds/book?uid=u'});
    assert.ok(xml.includes('/book/hash/ext-fbz'));
});