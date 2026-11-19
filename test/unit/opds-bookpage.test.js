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

// --- content/аннотация ---

test('e.content: аннотация и Inpx/Fb2 инфо присутствуют', async () => {
    const {page} = make({
        config: {opdsBookAddonsInCard: true, reviewsEnabled: false, authorsBioEnabled: false},
        ww: {getBookInfo: () => bookInfo()},
    });
    const xml = await page.body({query: {uid: 'u'}, originalUrl: '/opds/book?uid=u'});
    assert.ok(xml.includes('type="text/html"'), 'content type=text/html');
    assert.ok(xml.includes('Ann'), 'аннотация');
    assert.ok(xml.includes('Inpx инфо'), 'Inpx инфо');
});

// --- acquisition ---

test('acquisition первыми (форматы + external)', async () => {
    const {page} = make({
        config: {
            opdsBookAddonsInCard: true, reviewsEnabled: false, authorsBioEnabled: false,
            external: {pdf: {active: true, cmd: 'x', type: 'download', ext: 'pdf', title: 'PDF'}},
        },
        ww: {getBookInfo: () => bookInfo()},
    });
    const xml = await page.body({query: {uid: 'u'}, originalUrl: '/opds/book?uid=u'});
    const iAcq = xml.indexOf('opds-spec.org/acquisition');
    const iFb2Zip = xml.indexOf('/book/hash/zip');
    const iPdf = xml.indexOf('/book/hash/ext-pdf');
    assert.ok(iAcq >= 0);
    assert.ok(iFb2Zip >= 0);
    assert.ok(iPdf > iFb2Zip, 'external pdf после базовой acquisition');
});

test('external: onlyExt фильтрует acquisition', async () => {
    const external = {
        fbz: {active: true, cmd: 'x', type: 'download', ext: 'fb2.zip', title: 'FB2 zip', onlyExt: ['epub', 'docx']},
    };

    let {page} = make({
        config: {opdsBookAddonsInCard: true, reviewsEnabled: false, authorsBioEnabled: false, external},
        ww: {getBookInfo: () => bookInfo('u', 'fb2')},
    });
    let xml = await page.body({query: {uid: 'u'}, originalUrl: '/opds/book?uid=u'});
    assert.ok(!xml.includes('/book/hash/ext-fbz'));

    ({page} = make({
        config: {opdsBookAddonsInCard: true, reviewsEnabled: false, authorsBioEnabled: false, external},
        ww: {getBookInfo: () => bookInfo('u', 'epub')},
    }));
    xml = await page.body({query: {uid: 'u'}, originalUrl: '/opds/book?uid=u'});
    assert.ok(xml.includes('/book/hash/ext-fbz'));
});

// --- navToRelated (принимает book, не bookInfo) ---

test('navToRelated: автор + серия → 2 ссылки, порядок автор→серия', () => {
    const {page} = make({config: {}, ww: {}});
    const links = page.navToRelated({
        author: 'Иванов Иван', series: 'Серия А', serno: 3,
    });
    assert.strictEqual(links.length, 2);
    assert.ok(links[0].href.startsWith('/author?author=%3D'));
    assert.ok(links[0].title.includes('Иванов Иван'));
    assert.ok(links[1].href.startsWith('/series?series=%3D'));
    assert.ok(links[1].title.includes('Серия А'));
    assert.ok(links[1].title.includes('#3'));
});

test('navToRelated: только автор → 1 ссылка', () => {
    const {page} = make({config: {}, ww: {}});
    const links = page.navToRelated({author: 'Иванов Иван', series: ''});
    assert.strictEqual(links.length, 1);
    assert.ok(links[0].href.includes('author='));
});

test('navToRelated: только серия → 1 ссылка', () => {
    const {page} = make({config: {}, ww: {}});
    const links = page.navToRelated({author: '', series: 'Серия А'});
    assert.strictEqual(links.length, 1);
    assert.ok(links[0].href.includes('series='));
});

test('navToRelated: без автора/серии → 0 ссылок', () => {
    const {page} = make({config: {}, ww: {}});
    const links = page.navToRelated({author: '', series: ''});
    assert.strictEqual(links.length, 0);
});

test('navToRelated: encodeURIComponent =<name>, без двойного ==', () => {
    const {page} = make({config: {}, ww: {}});
    const links = page.navToRelated({author: 'Иванов Иван'});
    assert.ok(links[0].href.startsWith('/author?author=%3D'));
    assert.ok(!links[0].href.includes('=='));
});

test('navToRelated: берётся только первый автор (trim)', () => {
    const {page} = make({config: {}, ww: {}});
    const links = page.navToRelated({author: ' Иванов Иван , Петров Пётр'});
    assert.ok(links[0].title.includes('Иванов Иван'));
    assert.ok(!links[0].title.includes('Петров'));
});

// --- flag ---

test('opdsBookAddonsInCard: true — reviews/bio на карточке', async () => {
    const {page, webWorker} = make({
        config: {opdsBookAddonsInCard: true, reviewsEnabled: true, authorsBioEnabled: true},
        ww: {
            getBookInfo: () => bookInfo(),
            getBookReviewsCount: () => ({declaredCount: 2, sum: 8}),
            getBookAuthors: () => [{name: 'A', hash: 'h1', found: true}],
        },
    });
    const xml = await page.body({query: {uid: 'u'}, originalUrl: '/opds/book?uid=u'});
    assert.ok(xml.includes('/opds/book/reviews?uid=u'));
    assert.ok(xml.includes('/opds/book/authors?uid=u'));
    assert.strictEqual(webWorker.calls.getBookReviewsCount, 1);
    assert.strictEqual(webWorker.calls.getBookAuthors, 1);
});

test('opdsBookAddonsInCard: false — карточка минимальная (только acquisition+cover)', async () => {
    const {page, webWorker} = make({
        config: {opdsBookAddonsInCard: false, reviewsEnabled: true, authorsBioEnabled: true},
        ww: {getBookInfo: () => bookInfo('u', 'fb2', {author: 'A', series: 'S'})},
    });
    const xml = await page.body({query: {uid: 'u'}, originalUrl: '/opds/book?uid=u'});

    // на карточке при false — ни nav, ни addons (проверяем по href, не по title)
    assert.ok(!xml.includes('/opds/author?author='), 'nav author отсутствует');
    assert.ok(!xml.includes('/opds/series?series='), 'nav series отсутствует');
    assert.ok(!xml.includes('/opds/book/reviews'), 'reviews отсутствуют');
    assert.ok(!xml.includes('/opds/book/authors'), 'authors отсутствуют');

    // acquisition — есть
    assert.ok(xml.includes('opds-spec.org/acquisition'));

    // счётчики не дёргаются
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

// --- порядок ---

test('порядок: acquisition → nav → addons → cover', async () => {
    const {page} = make({
        config: {opdsBookAddonsInCard: true, reviewsEnabled: true, authorsBioEnabled: true},
        ww: {
            getBookInfo: () => {
                const bi = bookInfo('u', 'fb2', {author: 'A', series: 'S'});
                bi.bookInfo.cover = '/book/hash.png';
                bi.bookInfo.coverType = 'image/png';
                return bi;
            },
            getBookReviewsCount: () => ({declaredCount: 2, sum: 8}),
            getBookAuthors: () => [{name: 'A', hash: 'h1', found: true}],
        },
    });
    const xml = await page.body({query: {uid: 'u'}, originalUrl: '/opds/book?uid=u'});

    const iAcq = xml.indexOf('opds-spec.org/acquisition');
    const iNavAuthor = xml.indexOf('/opds/author?author=');
    const iReviews = xml.indexOf('/opds/book/reviews');
    const iAuthors = xml.indexOf('/opds/book/authors');
    const iCover = xml.indexOf('opds-spec.org/image');

    assert.ok(iAcq >= 0 && iNavAuthor > iAcq, 'acquisition раньше nav');
    assert.ok(iNavAuthor < iReviews, 'nav раньше reviews');
    assert.ok(iReviews < iAuthors, 'reviews раньше authors');
    assert.ok(iAuthors < iCover, 'addons раньше cover');
});