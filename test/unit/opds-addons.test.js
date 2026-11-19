const test = require('node:test');
const assert = require('node:assert');
const BookAddonsPage = require('../../server/core/opds/BookAddonsPage');
const { makePage } = require('../helpers/opdsPage');
const { makeFakeWebWorker } = require('../helpers/fakeWebWorker');

function make(opts = {}) {
    const webWorker = makeFakeWebWorker(opts.ww || {});
    const page = makePage(BookAddonsPage, { config: opts.config, webWorker });
    return {page, webWorker};
}

test('body: карточка + nav + addons как entries', async () => {
    const {page} = make({
        config: {reviewsEnabled: true, authorsBioEnabled: true},
        ww: {
            getBookRecord: () => ({
                _uid: 'u', title: 'T', author: 'A', series: 'S', serno: 1, ext: 'fb2',
            }),
            getBookReviewsCount: () => ({declaredCount: 2, sum: 8}),
            getBookAuthors: () => [{name: 'A', hash: 'h1', found: true}],
        },
    });
    const xml = await page.body({query: {uid: 'u'}, originalUrl: '/opds/book/addons?uid=u'});

    const iCard = xml.indexOf('book-u');
    const iNavAuthor = xml.indexOf('author-books-u');
    const iNavSeries = xml.indexOf('series-books-u');
    const iRev = xml.indexOf('reviews-u');
    const iAuthors = xml.indexOf('authors-u');

    assert.ok(iCard >= 0, 'карточка');
    assert.ok(iNavAuthor > iCard, 'автор после карточки');
    assert.ok(iNavSeries > iNavAuthor, 'серия после автора');
    assert.ok(iRev > iNavSeries, 'рецензии после навигации');
    assert.ok(iAuthors > iRev, 'авторы после рецензий');
});

test('body: ядровые nav/addons — rel=subsection в каталоге', async () => {
    const {page} = make({
        config: {reviewsEnabled: true, authorsBioEnabled: false},
        ww: {
            getBookRecord: () => ({_uid: 'u', title: 'T', author: 'A', series: 'S', ext: 'fb2'}),
            getBookReviewsCount: () => ({declaredCount: 2, sum: 8}),
        },
    });
    const xml = await page.body({query: {uid: 'u'}, originalUrl: '/opds/book/addons?uid=u'});

    // все ссылки в каталоге — subsection
    assert.ok(xml.includes('rel="subsection"'));
    assert.ok(!xml.includes('rel="related"'));
});

test('body: без автора/серии — только карточка', async () => {
    const {page} = make({
        config: {reviewsEnabled: false, authorsBioEnabled: false},
        ww: {
            getBookRecord: () => ({_uid: 'u', title: 'T', author: '', series: '', ext: 'fb2'}),
        },
    });
    const xml = await page.body({query: {uid: 'u'}, originalUrl: '/opds/book/addons?uid=u'});
    assert.ok(!xml.includes('author-books-'));
    assert.ok(!xml.includes('series-books-'));
});

test('body: без uid — entry [Не указан идентификатор]', async () => {
    const {page} = make({config: {}});
    const xml = await page.body({query: {}, originalUrl: '/opds/book/addons'});
    assert.ok(xml.includes('no-uid'));
    assert.ok(xml.includes('Не указан идентификатор'));
});

test('body: книга не найдена — entry [Книга не найдена]', async () => {
    const {page} = make({
        config: {},
        ww: {getBookRecord: () => null},
    });
    const xml = await page.body({query: {uid: 'u'}, originalUrl: '/opds/book/addons?uid=u'});
    assert.ok(xml.includes('[Книга не найдена]'));
});