const BasePage = require('./BasePage');

class BookAuthorsPage extends BasePage {
    constructor(config) {
        super(config);

        this.id = 'book_authors';
        this.title = 'Об авторах';
    }

    async body(req) {
        const result = {};

        const bookUid = req.query.uid;

        // self-ссылка формируется вручную, без req.originalUrl
        const selfHref = bookUid
            ? `${this.opdsRoot}/book/authors?uid=${encodeURIComponent(bookUid)}`
            : `${this.opdsRoot}/book/authors`;

        result.link = [
            this.makeLink({href: `${this.opdsRoot}/opensearch`, rel: 'search', type: 'application/opensearchdescription+xml'}),
            this.makeLink({href: `${this.opdsRoot}/search?term={searchTerms}`, rel: 'search', type: 'application/atom+xml'}),
            this.navLink({rel: 'start'}),
            this.acqLink({rel: 'self', href: selfHref, hrefAsIs: true}),
        ];

        let bookInfo = null;
        let pageTitle = 'Об авторах';
        const entries = [];

        if (!bookUid) {
            // пусто
        } else if (!this.config.authorsBioEnabled) {
            // пусто
        } else {
            // информация о книге (для fallback acquisition и заголовка)
            try {
                const res = await this.webWorker.getBookInfo(bookUid);
                bookInfo = res.bookInfo;
                if (bookInfo && bookInfo.book.title)
                    pageTitle = `Об авторах: ${bookInfo.book.title}`;
            } catch (e) {
                bookInfo = null;
            }

            if (bookInfo) {
                let authors = [];
                try {
                    authors = await this.webWorker.getBookAuthors(bookUid);
                } catch (e) {
                    authors = [];
                }

                for (const author of authors) {
                    if (!author.found)
                        continue;

                    const e = this.makeEntry({
                        id: `author-${author.hash}`,
                        title: author.name,
                    });

                    // биография
                    let bio = null;
                    try {
                        bio = await this.webWorker.getAuthorBio(author.hash);
                    } catch (e) {
                        bio = null;
                    }

                    if (bio) {
                        e.content = {
                            '*ATTRS': {type: 'text/html'},
                            '*TEXT': this.escape(bio),
                        };
                    }

                    // фото — абсолютный URL, обычный HTTP
                    const photoHref = `${this.config.rootPathStatic}/author/photo?hash=${encodeURIComponent(author.hash)}`;

                    e.link = [
                        this.imgLink({href: photoHref, type: 'image/jpeg'}),
                        this.imgLink({href: photoHref, type: 'image/jpeg', thumb: true}),
                    ];

                    // fallback acquisition — ссылка на книгу,
                    // если читалка не показывает запись без acquisition
                    if (bookInfo) {
                        const ext = bookInfo.book.ext || 'fb2';
                        e.link.push(this.downLink({
                            href: bookInfo.link,
                            type: `application/${ext}`,
                            title: `Скачать «${bookInfo.book.title || ''}» (${ext})`,
                        }));
                    }

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

module.exports = BookAuthorsPage;