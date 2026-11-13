// Рендеры: только api.* + tg.send/edit. Сессию НЕ трогают — это делает handler.
const {
    escapeHtml, formatAuthorsList, formatSeriesList, formatBooksList, formatBookCard,
} = require('./formatters');
const {
    menuKeyboard, searchFieldKeyboard,
    authorsKeyboard, seriesKeyboard, booksKeyboard, bookKeyboard,
} = require('./keyboards');

const fs = require('fs-extra');
const MAX_SEND_BYTES = 50 * 1024 * 1024;

function makeRenders(api, tg) {
    
    // lazy-кеш: getGenreTree() → Map<code, name> (для отображения жанров в карточке)
    let genreMapPromise = null;
    async function getGenreMap() {
        if (!genreMapPromise) {
            genreMapPromise = api.getGenreTree().then(gt => {
                const map = new Map();
                for (const section of gt.genreTree)
                    for (const g of section.value)
                        map.set(g.value, g.name);
                return map;
            }).catch(() => new Map());
        }
        return genreMapPromise;
    }

    async function renderMenu(chatId, messageId) {
        const text = '🔍 <b>inpx-web</b>\n\nЧто искать?';
        const opts = { parse_mode: 'HTML', reply_markup: menuKeyboard() };
        return tg.edit(chatId, messageId, text, opts);
    }

    async function renderSearchFields(chatId, messageId, searchText) {
        const text = `🔍 Запрос: <b>${escapeHtml(searchText.slice(0, 100))}</b>\n\nЧто искать?`;
        const opts = { parse_mode: 'HTML', reply_markup: searchFieldKeyboard() };
        return tg.edit(chatId, messageId, text, opts);
    }

    async function renderAuthors(chatId, messageId, term, offset, limit, authorsById) {
        let res;
        try {
            res = await api.search('author', { author: term, del: '0', limit, offset });
        } catch (e) {
            if (e.message === 'DB_NOT_READY')
                return tg.send(chatId, '⏳ Индекс загружается, попробуйте через несколько секунд.');
            api.log(LM_ERR, `[telegram-bot][${chatId}] search author failed: ${e.message}`);
            return tg.send(chatId, `⚠️ Ошибка поиска: ${escapeHtml(e.message)}`, { parse_mode: 'HTML' });
        }

        for (const a of res.found)
            if (a.id && a.bookCount) authorsById.set(a.id, a);

        const totalPages = Math.ceil(res.totalFound / limit) || 1;
        const page = Math.floor(offset / limit);
        const showPrev = page > 0;
        const showNext = offset + limit < res.totalFound;

        const text = formatAuthorsList(res.found, res.totalFound);
        const keyboard = authorsKeyboard(res.found, page, totalPages, showPrev, showNext);
        return tg.edit(chatId, messageId, text, { parse_mode: 'HTML', reply_markup: keyboard });
    }

    // term — '' для всех серий (автора); authorName — опциональный фильтр; noSeriesCount — для «Без серии»
    async function renderSeries(chatId, messageId, term, offset, limit, seriesById, authorName, authorId, noSeriesCount) {
        let res;
        try {
            const query = { del: '0', limit, offset };
            if (term) query.series = term;
            if (authorName) query.author = authorName;
            res = await api.search('series', query);
        } catch (e) {
            if (e.message === 'DB_NOT_READY')
                return tg.send(chatId, '⏳ Индекс загружается, попробуйте через несколько секунд.');
            api.log(LM_ERR, `[telegram-bot][${chatId}] search series failed: ${e.message}`);
            return tg.send(chatId, `⚠️ Ошибка поиска: ${escapeHtml(e.message)}`, { parse_mode: 'HTML' });
        }

        for (const x of res.found)
            if (x.id && x.bookCount) seriesById.set(x.id, x);

        const totalPages = Math.ceil(res.totalFound / limit) || 1;
        const page = Math.floor(offset / limit);
        const showPrev = page > 0;
        const showNext = offset + limit < res.totalFound;

        const text = formatSeriesList(res.found, res.totalFound);
        const keyboard = seriesKeyboard(res.found, authorId || 0, page, totalPages, showPrev, showNext, { noSeriesCount });
        return tg.edit(chatId, messageId, text, { parse_mode: 'HTML', reply_markup: keyboard });
    }

    async function renderBooks(chatId, messageId, query, offset, limit, lastBooks, backCallback = 'menu:main') {
        let res;
        try {
            res = await api.bookSearch(Object.assign({}, query, { limit, offset }));
        } catch (e) {
            if (e.message === 'DB_NOT_READY')
                return tg.send(chatId, '⏳ Индекс загружается, попробуйте через несколько секунд.');
            api.log(LM_ERR, `[telegram-bot][${chatId}] bookSearch failed: ${e.message}`);
            return tg.send(chatId, `⚠️ Ошибка поиска: ${escapeHtml(e.message)}`, { parse_mode: 'HTML' });
        }

        lastBooks.length = 0;
        for (const b of (res.found || [])) lastBooks.push(b);

        const totalPages = Math.ceil(res.totalFound / limit) || 1;
        const page = Math.floor(offset / limit);
        const showPrev = page > 0;
        const showNext = offset + limit < res.totalFound;

        const text = formatBooksList(res.found, res.totalFound);
        const keyboard = booksKeyboard(res.found, page, totalPages, showPrev, showNext, backCallback);
        return tg.edit(chatId, messageId, text, { parse_mode: 'HTML', reply_markup: keyboard });
        }

        async function renderSeriesBooks(chatId, messageId, seriesName, authorName, offset, limit, lastBooks, backCallback = 'menu:main') {
        let list;
        try {
            list = await api.getSeriesBookList(seriesName);
        } catch (e) {
            api.log(LM_ERR, `[telegram-bot][${chatId}] getSeriesBookList failed: ${e.message}`);
            return tg.send(chatId, `⚠️ Ошибка: ${escapeHtml(e.message)}`, { parse_mode: 'HTML' });
        }

        let all = list.books || [];
        if (authorName) {
            const target = authorName.toLowerCase().trim();
            all = all.filter(b => {
                const authors = (b.author || '').toLowerCase().split(',').map(a => a.trim());
                return authors.some(a => a === target);
            });
        }

        const totalFound = all.length;
        const found = all.slice(offset, offset + limit);

        lastBooks.length = 0;
        for (const b of found) lastBooks.push(b);

        const totalPages = Math.ceil(totalFound / limit) || 1;
        const page = Math.floor(offset / limit);
        const showPrev = page > 0;
        const showNext = offset + limit < totalFound;

        const text = formatBooksList(found, totalFound);
        const keyboard = booksKeyboard(found, page, totalPages, showPrev, showNext, backCallback);
        return tg.edit(chatId, messageId, text, { parse_mode: 'HTML', reply_markup: keyboard });
    }

    async function renderNoSeries(chatId, messageId, authorId, offset, limit, s) {
        let list;
        try {
            list = await api.getAuthorBookList(authorId);
        } catch (e) {
            api.log(LM_ERR, `[telegram-bot][${chatId}] getAuthorBookList failed: ${e.message}`);
            return tg.send(chatId, `⚠️ Ошибка: ${escapeHtml(e.message)}`, { parse_mode: 'HTML' });
        }

        const all = (list.books || []).filter(b => !b.series);
        const totalFound = all.length;
        const found = all.slice(offset, offset + limit);

        s.lastBooks = found;
        s.offset = offset;
        s.pageContext = { kind: 'noseries', query: { authorId, authorName: s.authorName }, backCallback: `author:${authorId}` };

        const totalPages = Math.ceil(totalFound / limit) || 1;
        const page = Math.floor(offset / limit);
        const showPrev = page > 0;
        const showNext = offset + limit < totalFound;

        const lines = [`📚 <b>${escapeHtml(s.authorName || '')}</b> — книги без серии`, ''];
        lines.push(found.length ? `Найдено: <b>${totalFound}</b>. Выберите книгу:` : 'Ничего не найдено.');

        const keyboard = booksKeyboard(found, page, totalPages, showPrev, showNext, `author:${authorId}`);
        return tg.edit(chatId, messageId, lines.join('\n'), { parse_mode: 'HTML', reply_markup: keyboard });
    }

    async function renderBook(chatId, messageId, book) {
        let info = null;
        try {
            info = await api.getBookInfo(book._uid);
        } catch (e) {
            if (e.message && e.message.startsWith('404'))
                return tg.edit(chatId, messageId, '⚠️ Книга не найдена (возможно, удалена из библиотеки).', {
                    reply_markup: { inline_keyboard: [[{ text: '◀️ Назад', callback_data: 'back:search' }]] },
                });
            api.log(LM_WARN, `[telegram-bot][${chatId}] getBookInfo failed: ${e.message}`);
        }

        const genreMap = await getGenreMap();
        const text = formatBookCard(book, info, genreMap);
        
        return tg.edit(chatId, messageId, text, { parse_mode: 'HTML', reply_markup: bookKeyboard(book._uid) });
    }

    async function renderBookFile(chatId, uid) {
        let file;
        try {
            file = await api.getBookFile(uid, { format: 'zip' });
        } catch (e) {
            if (e.message && e.message.startsWith('404'))
                return tg.send(chatId, '⚠️ Файл не найден (возможно, удалён из библиотеки).');
            api.log(LM_ERR, `[telegram-bot][${chatId}] getBookFile failed: ${e.message}`);
            return tg.send(chatId, `⚠️ Не удалось получить файл: ${escapeHtml(e.message)}`, { parse_mode: 'HTML' });
        }

        let stat;
        try {
            stat = await fs.stat(file.path);
        } catch (e) {
            return tg.send(chatId, '⚠️ Файл не найден на сервере.');
        }
        if (stat.size > MAX_SEND_BYTES) {
            return tg.send(chatId,
                `⚠️ Файл слишком большой для Telegram (${(stat.size / 1024 / 1024).toFixed(1)} МБ > 50 МБ).`);
        }

        try {
            await tg.sendDocument(chatId, file.path, { filename: file.filename });
        } catch (e) {
            api.log(LM_ERR, `[telegram-bot][${chatId}] sendDocument failed: ${e.message}`);
            return tg.send(chatId, `⚠️ Не удалось отправить файл: ${escapeHtml(e.message)}`, { parse_mode: 'HTML' });
        }
    }

    return {
        renderMenu, renderSearchFields, renderAuthors, renderSeries, renderBooks,
        renderNoSeries, renderBook, renderBookFile, renderSeriesBooks,
    };
}

module.exports = { makeRenders };