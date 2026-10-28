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

test('hasAddons: reviewsEnabled + declaredCount > 0 → true', async () => {
    const {page, webWorker} = make({
        config: {reviewsEnabled: true, authorsBioEnabled: false},
        ww: {getBookReviewsCount: () => ({declaredCount: 3, sum: 15})},
    });
    assert.strictEqual(await page.hasAddons('uid'), true);
    assert.strictEqual(webWorker.calls.getBookReviewsCount, 1);
    assert.strictEqual(webWorker.calls.getBookAuthors, 0);
});

test('hasAddons: reviewsEnabled + declaredCount 0, authorsBioEnabled false → false', async () => {
    const {page} = make({
        config: {reviewsEnabled: true, authorsBioEnabled: false},
        ww: {getBookReviewsCount: () => ({declaredCount: 0, sum: 0})},
    });
    assert.strictEqual(await page.hasAddons('uid'), false);
});

test('hasAddons: authorsBioEnabled + found → true', async () => {
    const {page} = make({
        config: {reviewsEnabled: false, authorsBioEnabled: true},
        ww: {getBookAuthors: () => [{name: 'A', hash: 'h', found: true}]},
    });
    assert.strictEqual(await page.hasAddons('uid'), true);
});

test('hasAddons: авторы есть, но found=false → false', async () => {
    const {page} = make({
        config: {reviewsEnabled: false, authorsBioEnabled: true},
        ww: {getBookAuthors: () => [{name: 'A', hash: 'h', found: false}]},
    });
    assert.strictEqual(await page.hasAddons('uid'), false);
});

test('hasAddons: обе фичи выключены → false, webWorker не дёргается', async () => {
    const {page, webWorker} = make({config: {reviewsEnabled: false, authorsBioEnabled: false}});
    assert.strictEqual(await page.hasAddons('uid'), false);
    assert.strictEqual(webWorker.calls.getBookReviewsCount, 0);
    assert.strictEqual(webWorker.calls.getBookAuthors, 0);
});

test('hasAddons: пустой bookUid → false', async () => {
    const {page} = make({config: {reviewsEnabled: true, authorsBioEnabled: true}});
    assert.strictEqual(await page.hasAddons(''), false);
    assert.strictEqual(await page.hasAddons(null), false);
});

test('hasAddons: getBookReviewsCount бросает → authorsBio проверяется', async () => {
    const {page} = make({
        config: {reviewsEnabled: true, authorsBioEnabled: true},
        ww: {
            getBookReviewsCount: () => { throw new Error('reviews_disabled'); },
            getBookAuthors: () => [{name: 'A', hash: 'h', found: true}],
        },
    });
    assert.strictEqual(await page.hasAddons('uid'), true);
});

test('body: навигация после карточки, до рецензий', async () => {
    const {page} = make({
        config: {reviewsEnabled: true, authorsBioEnabled: false},
        ww: {
            getBookInfo: () => ({
                bookInfo: {
                    book: {title: 'T', author: 'A', series: 'S', serno: 1, ext: 'fb2'},
                    link: '/book/hash', cover: '',
                    bookInfo: {titleInfo: {author: ['A'], bookTitle: 'T'}},
                },
            }),
            getBookReviewsCount: () => ({declaredCount: 2, sum: 8}),
        },
    });
    const xml = await page.body({query: {uid: 'u'}, originalUrl: '/opds/book/addons?uid=u'});

    const iCard = xml.indexOf('book-u');
    const iNavAuthor = xml.indexOf('/opds/author?author=');
    const iNavSeries = xml.indexOf('/opds/series?series=');
    const iRev = xml.indexOf('Рецензии');

    assert.ok(iCard >= 0 && iNavAuthor > iCard, 'карточка раньше навигации');
    assert.ok(iNavAuthor < iNavSeries, 'автор раньше серии');
    assert.ok(iNavSeries < iRev, 'навигация раньше рецензий');
});

test('body: без автора/серии — нет навигационных entries', async () => {
    const {page} = make({
        config: {reviewsEnabled: false, authorsBioEnabled: false},
        ww: {
            getBookInfo: () => ({
                bookInfo: {
                    book: {title: 'T', author: '', series: '', serno: 0, ext: 'fb2'},
                    link: '/book/hash', cover: '',
                    bookInfo: null,
                },
            }),
        },
    });
    const xml = await page.body({query: {uid: 'u'}, originalUrl: '/opds/book/addons?uid=u'});
    assert.ok(!xml.includes('author-books-'));
    assert.ok(!xml.includes('series-books-'));
});