const BasePage = require('./BasePage');

class BookAddonsPage extends BasePage {
    constructor(config) {
        super(config);

        this.id = 'book_addons';
        this.title = 'Дополнительные материалы';
    }

    // дёшево: два db.select. true, если для книги есть хоть один доп. материал
    async hasAddons(bookUid) {
        if (!bookUid)
            return false;

        if (this.config.reviewsEnabled) {
            try {
                const reviewsCount = await this.webWorker.getBookReviewsCount(bookUid);
                if (reviewsCount && reviewsCount.declaredCount)
                    return true;
            } catch (e) {
                // reviews_disabled / 404 — пропускаем
            }
        }

        if (this.config.authorsBioEnabled) {
            try {
                const authors = await this.webWorker.getBookAuthors(bookUid);
                if (authors.some(a => a.found))
                    return true;
            } catch (e) {
                // authors_disabled / 404 — пропускаем
            }
        }

        return false;
    }

    async body(req) {
        const result = {};

        const bookUid = req.query.uid;

        // self-ссылка формируется вручную, без req.originalUrl
        const selfHref = bookUid
            ? `${this.opdsRoot}/book/addons?uid=${encodeURIComponent(bookUid)}`
            : `${this.opdsRoot}/book/addons`;

        result.link = [
            this.makeLink({href: `${this.opdsRoot}/opensearch`, rel: 'search', type: 'application/opensearchdescription+xml'}),
            this.makeLink({href: `${this.opdsRoot}/search?term={searchTerms}`, rel: 'search', type: 'application/atom+xml'}),
            this.navLink({rel: 'start'}),
            this.acqLink({rel: 'self', href: selfHref, hrefAsIs: true}),
        ];

        const entries = [];
        let pageTitle = 'Дополнительные материалы';

        if (bookUid) {
            // информация о книге (для заголовка и названия entry «Книга»)
            let bookInfo = null;
            try {
                const res = await this.webWorker.getBookInfo(bookUid);
                bookInfo = res.bookInfo;
            } catch (e) {
                bookInfo = null;
            }

            if (bookInfo && bookInfo.book.title)
                pageTitle = `Дополнительные материалы: ${bookInfo.book.title}`;

            // 1. карточка книги — всегда
            if (bookInfo) {
                const b = bookInfo.book;
                const series = b.series ? ` (Серия: ${b.series}${b.serno ? ` #${b.serno}` : ''})` : '';
                entries.push(
                    this.makeEntry({
                        id: `book-${bookUid}`,
                        title: `${b.title || 'Без названия'}${b.ext ? ` (${b.ext})` : ''}`,
                        link: this.navLink({href: `/book?uid=${encodeURIComponent(bookUid)}&direct=1`}),
                        content: {
                            '*ATTRS': {type: 'text'},
                            '*TEXT': `${this.bookAuthor(b.author)}${series}`,
                        },
                    })
                );
            } else {
                // книга не найдена в БД — не должен сюда попасть (hasAddons вернул бы false),
                // но на всякий случай
                entries.push(
                    this.makeEntry({
                        id: `book-${bookUid}`,
                        title: '[Книга]',
                        link: this.navLink({href: `/book?uid=${encodeURIComponent(bookUid)}&direct=1`}),
                    })
                );
            }

            // 2. навигация: другие книги автора/серии
            if (bookInfo) {
                const b = bookInfo.book;
                if (b.author) {
                    const firstAuthor = b.author.split(',')[0].trim();
                    if (firstAuthor) {
                        entries.push(this.makeEntry({
                            id: `author-books-${bookUid}`,
                            title: `Другие книги: ${firstAuthor}`,
                            link: this.navLink({href: `/author?author=${encodeURIComponent('=' + firstAuthor)}`}),
                        }));
                    }
                }
                if (b.series) {
                    entries.push(this.makeEntry({
                        id: `series-books-${bookUid}`,
                        title: `Серия: ${b.series}${b.serno ? ` #${b.serno}` : ''}`,
                        link: this.navLink({href: `/series?series=${encodeURIComponent('=' + b.series)}`}),
                    }));
                }
            }

            // 3. рецензии — только если включены и есть данные
            if (this.config.reviewsEnabled) {
                let reviewsCount = null;
                try {
                    reviewsCount = await this.webWorker.getBookReviewsCount(bookUid);
                } catch (e) {
                    reviewsCount = null;
                }

                if (reviewsCount && reviewsCount.declaredCount) {
                    let reviewsTitle = `Рецензии (оценок: ${reviewsCount.declaredCount})`;
                    if (reviewsCount.sum) {
                        const avg = (reviewsCount.sum / reviewsCount.declaredCount).toFixed(1);
                        reviewsTitle = `Рецензии (оценок: ${reviewsCount.declaredCount}, средняя: ${avg})`;
                    }
                    entries.push(
                        this.makeEntry({
                            id: `reviews-${bookUid}`,
                            title: reviewsTitle,
                            link: this.navLink({href: `/book/reviews?uid=${encodeURIComponent(bookUid)}`}),
                        })
                    );
                }
            }

            // 4. об авторах — только если включено и есть данные
            if (this.config.authorsBioEnabled) {
                try {
                    const authors = await this.webWorker.getBookAuthors(bookUid);
                    const found = authors.filter(a => a.found);
                    if (found.length) {
                        entries.push(
                            this.makeEntry({
                                id: `authors-${bookUid}`,
                                title: `Об авторах (${found.length})`,
                                link: this.navLink({href: `/book/authors?uid=${encodeURIComponent(bookUid)}`}),
                            })
                        );
                    }
                } catch (e) {
                    // authors_disabled / 404 — пропускаем
                }
            }
        } else {
            entries.push(
                this.makeEntry({
                    id: 'no-uid',
                    title: '[Не указан идентификатор книги]',
                    link: this.navLink({href: '/root'}),
                })
            );
        }

        result.entry = entries;

        // временно переопределяем this.title для <feed><title>
        const oldTitle = this.title;
        this.title = pageTitle;
        try {
            return this.makeBody(result, req);
        } finally {
            this.title = oldTitle;
        }
    }
}

module.exports = BookAddonsPage;