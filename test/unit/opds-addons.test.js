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