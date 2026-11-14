// Рендеры: только api.* + tg.send/edit + format*. СЕССИЮ НЕ ТРОГАЮТ.
// Возвращают данные для handler'а ({found, totalFound} и т.п.).
const {
    escapeHtml, formatAuthorsList, formatSeriesList, formatTitlesList, formatBooksList, formatBookCard,
} = require('./formatters');
const {
    menuKeyboard, searchFieldKeyboard,
    authorsKeyboard, titlesKeyboard, seriesKeyboard, booksKeyboard, bookKeyboard,
} = require('./keyboards');

const fs = require('fs-extra');
const MAX_SEND_BYTES = 50 * 1024 * 1024;

function makeRenders(api, tg) {
    // lazy-кеш: getGenreTree() → Map<code, name>. При ошибке — сбрасываем,
    // чтобы следующий вызов повторил (а не закешировал пустой Map навсегда).
    let genreMapPromise = null;
    async function getGenreMap() {
        if (!genreMapPromise) {
            genreMapPromise = api.getGenreTree().then(gt => {
                const map = new Map();
                for (const section of gt.genreTree)
                    for (const g of section.value)
                        map.set(g.value, g.name);
                return map;
            }).catch(() => {
                genreMapPromise = null;   // сброс — повторим при следующем вызове
                return new Map();
            });
        }
        return genreMapPromise;
    }

    async function renderMenu(chatId, messageId) {
        const text = '🔍 <b>inpx-web</b>\n\nЧто искать?';
        return tg.edit(chatId, messageId, text, { parse_mode: 'HTML', reply_markup: menuKeyboard() });
    }

    async function renderSearchFields(chatId, messageId, searchText) {
        const text = `🔍 Запрос: <b>${escapeHtml(String(searchText || '').slice(0, 100))}</b>\n\nЧто искать?`;
        return tg.edit(chatId, messageId, text, { parse_mode: 'HTML', reply_markup: searchFieldKeyboard() });
    }

    async function renderAuthors(chatId, messageId, term, offset, limit) {
        let res;
        try {
            res = await api.search('author', { author: term, del: '0', limit, offset });
        } catch (e) {
            if (e.message === 'DB_NOT_READY')
                return tg.send(chatId, '⏳ Индекс загружается, попробуйте через несколько секунд.');
            api.log(LM_ERR, `[telegram-bot][${chatId}] search author failed: ${e.message}`);
            return tg.send(chatId, `⚠️ Ошибка поиска: ${escapeHtml(e.message)}`, { parse_mode: 'HTML' });
        }

        const totalPages = Math.ceil(res.totalFound / limit) || 1;
        const page = Math.floor(offset / limit);
        const showPrev = page > 0;
        const showNext = offset + limit < res.totalFound;

        const text = formatAuthorsList(res.found, res.totalFound);
        const keyboard = authorsKeyboard(res.found, page, totalPages, showPrev, showNext);
        await tg.edit(chatId, messageId, text, { parse_mode: 'HTML', reply_markup: keyboard });
        return { found: res.found, totalFound: res.totalFound };
    }

    // term — '' для всех серий (автора); opts.authorName/authorId/noSeriesCount — опционально
    async function renderSeries(chatId, messageId, term, offset, limit, opts = {}) {
        const { authorName, authorId, noSeriesCount } = opts;
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

        const totalPages = Math.ceil(res.totalFound / limit) || 1;
        const page = Math.floor(offset / limit);
        const showPrev = page > 0;
        const showNext = offset + limit < res.totalFound;

        const text = formatSeriesList(res.found, res.totalFound);
        const keyboard = seriesKeyboard(res.found, authorId || 0, page, totalPages, showPrev, showNext, { noSeriesCount });
        await tg.edit(chatId, messageId, text, { parse_mode: 'HTML', reply_markup: keyboard });
        return { found: res.found, totalFound: res.totalFound };
    }

    // поиск по названию: indexed (search('title')) → список названий
    // (в titlesById.set(t.id, t) — t.books = книги названия, загружены search('title'))
    async function renderTitles(chatId, messageId, term, offset, limit, titlesById) {
        let res;
        try {
            res = await api.search('title', { title: term, del: '0', limit, offset });
        } catch (e) {
            if (e.message === 'DB_NOT_READY')
                return tg.send(chatId, '⏳ Индекс загружается, попробуйте через несколько секунд.');
            api.log(LM_ERR, `[telegram-bot][${chatId}] search title failed: ${e.message}`);
            return tg.send(chatId, `⚠️ Ошибка поиска: ${escapeHtml(e.message)}`, { parse_mode: 'HTML' });
        }

        for (const t of res.found)
            if (t.id && t.bookCount) titlesById.set(t.id, t);

        const totalPages = Math.ceil(res.totalFound / limit) || 1;
        const page = Math.floor(offset / limit);
        const showPrev = page > 0;
        const showNext = offset + limit < res.totalFound;

        const text = formatTitlesList(res.found, res.totalFound);
        const keyboard = titlesKeyboard(res.found, page, totalPages, showPrev, showNext);
        await tg.edit(chatId, messageId, text, { parse_mode: 'HTML', reply_markup: keyboard });
        return { found: res.found, totalFound: res.totalFound };
    }

    // книги выбранного названия: books — из titlesById.get(id).books (уже загружены)
    async function renderTitleBooks(chatId, messageId, titleName, books, offset, limit, backCallback = 'back:titles') {
        const all = books || [];
        const totalFound = all.length;
        const found = all.slice(offset, offset + limit);

        const totalPages = Math.ceil(totalFound / limit) || 1;
        const page = Math.floor(offset / limit);
        const showPrev = page > 0;
        const showNext = offset + limit < totalFound;

        const lines = [`📖 <b>${escapeHtml(titleName || '')}</b>`, ''];
        lines.push(found.length ? `Найдено книг: <b>${totalFound}</b>. Выберите:` : 'Ничего не найдено.');
        const keyboard = booksKeyboard(found, page, totalPages, showPrev, showNext, backCallback);
        await tg.edit(chatId, messageId, lines.join('\n'), { parse_mode: 'HTML', reply_markup: keyboard });
        return { found, totalFound };
    }

    // серия из автора: все книги серии + фильтр author (соавторы) в памяти
    async function renderSeriesBooks(chatId, messageId, seriesName, authorName, offset, limit, backCallback = 'menu:main') {
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

        const totalPages = Math.ceil(totalFound / limit) || 1;
        const page = Math.floor(offset / limit);
        const showPrev = page > 0;
        const showNext = offset + limit < totalFound;

        const text = formatBooksList(found, totalFound);
        const keyboard = booksKeyboard(found, page, totalPages, showPrev, showNext, backCallback);
        await tg.edit(chatId, messageId, text, { parse_mode: 'HTML', reply_markup: keyboard });
        return { found, totalFound };
    }

    // «Без серии»: все книги автора без series
    async function renderNoSeries(chatId, messageId, authorId, offset, limit, authorName, backCallback) {
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

        const totalPages = Math.ceil(totalFound / limit) || 1;
        const page = Math.floor(offset / limit);
        const showPrev = page > 0;
        const showNext = offset + limit < totalFound;

        const lines = [`📚 <b>${escapeHtml(authorName || '')}</b> — книги без серии`, ''];
        lines.push(found.length ? `Найдено: <b>${totalFound}</b>. Выберите книгу:` : 'Ничего не найдено.');

        const keyboard = booksKeyboard(found, page, totalPages, showPrev, showNext, backCallback || `author:${authorId}`);
        await tg.edit(chatId, messageId, lines.join('\n'), { parse_mode: 'HTML', reply_markup: keyboard });
        return { found, totalFound };
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
        renderMenu, renderSearchFields, renderAuthors, renderSeries,
        renderTitles, renderTitleBooks,
        renderSeriesBooks, renderNoSeries, renderBook, renderBookFile
    };
}

module.exports = { makeRenders };