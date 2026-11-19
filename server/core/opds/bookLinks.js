// Единая точка сбора ссылок для карточки книги и каталога addons.
// Возвращает категории, порядок внутри каждой фиксирован. Рендереры
// (BookPage/BookAddonsPage) решают, что куда класть, с учётом
// config.opdsBookAddonsInCard.
//
// Правило размещения:
//   opdsBookAddonsInCard: true  → всё на карточке (BookPage)
//   opdsBookAddonsInCard: false → acquisition+cover на карточке (direct=1),
//                                 nav+addons — в каталоге (BookAddonsPage)
//
// ctx: {uid, book, bookInfo, config, webWorker, navToRelated, reviewsCount, authorsFound}
//   bookInfo: материализованные данные | null (в каталоге — null)
//   navToRelated: [{href, title}] от BookPage.navToRelated(book)
//   reviewsCount: {declaredCount, sum} | null
//   authorsFound: [{name, hash, found}] | null (только found)
//
// Возвращает:
//   {acquisition: [...], nav: [...], addons: [...], cover: [...]}
//   Все href — абсолютные (с opdsRoot), кроме acquisition (bookInfo.link уже абсолютный).

const hooks = require('../hooks');
const { getOpdsExternalLinks } = require('../externalTools');
const { bookFormats } = require('../book/bookFormats');

async function collectBookLinks(ctx) {
    const {uid, book, bookInfo, config, webWorker, reviewsCount, authorsFound} = ctx;
    const result = {acquisition: [], nav: [], addons: [], cover: []};
    const opdsRoot = config.opdsRoot || '/opds';

    // 1. acquisition: base (zip/raw) — только при материализованном bookInfo
    if (bookInfo && bookInfo.book) {
        const formats = bookFormats(bookInfo.book.ext, bookInfo.link);
        for (const [fileFormat, downHref] of Object.entries(formats))
            result.acquisition.push({href: downHref, type: `application/${fileFormat}`});
    }

    // 2. acquisition: external (download)
    result.acquisition.push(...getOpdsExternalLinks(config, bookInfo));

    // 3. nav (навигация ядра: автор/серия)
    for (const n of makeNavToRelated(book)) {
        result.nav.push({
            key: n.key,
            href: `${opdsRoot}${n.href}`,
            rel: 'related',
            type: 'application/atom+xml;profile=opds-catalog',
            title: n.title,
        });
    }

    // 4. addons: reviews (ядро)
    if (reviewsCount && reviewsCount.declaredCount) {
        let title = `Рецензии (оценок: ${reviewsCount.declaredCount})`;
        if (reviewsCount.sum) {
            const avg = (reviewsCount.sum / reviewsCount.declaredCount).toFixed(1);
            title = `Рецензии (оценок: ${reviewsCount.declaredCount}, средняя: ${avg})`;
        }
        result.addons.push({
            key: 'reviews',
            href: `${opdsRoot}/book/reviews?uid=${encodeURIComponent(uid)}`,
            rel: 'related',
            type: 'application/atom+xml;profile=opds-catalog',
            title,
        });
    }

    // 5. addons: bio
    if (authorsFound && authorsFound.length) {
        result.addons.push({
            key: 'authors',
            href: `${opdsRoot}/book/authors?uid=${encodeURIComponent(uid)}`,
            rel: 'related',
            type: 'application/atom+xml;profile=opds-catalog',
            title: `Об авторах (${authorsFound.length})`,
        });
    }

    // 6. plugin links (hooks): acquisition → acquisition; остальное → addons
    if (hooks.hasOpdsBookLinks()) {
        const pluginLinks = await hooks.runOpdsBookLinks({uid, bookInfo, entry: null});
        for (const l of pluginLinks) {
            if (!l || !l.href)
                continue;
            const rel = l.rel || 'related';
            const item = {
                key: l.key,   // опционально, плагин может задать
                href: l.href,
                rel,
                type: l.type || 'text/html',
                title: l.title || l.href,
            };
            if (rel === 'http://opds-spec.org/acquisition')
                result.acquisition.push(item);
            else
                result.addons.push(item);
        }
    }

    // 7. cover
    if (bookInfo && bookInfo.cover) {
        const coverType = bookInfo.coverType
            || (bookInfo.cover.endsWith('.png') ? 'image/png' : 'image/jpeg');
        result.cover.push({href: bookInfo.cover, type: coverType});
    }

    return result;
}

// navToRelated: автор → серия. key — для стабильного id в BookAddonsPage.
function makeNavToRelated(book) {
    const links = [];
    if (!book)
        return links;

    if (book.author) {
        const firstAuthor = book.author.split(',')[0].trim();
        if (firstAuthor) {
            links.push({
                key: 'author-books',
                href: `/author?author=${encodeURIComponent('=' + firstAuthor)}`,
                title: `Другие книги: ${firstAuthor}`,
            });
        }
    }
    if (book.series) {
        const firstAuthor = book.author ? book.author.split(',')[0].trim() : '';
        let href = `/series?series=${encodeURIComponent('=' + book.series)}`;
        if (firstAuthor)
            href += `&author=${encodeURIComponent('=' + firstAuthor)}`;
        links.push({
            key: 'series-books',
            href,
            title: `Серия: ${book.series}${book.serno ? ` #${book.serno}` : ''}`,
        });
    }
    return links;
}

module.exports = { collectBookLinks, makeNavToRelated };