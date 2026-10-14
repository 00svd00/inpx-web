const BasePage = require('./BasePage');

class BookReviewsPage extends BasePage {
    constructor(config) {
        super(config);

        this.id = 'book_reviews';
        this.title = 'Рецензии';
    }

    renderReview(r) {
        let text = (r.text || '').replace(/<br\s*\/?>/gi, '\n');
        text = text.replace(/<[^>]+>/g, '');
        text = this.escape(text).replace(/\n/g, '<br/>');

        const name = r.name ? this.escape(r.name) : 'Аноним';
        const time = r.time ? this.escape(r.time) : '';

        return `<p><b>${name}</b>${time ? ` — ${time}` : ''}</p><p>${text}</p>`;
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

        let content = '';
        let bookInfo = null;
        let pageTitle = 'Рецензии';

        if (!bookUid) {
            content = '<p>Не указан идентификатор книги.</p>';
        } else if (!this.config.reviewsEnabled) {
            content = '<p>Рецензии недоступны.</p>';
        } else {
            // информация о книге (для acquisition и заголовка)
            try {
                const res = await this.webWorker.getBookInfo(bookUid);
                bookInfo = res.bookInfo;
                if (bookInfo && bookInfo.book.title)
                    pageTitle = `Рецензии: ${bookInfo.book.title}`;
            } catch (e) {
                bookInfo = null;
            }

            // рецензии
            try {
                const reviews = await this.webWorker.getBookReviews(bookUid);

                content = `<h2>Рецензии (${reviews.foundCount || 0})</h2>`;
                if (reviews.declaredCount && reviews.sum) {
                    const avg = (reviews.sum / reviews.declaredCount).toFixed(1);
                    content += `<p>Оценок: ${reviews.declaredCount}, средняя: ${avg}</p>`;
                }

                if (!reviews.reviews.length) {
                    content += '<p>Тексты рецензий не найдены.</p>';
                } else {
                    for (const r of reviews.reviews)
                        content += this.renderReview(r);
                }
            } catch (e) {
                content = `<p>Ошибка: ${this.escape(e.message)}</p>`;
            }
        }

        const entry = this.makeEntry({
            id: 'reviews',
            title: pageTitle,
            content: {
                '*ATTRS': {type: 'text/html'},
                '*TEXT': this.escape(content),
            },
        });

        // acquisition — ссылка на скачивание книги (если знаем)
        if (bookInfo) {
            const ext = bookInfo.book.ext || 'fb2';
            entry.link = [
                this.downLink({
                    href: bookInfo.link,
                    type: `application/${ext}`,
                    title: `Скачать «${bookInfo.book.title || ''}» (${ext})`,
                }),
                this.downLink({
                    href: `${bookInfo.link}/zip`,
                    type: `application/${ext}+zip`,
                    title: `Скачать «${bookInfo.book.title || ''}» (${ext}.zip)`,
                }),
            ];
        }

        result.entry = [entry];

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