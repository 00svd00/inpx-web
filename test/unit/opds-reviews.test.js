const test = require('node:test');
const assert = require('node:assert');
const BookReviewsPage = require('../../server/core/opds/BookReviewsPage');
const { makePage } = require('../helpers/opdsPage');
const { makeFakeWebWorker } = require('../helpers/fakeWebWorker');

function make(opts = {}) {
    const webWorker = makeFakeWebWorker(opts.ww || {});
    const page = makePage(BookReviewsPage, { config: opts.config, webWorker });
    return {page, webWorker};
}

function bookInfo(title = 'T', ext = 'fb2') {
    return {
        bookInfo: {
            book: {title, ext},
            link: '/book/hash',
            cover: '',
            fb2: false,
        },
    };
}

test('entries: id=review-{uid}-{i}, fallback downLink + navLink', async () => {
    const {page} = make({
        config: {reviewsEnabled: true},
        ww: {
            getBookInfo: () => bookInfo('Книга', 'fb2'),
            getBookReviews: () => ({
                reviews: [
                    {name: 'A', text: 'one', time: '2024-01-01'},
                    {name: 'B', text: 'two', time: '2024-02-01'},
                ],
            }),
        },
    });
    const xml = await page.body({query: {uid: 'u'}, originalUrl: '/opds/book/reviews?uid=u'});

    assert.ok(xml.includes('review-u-0'));
    assert.ok(xml.includes('review-u-1'));
    // fallback acquisition на книгу
    assert.ok(xml.includes('rel="http://opds-spec.org/acquisition"'));
    assert.ok(xml.includes('/book/hash'));
    // navLink обратно на карточку с direct=1
    assert.ok(xml.includes('/book?uid=u&amp;direct=1') || xml.includes('/book?uid=u&direct=1'));
});

test('reviewsEnabled: false → «Рецензии недоступны»', async () => {
    const {page, webWorker} = make({config: {reviewsEnabled: false}});
    const xml = await page.body({query: {uid: 'u'}, originalUrl: '/opds/book/reviews?uid=u'});
    assert.ok(xml.includes('Рецензии недоступны'));
    assert.strictEqual(webWorker.calls.getBookInfo, 0);
    assert.strictEqual(webWorker.calls.getBookReviews, 0);
});

test('reviews=[] → «Тексты рецензий не найдены»', async () => {
    const {page} = make({
        config: {reviewsEnabled: true},
        ww: {
            getBookInfo: () => bookInfo(),
            getBookReviews: () => ({reviews: []}),
        },
    });
    const xml = await page.body({query: {uid: 'u'}, originalUrl: '/opds/book/reviews?uid=u'});
    assert.ok(xml.includes('Тексты рецензий не найдены'));
});

test('пустой bookUid → «Не указан идентификатор книги»', async () => {
    const {page, webWorker} = make({config: {reviewsEnabled: true}});
    const xml = await page.body({query: {}, originalUrl: '/opds/book/reviews'});
    assert.ok(xml.includes('Не указан идентификатор книги'));
    assert.strictEqual(webWorker.calls.getBookInfo, 0);
    assert.strictEqual(webWorker.calls.getBookReviews, 0);
});

test('getBookReviews бросает → «Тексты рецензий не найдены»', async () => {
    const {page} = make({
        config: {reviewsEnabled: true},
        ww: {
            getBookInfo: () => bookInfo(),
            getBookReviews: () => { throw new Error('boom'); },
        },
    });
    const xml = await page.body({query: {uid: 'u'}, originalUrl: '/opds/book/reviews?uid=u'});
    assert.ok(xml.includes('Тексты рецензий не найдены'));
});

test('html-экранирование текста рецензии', async () => {
    const {page} = make({
        config: {reviewsEnabled: true},
        ww: {
            getBookInfo: () => bookInfo(),
            getBookReviews: () => ({
                reviews: [{name: '<b>A</b>', text: '<script>x</script>', time: ''}],
            }),
        },
    });
    const xml = await page.body({query: {uid: 'u'}, originalUrl: '/opds/book/reviews?uid=u'});
    assert.ok(!xml.includes('<script>'));
    assert.ok(xml.includes('&lt;script&gt;') || xml.includes('&lt;b&gt;'));
});