const BasePage = require('./BasePage');

class BookReviewsPage extends BasePage {
    constructor(config) {
        super(config);

        this.id = 'book_reviews';
        this.title = 'Рецензии';
    }

    renderReviewHtml(r) {
        let text = (r.text || '').replace(/<br\s*\/?>/gi, '\n');
        text = text.replace(/<[^>]+>/g, '');
        text = this.escape(text).replace(/\n/g, '<br/>');

        const name = r.name ? this.escape(r.name) : 'Аноним';
        const time = r.time ? this.escape(r.time) : '';

        return `<p><b>${name}</b>${time ? ` — ${time}` : ''}</p><p>${text}</p>`;
    }

    reviewTitle(r, index) {
        const name = r.name || 'Аноним';
        const time = r.time ? ` (${r.time})` : '';
        return `Рецензия #${index + 1} от ${name}${time}`;
    }

    async body(req) {
        const result = {};

        const bookUid = req.query.uid;

        // self-ссылка формируется вручную, без req.originalUrl
        const selfHref = bookUid
            ? `${this.opdsRoot}/book/reviews?uid=${encodeURIComponent(bookUid)}`
            : `${this.opdsRoot}/book/reviews`;

        result.link = [
            this.makeLink({href: `${this.opdsRoot}/opensearch`, rel: 'search', type: 'application/opensearchdescription+xml'}),
            this.makeLink({href: `${this.opdsRoot}/search?term={searchTerms}`, rel: 'search', type: 'application/atom+xml'}),
            this.navLink({rel: 'start'}),
            this.acqLink({rel: 'self', href: selfHref, hrefAsIs: true}),
        ];

        const entries = [];
        let bookInfo = null;
        let pageTitle = 'Рецензии';

        if (!bookUid) {
            entries.push(
                this.makeEntry({
                    id: 'no-uid',
                    title: '[Не указан идентификатор книги]',
                    link: this.navLink({href: '/root'}),
                })
            );
        } else if (!this.config.reviewsEnabled) {
            entries.push(
                this.makeEntry({
                    id: 'reviews-disabled',
                    title: '[Рецензии недоступны]',
                    link: this.navLink({href: `/book?uid=${encodeURIComponent(bookUid)}&direct=1`}),
                })
            );
        } else {
            // информация о книге (для заголовка фида и fallback acquisition)
            try {
                const res = await this.webWorker.getBookInfo(bookUid);
                bookInfo = res.bookInfo;
            } catch (e) {
                bookInfo = null;
            }

            const bookTitle = (bookInfo && bookInfo.book.title) || '';

            // рецензии
            let reviews = null;
            try {
                reviews = await this.webWorker.getBookReviews(bookUid);
            } catch (e) {
                reviews = null;
            }

            // title фида со сводкой
            if (bookTitle) {
                pageTitle = `Рецензии: ${bookTitle}`;
            }

            const list = (reviews && reviews.reviews) ? reviews.reviews : [];

            if (!list.length) {
                entries.push(
                    this.makeEntry({
                        id: `reviews-empty-${bookUid}`,
                        title: '[Тексты рецензий не найдены]',
                        link: this.navLink({href: `/book?uid=${encodeURIComponent(bookUid)}&direct=1`}),
                    })
                );
            } else {
                const ext = (bookInfo && bookInfo.book.ext) || 'fb2';
                const bookLink = bookInfo ? bookInfo.link : null;

                for (let i = 0; i < list.length; i++) {
                    const r = list[i];

                    const e = this.makeEntry({
                        id: `review-${bookUid}-${i}`,
                        title: this.reviewTitle(r, i),
                        content: {
                            '*ATTRS': {type: 'text/html'},
                            '*TEXT': this.escape(this.renderReviewHtml(r)),
                        },
                    });

                    e.link = [];

                    // fallback acquisition: некоторые читалки не показывают entry без acquisition.
                    // Ссылка ведёт на скачивание книги, к которой относится рецензия.
                    if (bookLink) {
                        e.link.push(this.downLink({
                            href: bookLink,
                            type: `application/${ext}`,
                            title: `Скачать «${bookTitle}» (${ext})`,
                        }));
                    }

                    // навигация обратно к карточке книги
                    e.link.push(this.navLink({href: `/book?uid=${encodeURIComponent(bookUid)}&direct=1`}));

                    entries.push(e);
                }
            }
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

module.exports = BookReviewsPage;