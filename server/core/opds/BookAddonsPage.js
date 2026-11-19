const BasePage = require('./BasePage');
const { collectBookLinks } = require('./bookLinks');

class BookAddonsPage extends BasePage {
    constructor(config) {
        super(config);
        this.id = 'book_addons';
        this.title = 'Дополнительные материалы';
    }

    navToRelated(book) {
        const links = [];
        if (book.author) {
            const firstAuthor = book.author.split(',')[0].trim();
            if (firstAuthor) {
                links.push({
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
                href,
                title: `Серия: ${book.series}${book.serno ? ` #${book.serno}` : ''}`,
            });
        }
        return links;
    }

    async body(req) {
        const result = {};
        const bookUid = req.query.uid;

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
            const book = await this.webWorker.getBookRecord(bookUid).catch(() => null);

            if (book) {
                pageTitle = `Дополнительные материалы: ${book.title || bookUid}`;

                // карточка книги — subsection на /book?direct=1
                const series = book.series ? ` (Серия: ${book.series}${book.serno ? ` #${book.serno}` : ''})` : '';
                entries.push(this.makeEntry({
                    id: `book-${bookUid}`,
                    title: `${book.title || 'Без названия'}${book.ext ? ` (${book.ext})` : ''}`,
                    link: this.navLink({href: `/book?uid=${encodeURIComponent(bookUid)}&direct=1`}),
                    content: {
                        '*ATTRS': {type: 'text'},
                        '*TEXT': `${this.bookAuthor(book.author)}${series}`,
                    },
                }));

                let reviewsCount = null;
                let authorsFound = null;
                if (this.config.reviewsEnabled) {
                    try { reviewsCount = await this.webWorker.getBookReviewsCount(bookUid); } catch (e) {}
                }
                if (this.config.authorsBioEnabled) {
                    try {
                        const authors = await this.webWorker.getBookAuthors(bookUid);
                        authorsFound = authors.filter(a => a.found);
                    } catch (e) {}
                }

                const L = await collectBookLinks({
                    uid: bookUid,
                    book,
                    bookInfo: null,   // без материализации
                    config: this.config,
                    webWorker: this.webWorker,
                    navToRelated: this.navToRelated(book),
                    reviewsCount,
                    authorsFound,
                });

                // nav + addons — как entries (acquisition/cover не рендерятся в navigation feed)
                let index = 0;
                for (const l of [...L.nav, ...L.addons]) {
                    const id = l.key ? `${l.key}-${bookUid}` : `addon-${bookUid}-${index++}`;

                    // navigation feed: ядровые related+atom → subsection
                    // (ридеры в каталоге ждут subsection для переходов, related в каталоге
                    let rel = l.rel;
                    let type = l.type;
                    if (l.key && rel === 'related' && type === 'application/atom+xml;profile=opds-catalog')
                        rel = 'subsection';

                    entries.push(this.makeEntry({
                        id,
                        title: l.title || l.href,
                        link: this.makeLink({href: l.href, rel, type, title: l.title}),
                    }));
                }
            } else {
                entries.push(this.makeEntry({
                    id: `book-${bookUid}`,
                    title: '[Книга не найдена]',
                    link: this.navLink({href: '/root'}),
                }));
            }
        } else {
            entries.push(this.makeEntry({
                id: 'no-uid',
                title: '[Не указан идентификатор книги]',
                link: this.navLink({href: '/root'}),
            }));
        }

        if (!entries.length) {
            entries.push(this.makeEntry({
                id: 'empty',
                title: '[Дополнительных материалов нет]',
                link: this.navLink({href: '/root'}),
            }));
        }

        result.entry = entries;

        const oldTitle = this.title;
        this.title = pageTitle;
        try {
            return await this.makeBody(result, req);
        } finally {
            this.title = oldTitle;
        }
    }
}

module.exports = BookAddonsPage;