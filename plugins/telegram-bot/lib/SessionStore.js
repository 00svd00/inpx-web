class SessionStore {
    constructor(opts = {}) {
        this.ttlMs = (opts.sessionTtlMinutes || 5) * 60 * 1000;
        this.cleanMs = (opts.cleanIntervalMinutes || 5) * 60 * 1000;
        this.map = new Map();
        this.cleanTimer = null;
    }

    startCleanup() {
        if (this.cleanTimer) return;
        this.cleanTimer = setInterval(() => this.cleanup(), this.cleanMs);
        if (this.cleanTimer.unref) this.cleanTimer.unref();
    }

    stopCleanup() {
        if (this.cleanTimer) {
            clearInterval(this.cleanTimer);
            this.cleanTimer = null;
        }
    }

    cleanup() {
        const now = Date.now();
        for (const [chatId, s] of this.map)
            if (now - (s.lastActivity || 0) > this.ttlMs)
                this.map.delete(chatId);
    }

    get(chatId) {
        let s = this.map.get(chatId);
        if (!s) {
            s = {
                authorized: false,
                authFailures: 0,         // неверных паролей за сессию
                authLocked: false,       // блокировка (снимается при истечении сессии)
                mode: 'menu',            // 'menu'|'search'|'authors'|'series'|'books'|'book'
                searchText: '',
                offset: 0,
                pageContext: null,       // {kind, query, backCallback}
                authorsById: new Map(),
                titlesById: new Map(),   // id -> title (t.books — книги названия)
                seriesById: new Map(),
                authorId: 0,
                authorName: '',
                authorSeriesNoSeriesCount: 0,
                authorSeriesCounts: null,   // Map<series, count> (по автору; null — не считали)
                lastBooks: [],
            };
            this.map.set(chatId, s);
        }
        s.lastActivity = Date.now();
        return s;
    }

    // сброс выбранного автора (новый контекст поиска)
    resetAuthor(s) {
        s.authorId = 0;
        s.authorName = '';
        s.authorSeriesNoSeriesCount = 0;
        s.authorSeriesCounts = null;
    }

    // сброс поискового текста (новый поиск)
    resetSearch(s) {
        s.searchText = '';
        s.mode = 'menu';
    }

    // сброс пагинации (при смене контекста)
    resetPage(s) {
        s.pageContext = null;
        s.offset = 0;
        s.lastBooks = [];
    }

    reset(chatId) {
        this.map.delete(chatId);
    }
}

module.exports = { SessionStore };