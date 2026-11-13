const SESSION_TTL_MS = 15 * 60 * 1000;     // 15 мин
const CLEAN_INTERVAL_MS = 5 * 60 * 1000;   // 5 мин

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
                authorsById: new Map(),  // id -> author (для author:<id>)
                seriesById: new Map(),   // id -> series (для series:<id>)
                authorId: 0,
                authorName: '',
                authorSeriesNoSeriesCount: 0,  // книг без серии у выбранного автора
                lastBooks: [],           // книги текущего списка (для book:<uid>)
            };
            this.map.set(chatId, s);
        }
        s.lastActivity = Date.now();
        return s;
    }

    reset(chatId) {
        this.map.delete(chatId);
    }
}

module.exports = { SessionStore };