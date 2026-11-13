class SessionStore {
    constructor() {
        this.map = new Map();
    }

    get(chatId) {
        let s = this.map.get(chatId);
        if (!s) {
            s = {
                authorized: false,
                mode: 'menu',           // 'menu'|'search'|'authors'|'series'|'books'|'book'
                searchText: '',
                field: 'title',
                offset: 0,
                limit: 10,
                pageContext: null,      // {kind: 'authors'|'series'|'books', query} — для page:<n>
                authorsById: new Map(), // id -> {id, name, bookCount}
                seriesById: new Map(),  // id -> {id, name, bookCount}
                authorId: 0,            // выбранный автор (для серий/без серии)
                authorName: '',
                seriesName: '',
                authorSeriesAll: null,   // кеш всех серий автора (для пагинации authorSeries)
            };
            this.map.set(chatId, s);
        }
        return s;
    }

    reset(chatId) {
        this.map.delete(chatId);
    }
}

module.exports = { SessionStore };