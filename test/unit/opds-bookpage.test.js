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

function bookInfo(uid = 'u', ext = 'fb2', opts = {}) {
    return {
        bookInfo: {
            book: {
                title: 'T',
                author: opts.author !== undefined ? opts.author : 'A',
                genre: 'sf', ext, lang: 'ru',
                series: opts.series !== undefined ? opts.series : '',
                serno: opts.serno !== undefined ? opts.serno : 0,
                del: 0, size: 0, date: '2024-01-01', file: 'f', folder: 'fo',
                libid: '', insno: 0, librate: 0, keywords: '',
            },
            link: '/book/hash',
            cover: '',
            bookInfo: {
                titleInfo: {
                    author: ['A'], bookTitle: 'T', genre: ['sf'],
                    lang: 'ru', date: '2024-01-01',
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

test('opdsBookAddonsInCard: false — нет related доп. материалов, счётчики не дёргаются', async () => {
    const {page, webWorker} = make({
        config: {opdsBookAddonsInCard: false, reviewsEnabled: true, authorsBioEnabled: true},
        ww: {getBookInfo: () => bookInfo()},
    });
    const xml = await page.body({query: {uid: 'u'}, originalUrl: '/opds/book?uid=u'});

    // навигационные related — есть всегда
    assert.ok(xml.includes('rel="related"'), 'навигационные related expected');
    assert.ok(xml.includes('Другие книги'));

    // доп. материалы — нет
    assert.ok(!xml.includes('/opds/book/reviews'));
    assert.ok(!xml.includes('/opds/book/authors'));

    // счётчики не дёргались
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

test('navToRelated: автор + серия → 2 ссылки, порядок автор→серия', () => {
    const {page} = make({config: {}, ww: {}});
    const links = page.navToRelated(bookInfo('u', 'fb2', {author: 'Иванов Иван', series: 'Серия А', serno: 3}).bookInfo);
    assert.strictEqual(links.length, 2);
    assert.ok(links[0].href.startsWith('/author?author=%3D'));
    assert.ok(links[0].title.includes('Иванов Иван'));
    assert.ok(links[1].href.startsWith('/series?series=%3D'));
    assert.ok(links[1].title.includes('Серия А'));
    assert.ok(links[1].title.includes('#3'));
});

test('navToRelated: только автор → 1 ссылка', () => {
    const {page} = make({config: {}, ww: {}});
    const links = page.navToRelated(bookInfo('u', 'fb2', {author: 'Иванов Иван', series: ''}).bookInfo);
    assert.strictEqual(links.length, 1);
    assert.ok(links[0].href.includes('author='));
});

test('navToRelated: только серия → 1 ссылка', () => {
    const {page} = make({config: {}, ww: {}});
    const links = page.navToRelated(bookInfo('u', 'fb2', {author: '', series: 'Серия А'}).bookInfo);
    assert.strictEqual(links.length, 1);
    assert.ok(links[0].href.includes('series='));
});

test('navToRelated: без автора/серии → 0 ссылок', () => {
    const {page} = make({config: {}, ww: {}});
    const links = page.navToRelated(bookInfo('u', 'fb2', {author: '', series: ''}).bookInfo);
    assert.strictEqual(links.length, 0);
});

test('navToRelated: encodeURIComponent =<name>, без двойного ==', () => {
    const {page} = make({config: {}, ww: {}});
    const links = page.navToRelated(bookInfo('u', 'fb2', {author: 'Иванов Иван'}).bookInfo);
    assert.ok(links[0].href.startsWith('/author?author=%3D'));
    assert.ok(!links[0].href.includes('=='));
});

test('navToRelated: берётся только первый автор (trim)', () => {
    const {page} = make({config: {}, ww: {}});
    const links = page.navToRelated(bookInfo('u', 'fb2', {author: ' Иванов Иван , Петров Пётр'}).bookInfo);
    assert.ok(links[0].title.includes('Иванов Иван'));
    assert.ok(!links[0].title.includes('Петров'));
});

test('body: acquisition первыми, затем навигационные related, затем reviews/bio related', async () => {
    const {page} = make({
        config: {opdsBookAddonsInCard: true, reviewsEnabled: true, authorsBioEnabled: true},
        ww: {
            getBookInfo: () => bookInfo('u', 'fb2', {author: 'A', series: 'S'}),
            getBookReviewsCount: () => ({declaredCount: 2, sum: 8}),
            getBookAuthors: () => [{name: 'A', hash: 'h1', found: true}],
        },
    });
    const xml = await page.body({query: {uid: 'u'}, originalUrl: '/opds/book?uid=u'});

    const iAcq = xml.indexOf('opds-spec.org/acquisition');
    const iNavAuthor = xml.indexOf('/opds/author?author=');
    const iNavSeries = xml.indexOf('/opds/series?series=');
    const iReviews = xml.indexOf('/opds/book/reviews');
    const iAuthors = xml.indexOf('/opds/book/authors');

    assert.ok(iAcq >= 0 && iNavAuthor > iAcq, 'acquisition раньше навигации');
    assert.ok(iNavAuthor < iNavSeries, 'автор раньше серии');
    assert.ok(iNavSeries < iReviews, 'навигация раньше reviews');
    assert.ok(iReviews < iAuthors, 'reviews раньше authors');
});

test('навигационные related есть и при opdsBookAddonsInCard: true, и при false', async () => {
    for (const flag of [true, false]) {
        const {page} = make({
            config: {opdsBookAddonsInCard: flag, reviewsEnabled: false, authorsBioEnabled: false},
            ww: {getBookInfo: () => bookInfo('u', 'fb2', {author: 'A', series: 'S'})},
        });
        const xml = await page.body({query: {uid: 'u'}, originalUrl: '/opds/book?uid=u'});
        assert.ok(xml.includes('Другие книги'), `flag=${flag}: автор`);
        assert.ok(xml.includes('Серия:'), `flag=${flag}: серия`);
    }
});

