const { escapeHtml, safeEdit } = require('../formatters');
const { seriesKeyboard, booksKeyboard, menuKeyboard } = require('../keyboards');

function register(bot, ctx) {
    const { api, sessions, access, limit } = ctx;
    const { renderMenu, renderAuthors, renderSeries, renderBooks } = ctx;

    // menu:*
    bot.on('callback_query', api.guard('onMenu', async (ctx2) => {
        const data = ctx2.callbackQuery && ctx2.callbackQuery.data ? ctx2.callbackQuery.data : '';
        if (!data.startsWith('menu:')) return;
        const chatId = ctx2.chat.id;
        const messageId = ctx2.msg ? ctx2.msg.message_id : null;
        const s = sessions.get(chatId);
        if (!access.isAuthorized(s, chatId, ctx2.from && ctx2.from.username)) {
            await ctx2.answerCallbackQuery({ text: '🔒 Требуется авторизация', show_alert: true }).catch(() => {});
            return;
        }
        await ctx2.answerCallbackQuery().catch(() => {});

        const what = data.slice(5);
        if (what === 'main') return renderMenu(chatId, messageId);
        if (what === 'search') {
            return safeEdit(bot, chatId, messageId, 'Напишите текст запроса — бот предложит, что искать.', {
                reply_markup: { inline_keyboard: [[{ text: '◀️ Меню', callback_data: 'menu:main' }]] },
            });
        }
        if (what === 'help') {
            return safeEdit(bot, chatId, messageId, 'Напишите текст — бот предложит, что искать.\n\n/start — меню\n/help — справка', {
                reply_markup: { inline_keyboard: [[{ text: '◀️ Меню', callback_data: 'menu:main' }]] },
            });
        }
        if (what === 'author' || what === 'series') {
            const hint = what === 'author' ? 'имя автора' : 'название серии';
            return safeEdit(bot, chatId, messageId, `Напишите ${hint} текстом — бот найдёт.`, {
                reply_markup: { inline_keyboard: [[{ text: '◀️ Меню', callback_data: 'menu:main' }]] },
            });
        }
    }));

    // author:<id>
    bot.on('callback_query', api.guard('onAuthor', async (ctx2) => {
        const data = ctx2.callbackQuery && ctx2.callbackQuery.data ? ctx2.callbackQuery.data : '';
        if (!data.startsWith('author:')) return;
        const chatId = ctx2.chat.id;
        const messageId = ctx2.msg ? ctx2.msg.message_id : null;
        const s = sessions.get(chatId);
        if (!access.isAuthorized(s, chatId, ctx2.from && ctx2.from.username)) {
            await ctx2.answerCallbackQuery({ text: '🔒 Требуется авторизация', show_alert: true }).catch(() => {});
            return;
        }
        await ctx2.answerCallbackQuery().catch(() => {});

        const id = parseInt(data.slice(7), 10);
        if (!id) return;
        const author = s.authorsById.get(id);
        if (!author) {
            return safeEdit(bot, chatId, messageId, 'Автор устарел. Начните поиск заново.', {
                reply_markup: { inline_keyboard: [[{ text: '◀️ Меню', callback_data: 'menu:main' }]] },
            });
        }

        let res;
        try {
            res = await api.getAuthorSeriesList(id);
        } catch (e) {
            api.log(LM_ERR, `[telegram-bot][${chatId}] getAuthorSeriesList failed: ${e.message}`);
            return bot.api.sendMessage({ chat_id: chatId, text: `⚠️ Ошибка: ${escapeHtml(e.message)}`, parse_mode: 'HTML' });
        }

        s.mode = 'series';
        s.authorId = id;
        s.authorName = res.author || author.author || '';
        s.seriesById = new Map();
        for (const x of res.series)
            if (x.id && x.bookCount) s.seriesById.set(x.id, x);

        const all = res.series || [];
        s.authorSeriesAll = all;
        s.offset = 0;
        s.pageContext = { kind: 'authorSeries', query: { authorId: id } };

        const totalFound = all.length;
        const found = all.slice(0, limit);
        const totalPages = Math.ceil(totalFound / limit) || 1;
        const showNext = limit < totalFound;

        const lines = [`👤 <b>${escapeHtml(s.authorName)}</b>`, ''];
        lines.push(totalFound ? `Серий: <b>${totalFound}</b>. Выберите:` : 'Серий нет — откройте «Без серии».');

        const keyboard = seriesKeyboard(found, id, 0, totalPages, false, showNext);
        const opts = { parse_mode: 'HTML', reply_markup: keyboard };
        return safeEdit(bot, chatId, messageId, lines.join('\n'), opts);
    }));

    // series:<id>
    bot.on('callback_query', api.guard('onSeries', async (ctx2) => {
        const data = ctx2.callbackQuery && ctx2.callbackQuery.data ? ctx2.callbackQuery.data : '';
        if (!data.startsWith('series:')) return;
        const chatId = ctx2.chat.id;
        const messageId = ctx2.msg ? ctx2.msg.message_id : null;
        const s = sessions.get(chatId);
        if (!access.isAuthorized(s, chatId, ctx2.from && ctx2.from.username)) {
            await ctx2.answerCallbackQuery({ text: '🔒 Требуется авторизация', show_alert: true }).catch(() => {});
            return;
        }
        await ctx2.answerCallbackQuery().catch(() => {});

        const id = parseInt(data.slice(7), 10);
        if (!id) return;
        const series = s.seriesById.get(id);
        if (!series) {
            return safeEdit(bot, chatId, messageId, 'Серия устарела. Начните поиск заново.', {
                reply_markup: { inline_keyboard: [[{ text: '◀️ Меню', callback_data: 'menu:main' }]] },
            });
        }
        s.seriesName = series.series || series.name || '';
        return renderBooks(chatId, messageId, { series: s.seriesName }, 0, `author:${s.authorId || 0}`);
    }));

    // noseries:<authorId>
    bot.on('callback_query', api.guard('onNoSeries', async (ctx2) => {
        const data = ctx2.callbackQuery && ctx2.callbackQuery.data ? ctx2.callbackQuery.data : '';
        if (!data.startsWith('noseries:')) return;
        const chatId = ctx2.chat.id;
        const messageId = ctx2.msg ? ctx2.msg.message_id : null;
        const s = sessions.get(chatId);
        if (!access.isAuthorized(s, chatId, ctx2.from && ctx2.from.username)) {
            await ctx2.answerCallbackQuery({ text: '🔒 Требуется авторизация', show_alert: true }).catch(() => {});
            return;
        }
        await ctx2.answerCallbackQuery().catch(() => {});

        const authorId = parseInt(data.slice(9), 10);
        if (!authorId) return;
        const author = s.authorsById.get(authorId);
        if (!author) {
            return safeEdit(bot, chatId, messageId, 'Автор устарел. Начните поиск заново.', {
                reply_markup: { inline_keyboard: [[{ text: '◀️ Меню', callback_data: 'menu:main' }]] },
            });
        }
        const authorName = author.author || author.name || s.authorName || '';

        let list;
        try {
            list = await api.getAuthorBookList(authorId);
        } catch (e) {
            api.log(LM_ERR, `[telegram-bot][${chatId}] getAuthorBookList failed: ${e.message}`);
            return bot.api.sendMessage({ chat_id: chatId, text: `⚠️ Ошибка: ${escapeHtml(e.message)}`, parse_mode: 'HTML' });
        }

        const all = (list.books || []).filter(b => !b.series);
        const totalFound = all.length;
        const offset = 0;
        const found = all.slice(offset, offset + limit);

        s.mode = 'books';
        s.offset = offset;
        s.lastBooks = found;
        s.pageContext = {
            kind: 'noseries',
            query: { authorId, authorName },
            backCallback: `author:${authorId}`,
        };

        const totalPages = Math.ceil(totalFound / limit) || 1;
        const showNext = offset + limit < totalFound;

        const lines = [`📚 <b>${escapeHtml(authorName)}</b> — книги без серии`, ''];
        lines.push(found.length ? `Найдено: <b>${totalFound}</b>. Выберите книгу:` : 'Ничего не найдено.');

        const keyboard = booksKeyboard(found, 0, totalPages, false, showNext, `author:${authorId}`);
        const opts = { parse_mode: 'HTML', reply_markup: keyboard };
        return safeEdit(bot, chatId, messageId, lines.join('\n'), opts);
    }));

    // back:search
    bot.on('callback_query', api.guard('onBack', async (ctx2) => {
        const data = ctx2.callbackQuery && ctx2.callbackQuery.data ? ctx2.callbackQuery.data : '';
        if (data !== 'back:search') return;
        const chatId = ctx2.chat.id;
        const messageId = ctx2.msg ? ctx2.msg.message_id : null;
        const s = sessions.get(chatId);
        if (!access.isAuthorized(s, chatId, ctx2.from && ctx2.from.username)) {
            await ctx2.answerCallbackQuery({ text: '🔒 Требуется авторизация', show_alert: true }).catch(() => {});
            return;
        }
        await ctx2.answerCallbackQuery().catch(() => {});

        const pc = s.pageContext;
        if (!pc) return renderMenu(chatId, messageId);

        if (pc.kind === 'authors') return renderAuthors(chatId, messageId, pc.query.term, 0);
        if (pc.kind === 'series')  return renderSeries(chatId, messageId, pc.query.term, 0);
        if (pc.kind === 'books')   return renderBooks(chatId, messageId, pc.query, 0, pc.backCallback || 'menu:main');
        if (pc.kind === 'authorSeries') {
            const all = s.authorSeriesAll || [];
            const found = all.slice(0, limit);
            const totalPages = Math.ceil(all.length / limit) || 1;
            const authorId = pc.query.authorId;
            const lines = [`👤 <b>${escapeHtml(s.authorName)}</b>`, ''];
            lines.push(all.length ? `Серий: <b>${all.length}</b>. Выберите:` : 'Серий нет.');
            const keyboard = seriesKeyboard(found, authorId, 0, totalPages, false, limit < all.length);
            return safeEdit(bot, chatId, messageId, lines.join('\n'), { parse_mode: 'HTML', reply_markup: keyboard });
        }
        if (pc.kind === 'noseries') {
            return safeEdit(bot, chatId, messageId, 'Вернитесь к автору заново.', {
                reply_markup: { inline_keyboard: [[{ text: '👤 Автор', callback_data: `author:${pc.query.authorId}` }], [{ text: '◀️ Меню', callback_data: 'menu:main' }]] },
            });
        }
        return renderMenu(chatId, messageId);
    }));

    // page:<n>
    bot.on('callback_query', api.guard('onPage', async (ctx2) => {
        const data = ctx2.callbackQuery && ctx2.callbackQuery.data ? ctx2.callbackQuery.data : '';
        if (!data.startsWith('page:')) return;
        const chatId = ctx2.chat.id;
        const messageId = ctx2.msg ? ctx2.msg.message_id : null;
        const s = sessions.get(chatId);
        if (!access.isAuthorized(s, chatId, ctx2.from && ctx2.from.username)) {
            await ctx2.answerCallbackQuery({ text: '🔒 Требуется авторизация', show_alert: true }).catch(() => {});
            return;
        }
        await ctx2.answerCallbackQuery().catch(() => {});

        const page = parseInt(data.slice(5), 10);
        if (isNaN(page) || page < 0) return;
        const offset = page * limit;
        const pc = s.pageContext;
        if (!pc) return renderMenu(chatId, messageId);

        if (pc.kind === 'authors') return renderAuthors(chatId, messageId, pc.query.term, offset);
        if (pc.kind === 'series')  return renderSeries(chatId, messageId, pc.query.term, offset);
        if (pc.kind === 'books')   return renderBooks(chatId, messageId, pc.query, offset, pc.backCallback || 'menu:main');
        if (pc.kind === 'authorSeries') {
            const all = s.authorSeriesAll || [];
            const totalFound = all.length;
            const found = all.slice(offset, offset + limit);
            const totalPages = Math.ceil(totalFound / limit) || 1;
            const authorId = pc.query.authorId;
            const lines = [`👤 <b>${escapeHtml(s.authorName)}</b>`, ''];
            lines.push(totalFound ? `Серий: <b>${totalFound}</b>. Выберите:` : 'Серий нет.');
            const keyboard = seriesKeyboard(found, authorId, page, totalPages, page > 0, offset + limit < totalFound);
            return safeEdit(bot, chatId, messageId, lines.join('\n'), { parse_mode: 'HTML', reply_markup: keyboard });
        }
        if (pc.kind === 'noseries') {
            const authorId = pc.query.authorId;
            let list;
            try {
                list = await api.getAuthorBookList(authorId);
            } catch (e) {
                api.log(LM_ERR, `[telegram-bot][${chatId}] getAuthorBookList failed: ${e.message}`);
                return;
            }
            const all = (list.books || []).filter(b => !b.series);
            const totalFound = all.length;
            const found = all.slice(offset, offset + limit);
            s.lastBooks = found;
            s.offset = offset;

            const totalPages = Math.ceil(totalFound / limit) || 1;
            const authorName = pc.query.authorName || '';
            const lines = [`📚 <b>${escapeHtml(authorName)}</b> — книги без серии`, ''];
            lines.push(found.length ? `Найдено: <b>${totalFound}</b>. Выберите книгу:` : 'Ничего не найдено.');
            const keyboard = booksKeyboard(found, page, totalPages, page > 0, offset + limit < totalFound, `author:${authorId}`);
            return safeEdit(bot, chatId, messageId, lines.join('\n'), { parse_mode: 'HTML', reply_markup: keyboard });
        }
    }));

    // noop
    bot.on('callback_query', api.guard('onNoop', async (ctx2) => {
        if (!ctx2.callbackQuery || ctx2.callbackQuery.data !== 'noop') return;
        await ctx2.answerCallbackQuery().catch(() => {});
    }));
}

module.exports = { register };