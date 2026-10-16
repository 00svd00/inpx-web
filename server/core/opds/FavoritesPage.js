const BasePage = require('./BasePage');
const Favorites = require('../Favorites');

class FavoritesPage extends BasePage {
    constructor(config) {
        super(config);

        this.id = 'favorites';
        this.title = 'Избранное';

        this.favorites = new Favorites(config);
    }

    async body(req) {
        const result = {};

        result.link = this.baseLinks(req, true);

        // удаление: /opds/favorites?del=<uid>
        if (req.query.del)
            await this.favorites.remove(req.query.del);

        const page = parseInt(req.query.page, 10) || 1;
        const limit = 100;
        const offset = (page - 1)*limit;

        const {books, total} = await this.webWorker.getFavorites(offset, limit);

        const entry = [];
        for (const book of books) {
            if (book.deleted)
                continue;

            const series = (book.series ? ` (Серия: ${book.series}${book.serno ? ` #${book.serno}` : ''})` : '');

            entry.push(
                this.makeEntry({
                    id: book.uid,
                    title: `${book.title || 'Без названия'}${book.ext ? ` (${book.ext})` : ''}`,
                    link: this.acqLink({href: `/book?uid=${encodeURIComponent(book.uid)}`}),
                    content: {
                        '*ATTRS': {type: 'text'},
                        '*TEXT': `${this.bookAuthor(book.author)}${series}`,
                    },
                })
            );
        }

        if (!entry.length) {
            entry.push(
                this.makeEntry({
                    id: 'empty',
                    title: (page === 1 ? '[Полка пуста, скачайте книгу]' : '[Страница пуста]'),
                    link: this.navLink({href: '/root'}),
                })
            );
        }

        if (total > offset + books.length) {
            entry.push(
                this.makeEntry({
                    id: 'next_page',
                    title: '[Следующая страница]',
                    link: this.navLink({href: `/favorites?page=${page + 1}`}),
                })
            );
        }

        if (page > 1) {
            entry.push(
                this.makeEntry({
                    id: 'prev_page',
                    title: '[Предыдущая страница]',
                    link: this.navLink({href: `/favorites?page=${page - 1}`}),
                })
            );
        }

        result.entry = entry;

        return this.makeBody(result, req);
    }
}

module.exports = FavoritesPage;
