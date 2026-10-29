const fs = require('fs-extra');
const path = require('path');
const dayjs = require('dayjs');

const BasePage = require('./BasePage');
const utils = require('../utils');

const PAGE_LIMIT = 100;
const ALLOWED_QUERY = new Set(['author', 'series', 'title', 'genre', 'lang', 'date', 'librate', 'ratingCount', 'ext']);
const ALLOWED_TYPE = new Set(['author', 'series', 'title']);
const ID_RE = /^[a-zA-Z0-9_-]+$/;

function normalizeCustomFeeds(raw) {
    const result = {};
    if (!raw || typeof raw !== 'object')
        return result;

    for (const [id, feed] of Object.entries(raw)) {
        const out = {id, name: '', active: false, type: '', query: {}};
        if (!ID_RE.test(id)) {
            result[id] = out;
            continue;
        }
        if (feed && typeof feed === 'object') {
            out.name = (typeof feed.name === 'string' ? feed.name : id);
            out.active = (feed.active !== false);
            out.type = (ALLOWED_TYPE.has(feed.type) ? feed.type : '');
            if (!out.type)
                out.active = false;
            if (feed.query && typeof feed.query === 'object') {
                for (const [k, v] of Object.entries(feed.query)) {
                    if (ALLOWED_QUERY.has(k) && v !== undefined && v !== null && v !== '')
                        out.query[k] = String(v);
                }
            }
        }
        result[id] = out;
    }
    return result;
}

async function loadCustomFeeds(config) {
    if (!config.customOpdsFeeds)
        return {};
    const file = config.customOpdsFeedsFile || path.join(config.dataDir, 'custom-opds-feeds.json');
    let raw = {};
    try {
        if (await fs.pathExists(file)) {
            const txt = await fs.readFile(file, 'utf8');
            raw = JSON.parse(txt);
        }
    } catch (e) {
        raw = {};
    }
    return normalizeCustomFeeds(raw);
}

class CustomOpdsFeedPage extends BasePage {
    constructor(config) {
        super(config);
        this.id = 'custom';
        this.title = 'Кастомный фид';
    }

    // сортировка bookIds по id таблиц (author/series/title) — числа, быстро
    sortBookIds(bookIds, type) {
        const maps = (this.webWorker.dbSearcher && this.webWorker.dbSearcher.bookIdMap) || {};
        const m = maps[type === 'author' ? 'series' : 'title'];
        const arr = Array.from(bookIds);
        if (m && m.arr) {
            arr.sort((a, b) => (m.arr[a] || 0) - (m.arr[b] || 0));
        }
        return new Uint32Array(arr);
    }

    // 'today'|'3days'|'week'|'2weeks'|'month'|'2months'|'3months' → 'YYYY-MM-DD'
    // (клиентский BaseList.queryDate — отдельно, не путать)
    parseFeedDate(date) {
        if (!date)
            return date;
        if (/^\d{4}-\d{2}-\d{2}/.test(date))
            return date;
        const fmt = 'YYYY-MM-DD';
        switch (date) {
            case 'today': return dayjs().format(fmt);
            case '3days': return dayjs().subtract(3, 'days').format(fmt);
            case 'week': return dayjs().subtract(1, 'weeks').format(fmt);
            case '2weeks': return dayjs().subtract(2, 'weeks').format(fmt);
            case 'month': return dayjs().subtract(1, 'months').format(fmt);
            case '2months': return dayjs().subtract(2, 'months').format(fmt);
            case '3months': return dayjs().subtract(3, 'months').format(fmt);
            default: return date;
        }
    }

    async body(req) {
        const result = {};
        result.link = this.baseLinks(req, true);

        const feeds = await loadCustomFeeds(this.config);
        const feedId = req.path.split('/').pop();
        const feed = feeds[feedId];

        if (!feed || !feed.active) {
            result.entry = [this.makeEntry({
                id: 'not_found',
                title: '[Фид не найден]',
                link: this.navLink({href: '/root'}),
            })];
            return this.makeBody(result, req);
        }

        const page = parseInt(req.query.page, 10) || 1;
        const offset = (page - 1) * PAGE_LIMIT;
        const limit = PAGE_LIMIT;

        const feedQuery = Object.assign({}, feed.query);
        if (feedQuery.date)
            feedQuery.date = this.parseFeedDate(feedQuery.date);
        const navAuthor = req.query.author || '';
        const navSeries = req.query.series || '';
        const entry = [];

        if ((feed.type === 'author' || feed.type === 'series') && !navAuthor && !navSeries) {
            // 1-й уровень: навигация по авторам/сериям с фильтрами
            const from = feed.type;
            const query = Object.assign({}, feedQuery, {del: '0'});

            // реальное число книг по фильтрам на автора/серию
            const bookIds = await this.webWorker.selectBookIds(query) || new Uint32Array(0);
            const maps = (this.webWorker.dbSearcher && this.webWorker.dbSearcher.bookIdMap) || {};
            const idMap = maps[from]; // author/series
            const countMap = new Map();
            if (idMap) {
                for (const bookId of bookIds) {
                    let tableId = idMap.arr[bookId];
                    if (tableId) {
                        countMap.set(tableId, (countMap.get(tableId) || 0) + 1);
                    } else {
                        const arr = idMap.map.get(bookId);
                        if (arr) {
                            for (const tid of arr)
                                countMap.set(tid, (countMap.get(tid) || 0) + 1);
                        }
                    }
                }
            }

            // страница авторов/серий (search с offset/limit)
            const searchQuery = Object.assign({}, query, {offset, limit});
            const res = await this.webWorker.search(from, searchQuery);

            for (const row of res.found) {
                if (!row.bookCount)
                    continue;
                const val = row[from];
                const realCount = countMap.get(row.id) || 0;
                entry.push(this.makeEntry({
                    id: row.id,
                    title: (from === 'series' ? 'Серия: ' : '') + (from === 'author' ? this.bookAuthor(val) : val),
                    link: this.navLink({href: `/custom/${feedId}?${from}==${encodeURIComponent(val)}&page=1`}),
                    content: {'*ATTRS': {type: 'text'}, '*TEXT': `${realCount} книг${utils.wordEnding(realCount, 8)}`},
                }));
            }
            if (res.totalFound > offset + res.found.length) {
                entry.push(this.makeEntry({
                    id: 'next_page',
                    title: '[Следующая страница]',
                    link: this.navLink({href: `/custom/${feedId}?page=${page + 1}`}),
                }));
            }
        } else {
            // 2-й уровень (или type=title): список книг с фильтрами
            const query = Object.assign({}, feedQuery, {del: '0'});
            if (feed.type === 'author' && navAuthor)
                query.author = navAuthor; // уже с '=' из URL (author==...)
            if (feed.type === 'series' && navSeries)
                query.series = navSeries;

            let bookIds = await this.webWorker.selectBookIds(query);
            if (!bookIds)
                bookIds = new Uint32Array(0);

            bookIds = this.sortBookIds(bookIds, feed.type);

            const totalFound = bookIds.length;
            const slice = bookIds.slice(offset, offset + limit);
            const books = await this.webWorker.getBooksByIds(slice);

            for (const book of books) {
                const series = (book.series ? ` (Серия: ${book.series}${book.serno ? ` #${book.serno}` : ''})` : '');
                entry.push(this.makeEntry({
                    id: book._uid,
                    title: `${book.title || 'Без названия'}${book.ext ? ` (${book.ext})` : ''}`,
                    link: this.acqLink({href: `/book?uid=${encodeURIComponent(book._uid)}`}),
                    content: {'*ATTRS': {type: 'text'}, '*TEXT': `${this.bookAuthor(book.author)}${series}`},
                }));
            }

            let baseHref = `/custom/${feedId}`;
            const params = [];
            if (navAuthor) params.push(`author==${encodeURIComponent(navAuthor)}`);
            if (navSeries) params.push(`series==${encodeURIComponent(navSeries)}`);
            baseHref += (params.length ? `?${params.join('&')}&` : '?');

            if (totalFound > offset + books.length) {
                entry.push(this.makeEntry({
                    id: 'next_page',
                    title: '[Следующая страница]',
                    link: this.navLink({href: `${baseHref}page=${page + 1}`}),
                }));
            }
            if (page > 1) {
                entry.push(this.makeEntry({
                    id: 'prev_page',
                    title: '[Предыдущая страница]',
                    link: this.navLink({href: `${baseHref}page=${page - 1}`}),
                }));
            }
        }

        if (!entry.length) {
            entry.push(this.makeEntry({
                id: 'empty',
                title: '[Ничего не найдено]',
                link: this.navLink({href: '/root'}),
            }));
        }

        result.entry = entry;
        return this.makeBody(result, req);
    }
}

CustomOpdsFeedPage.normalizeCustomFeeds = normalizeCustomFeeds;
CustomOpdsFeedPage.loadCustomFeeds = loadCustomFeeds;

module.exports = CustomOpdsFeedPage;