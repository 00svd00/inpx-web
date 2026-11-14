const SESSION_TTL_MS = 5 * 60 * 1000;
const CLEAN_INTERVAL_MS = 5 * 60 * 1000;
const AUTH_LOCK_MS = SESSION_TTL_MS + CLEAN_INTERVAL_MS;   // 10 мин (брутфорс)

class SessionStore {
    constructor() {
        this.map = new Map();
        this.cleanTimer = null;
    }

    startCleanup() {
        if (this.cleanTimer) return;
        this.cleanTimer = setInterval(() => this.cleanup(), CLEAN_INTERVAL_MS);
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
        for (const [chatId, s] of this.map) {
            if (now - (s.lastActivity || 0) > SESSION_TTL_MS)
                this.map.delete(chatId);
        }
    }

    get(chatId) {
        let s = this.map.get(chatId);
        if (!s) {
            s = {
                authorized: false,
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

module.exports = { SessionStore, SESSION_TTL_MS, CLEAN_INTERVAL_MS, AUTH_LOCK_MS };