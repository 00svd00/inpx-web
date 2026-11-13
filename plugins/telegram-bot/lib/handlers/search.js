const { searchFieldKeyboard, authorsKeyboard, seriesKeyboard, booksKeyboard } = require('../keyboards');
const { escapeHtml, truncate, safeEdit, formatAuthorsList, formatSeriesList, formatBooksList } = require('../formatters');

function register(bot, ctx) {
    const { api, sessions, access, limit } = ctx;

    const renderSearchFields = async (chatId, messageId, searchText) => {
        const s = sessions.get(chatId);
        s.searchText = searchText;
        s.mode = 'search';
        const text = `🔍 Запрос: <b>${escapeHtml(truncate(searchText, 100))}</b>\n\nЧто искать?`;
        const opts = { parse_mode: 'HTML', reply_markup: searchFieldKeyboard() };
        if (messageId)
            return safeEdit(bot, chatId, messageId, text, opts);
        return bot.api.sendMessage({ chat_id: chatId, text, ...opts });
    };

    ctx.renderSearchFields = renderSearchFields;

    const renderAuthors = async (chatId, messageId, term, offset = 0) => {
        const s = sessions.get(chatId);
        let res;
        try {
            res = await api.search('author', { author: term, del: '0', limit, offset });
        } catch (e) {
            if (e.message === 'DB_NOT_READY')
                return bot.api.sendMessage({ chat_id: chatId, text: '⏳ Индекс загружается, попробуйте через несколько секунд.' });
            api.log(LM_ERR, `[telegram-bot][${chatId}] search author failed: ${e.message}`);
            return bot.api.sendMessage({ chat_id: chatId, text: `⚠️ Ошибка поиска: ${escapeHtml(e.message)}`, parse_mode: 'HTML' });
        }

        s.mode = 'authors';
        s.offset = offset;
        s.pageContext = { kind: 'authors', query: { term } };
        s.authorsById = new Map();
        for (const a of res.found)
            if (a.id && a.bookCount) s.authorsById.set(a.id, a);

        const totalPages = Math.ceil(res.totalFound / limit) || 1;
        const page = Math.floor(offset / limit);
        const showPrev = page > 0;
        const showNext = offset + limit < res.totalFound;

        const text = formatAuthorsList(res.found, res.totalFound);
        const keyboard = authorsKeyboard(res.found, page, totalPages, showPrev, showNext);
        const opts = { parse_mode: 'HTML', reply_markup: keyboard };
        if (messageId)
            return safeEdit(bot, chatId, messageId, text, opts);
        return bot.api.sendMessage({ chat_id: chatId, text, ...opts });
    };

    const renderSeries = async (chatId, messageId, term, offset = 0) => {
        const s = sessions.get(chatId);
        let res;
        try {
            res = await api.search('series', { series: term, del: '0', limit, offset });
        } catch (e) {
            if (e.message === 'DB_NOT_READY')
                return bot.api.sendMessage({ chat_id: chatId, text: '⏳ Индекс загружается, попробуйте через несколько секунд.' });
            api.log(LM_ERR, `[telegram-bot][${chatId}] search series failed: ${e.message}`);
            return bot.api.sendMessage({ chat_id: chatId, text: `⚠️ Ошибка поиска: ${escapeHtml(e.message)}`, parse_mode: 'HTML' });
        }

        s.mode = 'series';
        s.offset = offset;
        s.pageContext = { kind: 'series', query: { term } };
        s.seriesById = new Map();
        for (const x of res.found)
            if (x.id && x.bookCount) s.seriesById.set(x.id, x);

        const totalPages = Math.ceil(res.totalFound / limit) || 1;
        const page = Math.floor(offset / limit);
        const showPrev = page > 0;
        const showNext = offset + limit < res.totalFound;

        const text = formatSeriesList(res.found, res.totalFound);
        // authorId = 0 — «Без серии» не показываем (поиск серий по названию)
        const keyboard = seriesKeyboard(res.found, 0, page, totalPages, showPrev, showNext);
        const opts = { parse_mode: 'HTML', reply_markup: keyboard };
        if (messageId)
            return safeEdit(bot, chatId, messageId, text, opts);
        return bot.api.sendMessage({ chat_id: chatId, text, ...opts });
    };

    const renderBooks = async (chatId, messageId, query, offset = 0, backCallback = 'menu:main') => {
        const s = sessions.get(chatId);
        let res;
        try {
            res = await api.bookSearch(Object.assign({}, query, { limit, offset }));
        } catch (e) {
            if (e.message === 'DB_NOT_READY')
                return bot.api.sendMessage({ chat_id: chatId, text: '⏳ Индекс загружается, попробуйте через несколько секунд.' });
            api.log(LM_ERR, `[telegram-bot][${chatId}] bookSearch failed: ${e.message}`);
            return bot.api.sendMessage({ chat_id: chatId, text: `⚠️ Ошибка поиска: ${escapeHtml(e.message)}`, parse_mode: 'HTML' });
        }

        s.mode = 'books';
        s.offset = offset;
        s.pageContext = { kind: 'books', query, backCallback };
        s.lastBooks = res.found || [];

        const totalPages = Math.ceil(res.totalFound / limit) || 1;
        const page = Math.floor(offset / limit);
        const showPrev = page > 0;
        const showNext = offset + limit < res.totalFound;

        const text = formatBooksList(res.found, res.totalFound);
        const keyboard = booksKeyboard(res.found, page, totalPages, showPrev, showNext, backCallback);
        const opts = { parse_mode: 'HTML', reply_markup: keyboard };
        if (messageId)
            return safeEdit(bot, chatId, messageId, text, opts);
        return bot.api.sendMessage({ chat_id: chatId, text, ...opts });
    };

    ctx.renderAuthors = renderAuthors;
    ctx.renderSeries = renderSeries;
    ctx.renderBooks = renderBooks;

    // свободный текст → «Что искать?»
    bot.on('message', api.guard('onMessage', async (ctx2) => {
        const msg = ctx2.message;
        if (!msg || !msg.text) return;
        if (msg.text.startsWith('/')) return;
        if (!await access.ensureAuth(bot, sessions.get(msg.chat.id), msg, api)) return;
        const text = msg.text.trim();
        if (!text) return;
        return renderSearchFields(msg.chat.id, null, text);
    }));

    // search:<field>
    bot.on('callback_query', api.guard('onSearchField', async (ctx2) => {
        const data = ctx2.callbackQuery && ctx2.callbackQuery.data ? ctx2.callbackQuery.data : '';
        if (!data.startsWith('search:')) return;

        const chatId = ctx2.chat.id;
        const s = sessions.get(chatId);
        const username = ctx2.from && ctx2.from.username;
        if (!access.isAuthorized(s, chatId, username)) {
            await ctx2.answerCallbackQuery({ text: '🔒 Требуется авторизация', show_alert: true }).catch(() => {});
            return;
        }
        await ctx2.answerCallbackQuery().catch(() => {});

        const field = data.slice(7);
        if (!s.searchText) {
            return safeEdit(bot, chatId, ctx2.msg ? ctx2.msg.message_id : null, 'Сначала напишите текст запроса.', {
                reply_markup: { inline_keyboard: [[{ text: '◀️ Меню', callback_data: 'menu:main' }]] },
            });
        }

        const messageId = ctx2.msg ? ctx2.msg.message_id : null;
        if (field === 'author') return renderAuthors(chatId, messageId, s.searchText, 0);
        if (field === 'series') return renderSeries(chatId, messageId, s.searchText, 0);
        if (field === 'title')  return renderBooks(chatId, messageId, { title: s.searchText }, 0, 'menu:main');
    }));
}

module.exports = { register };