const _ = require('lodash');
const path = require('path');
const fs = require('fs-extra');
const hooks = require('./hooks');

// Версия контракта PluginApi для плагинов.
// До первого публичного релиза — 1.0; после — растёт при breaking-изменениях.

// Точки расширения (1.6.5+):
//   api.registerOpdsPageMutator(fn, name?) — пост-обработка content в BasePage.makeBody.
//   api.registerOpdsBookLinks(fn, name?)   — ссылки рядом с книгой в OPDS (BookPage.body).
//   api.registerWebBookLinks(fn, name?)    — ссылки рядом с книгой в вебе (WS get-book-links).
// Хуки снимаются автоматически при stopAll()/ошибке start(); api.unregister не нужен.
// Ошибки хука изолированы: логируются, цепочка продолжается.

const API_VERSION = '1.0';

function safeConfig(config) {
    const result = _.cloneDeep(_.pick(config, [
        'name', 'version', 'branch', 'dbVersion', 'bookReadLink', 'rootPathStatic',
        'reviewsEnabled', 'authorsBioEnabled', 'opdsBookAddonsInCard', 'extendedSearch',
        'favorites', 'uiDefaults',
    ]));
    if (!config.remoteLib && config.libDir)
        result.libDir = config.libDir;
    return result;
}

class PluginApi {
    constructor({ config, webWorker, pluginId, logger }) {
        this.version = API_VERSION;
        this.pluginId = pluginId;
        this._config = config;
        this._webWorker = webWorker;
        // DI: в проде — singleton AppLogger; в тестах — fake.
        this._logger = logger || new (require('./AppLogger'))();
    }

    // ---- метаданные ----
    get config()     { return safeConfig(this._config); }
    get dataDir()    { return this._config.dataDir; }
    get pluginsDir() { return this._config.pluginsDir || path.join(this._config.dataDir, 'plugins'); }

    // ---- логирование ядра ----
    // api.log('msg')                  — INFO
    // api.log(LM_WARN, 'msg')         — WARN
    // api.log(LM_ERR, 'msg')          — ERROR
    get log() {
        return (levelOrMsg, msg) => {
            try {
                if (msg === undefined)
                    this._logger.log(String(levelOrMsg));
                else
                    this._logger.log(levelOrMsg, String(msg));
            } catch (e) {
                // fallback, чтобы плагин не падал из-за логгера
                console.log(`[${this.pluginId}] ${msg === undefined ? levelOrMsg : msg}`);
            }
        };
    }

    // ---- готовность БД ----
    async waitReady({ timeoutMs = 30000, intervalMs = 1000 } = {}) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            if (this._webWorker.myState === 'normal')
                return true;
            await new Promise(r => setTimeout(r, intervalMs));
        }
        throw new Error('DB_NOT_READY');
    }

    async _call(fn, ...args) {
        try {
            return await fn.apply(this._webWorker, args);
        } catch (e) {
            if (e && e.message === 'server_busy') {
                await this.waitReady();
                return await fn.apply(this._webWorker, args);
            }
            throw e;
        }
    }

    // Обёртка для async-обработчиков плагина: ловит любые ошибки, логирует LM_ERR,
    // не пробрасывает. Плагин ОБЯЗАН оборачивать все свои async-обработчики
    // (bot.on(...), setInterval, и т.п.) в api.guard — иначе unhandled rejection
    // может уронить процесс (см. PluginManager: unhandledRejection-фильтр).
    guard(name, fn) {
        return async (...args) => {
            try {
                return await fn(...args);
            } catch (e) {
                this.log(LM_ERR, `[${this.pluginId}] ${name} failed: ${e && e.message ? e.message : e}`);
                return undefined;
            }
        };
    }

    // Готовый файл книги для скачивания/отправки:
    //   fb2  -> <hash>.zip (downFileName + '.zip', mime application/zip)
    //   epub -> <hash>     (downFileName, mime application/epub+zip)
    // Материализация (включая remote lib) — в getBookLink; resolveBookFile — только файл.
    // format: 'zip' (default) | 'raw'.  'raw' для fb2 — распакованный .fb2 (без zip).
    async getBookFile(uid, { format = 'zip' } = {}) {
        const link = await this._call(this._webWorker.getBookLink, uid);
        const hash = path.basename(link.link);
        return this._call(this._webWorker.resolveBookFile, hash, format);
    }

    // ---- точки расширения ----

    // OPDS page-мутатор: fn(content, {req, page}) → content | undefined.
    // Можно мутировать content in place (вернуть undefined) или вернуть новый.
    // Built-in мутаторы идут первыми; порядок плагинов — по регистрации.
    registerOpdsPageMutator(fn, name) {
        hooks.registerOpdsPageMutator(this.pluginId, name, fn);
    }

    // Ссылки рядом с книгой в OPDS: fn({uid, bookInfo, entry}) → [{href, rel?, type?, title?}].
    // bookInfo — {book, cover, link, bookInfo}; entry — уже собранная entry книги.
    registerOpdsBookLinks(fn, name) {
        hooks.registerOpdsBookLinks(this.pluginId, name, fn);
    }

    // Ссылки рядом с книгой в вебе: fn({uid, bookInfo}) → [{key, title, hint?, href?}].
    // key — уникальный идентификатор (для v-for), title — подпись, href — ссылка (опц.).
    registerWebBookLinks(fn, name) {
        hooks.registerWebBookLinks(this.pluginId, name, fn);
    }

    // ---- поиск ----
    async search(from, query)     { return this._call(this._webWorker.search, from, query); }
    async bookSearch(query)       { return this._call(this._webWorker.bookSearch, query); } //Дорого, не оптимизированно, на свой страх и риск. Лучше использовать search('author'|'series'|'title')
    // ---- книги ----
    async getBookLink(uid)        { return this._call(this._webWorker.getBookLink, uid); }
    async getBookInfo(uid)        { return this._call(this._webWorker.getBookInfo, uid); }

    // OPDS-модель «автор → серии + без серии»:
    //   getAuthorBookList(authorId)  -> {author, books}  — ВСЕ книги автора (включая без серии)
    //   getAuthorSeriesList(authorId)-> {author, series} — серии автора (с bookCount)
    // Фильтр «без серии» (!book.series) и пагинация — на стороне плагина.
    async getAuthorBookList(authorId)   { return this._call(this._webWorker.getAuthorBookList, authorId); }
    async getAuthorSeriesList(authorId) { return this._call(this._webWorker.getAuthorSeriesList, authorId); }
    async getSeriesBookList(series)     { return this._call(this._webWorker.getSeriesBookList, series); }

    // ---- жанры ----
    async getGenreTree()          { return this._call(this._webWorker.getGenreTree); }
    async getGenreMap()           { return this._call(this._webWorker.getGenreMap); }

    // ---- статистика ----
    async getStats() {
        const dbConfig = await this._call(this._webWorker.dbConfig);
        return {
            reviewsEnabled: !!(dbConfig.stats && dbConfig.stats.reviewsEnabled),
            authorsBioEnabled: !!(dbConfig.stats && dbConfig.stats.authorsBioEnabled),
            inpxHash: dbConfig.inpxHash || '',
        };
    }

    // ---- рецензии ----
    async getBookReviewsCount(uid) { return this._call(this._webWorker.getBookReviewsCount, uid); }
    async getBookReviews(uid)      { return this._call(this._webWorker.getBookReviews, uid); }
    async getReviewLink(uid)       { return this._call(this._webWorker.getReviewLink, uid); }

    // ---- авторы: био/фото ----
    async getBookAuthors(uid)      { return this._call(this._webWorker.getBookAuthors, uid); }
    async materializeBio(hash)     { return this._call(this._webWorker.materializeBio, hash); }
    async getAuthorBio(hash)       { return this._call(this._webWorker.getAuthorBio, hash); }
    async getAuthorPhoto(hash)     { return this._call(this._webWorker.getAuthorPhoto, hash); }
    async getBioLink(hash)         { return this._call(this._webWorker.getBioLink, hash); }
    async getPhotoLink(hash)       { return this._call(this._webWorker.getPhotoLink, hash); }
    getAuthorPhotoMime(ext)        { return this._webWorker.getAuthorPhotoMime(ext); }

    // ---- избранное ----
    // Общее на сервер для всех. Не подходит для многопользовательских плагинов
    async getFavorites(offset = 0, limit = 50) { return this._call(this._webWorker.getFavorites, offset, limit); }
    async getFavoriteUids()                     { return this._call(this._webWorker.getFavoriteUids); }
    async addFavorite(uid)                      { return this._call(this._webWorker.addFavorite, uid); }
    async removeFavorite(uid)                   { return this._call(this._webWorker.removeFavorite, uid); }
}

module.exports = { PluginApi, API_VERSION, safeConfig };