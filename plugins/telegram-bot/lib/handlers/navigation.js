const { escapeHtml, safeEdit } = require('../formatters');
const { seriesKeyboard, booksKeyboard } = require('../keyboards');

function register(bot, ctx) {
    const { api, sessions, access, limit } = ctx;
    const { renderMenu, renderAuthors, renderSeries, renderBooks } = ctx;

    // menu:*
    bot.on('callback_query', api.guard('onMenu', async (query) => {
        const data = query.data || '';
        if (!data.startsWith('menu:')) return;
        const chatId = query.message.chat.id;
        const messageId = query.message.message_id;
        const s = sessions.get(chatId);
        if (!access.isAuthorized(s, chatId, query.from && query.from.username)) {
            await bot.answerCallbackQuery(query.id, { text: '🔒 Требуется авторизация', show_alert: true }).catch(() => {});
            return;
        }
        await bot.answerCallbackQuery(query.id).catch(() => {});

        const what = data.slice(5);
        if (what === 'main') return renderMenu(chatId, messageId);
        if (what === 'search') {
            return safeEdit(bot, 'Напишите текст запроса — бот предложит, что искать.', {
                chat_id: chatId, message_id: messageId,
                reply_markup: { inline_keyboard: [[{ text: '◀️ Меню', callback_data: 'menu:main' }]] },
            });
        }
        if (what === 'help') {
            return safeEdit(bot, 'Напишите текст — бот предложит, что искать.\n\n/start — меню\n/help — справка', {
                chat_id: chatId, message_id: messageId,
                reply_markup: { inline_keyboard: [[{ text: '◀️ Меню', callback_data: 'menu:main' }]] },
            });
        }
        if (what === 'author' || what === 'series') {
            const hint = what === 'author' ? 'имя автора' : 'название серии';
            return safeEdit(bot, `Напишите ${hint} текстом — бот найдёт.`, {
                chat_id: chatId, message_id: messageId,
                reply_markup: { inline_keyboard: [[{ text: '◀️ Меню', callback_data: 'menu:main' }]] },
            });
        }
        return;
    }));

    // author:<id> → серии автора + «Без серии»
    bot.on('callback_query', api.guard('onAuthor', async (query) => {
        const data = query.data || '';
        if (!data.startsWith('author:')) return;
        const chatId = query.message.chat.id;
        const messageId = query.message.message_id;
        const s = sessions.get(chatId);
        if (!access.isAuthorized(s, chatId, query.from && query.from.username)) {
            await bot.answerCallbackQuery(query.id, { text: '🔒 Требуется авторизация', show_alert: true }).catch(() => {});
            return;
        }
        await bot.answerCallbackQuery(query.id).catch(() => {});

        const id = parseInt(data.slice(7), 10);
        if (!id) return;
        const author = s.authorsById.get(id);
        if (!author) {
            return safeEdit(bot, 'Автор устарел. Начните поиск заново.', {
                chat_id: chatId, message_id: messageId,
                reply_markup: { inline_keyboard: [[{ text: '◀️ Меню', callback_data: 'menu:main' }]] },
            });
        }

        let res;
        try {
            res = await api.getAuthorSeriesList(id);
        } catch (e) {
            api.log(LM_ERR, `[telegram-bot][${chatId}] getAuthorSeriesList failed: ${e.message}`);
            return bot.sendMessage(chatId, `⚠️ Ошибка: ${escapeHtml(e.message)}`, { parse_mode: 'HTML' });
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
        const page = 0;
        const showPrev = false;
        const showNext = limit < totalFound;

        const lines = [`👤 <b>${escapeHtml(s.authorName)}</b>`, ''];
        lines.push(totalFound ? `Серий: <b>${totalFound}</b>. Выберите:` : 'Серий нет — откройте «Без серии».');

        const keyboard = seriesKeyboard(found, id, page, totalPages, showPrev, showNext);
        const opts = { parse_mode: 'HTML', reply_markup: keyboard };
        return safeEdit(bot, lines.join('\n'), { chat_id: chatId, message_id: messageId, ...opts });
    }));

    // series:<id> → книги серии
    bot.on('callback_query', api.guard('onSeries', async (query) => {
        const data = query.data || '';
        if (!data.startsWith('series:')) return;
        const chatId = query.message.chat.id;
        const messageId = query.message.message_id;
        const s = sessions.get(chatId);
        if (!access.isAuthorized(s, chatId, query.from && query.from.username)) {
            await bot.answerCallbackQuery(query.id, { text: '🔒 Требуется авторизация', show_alert: true }).catch(() => {});
            return;
        }
        await bot.answerCallbackQuery(query.id).catch(() => {});

        const id = parseInt(data.slice(7), 10);
        if (!id) return;
        const series = s.seriesById.get(id);
        if (!series) {
            return safeEdit(bot, 'Серия устарела. Начните поиск заново.', {
                chat_id: chatId, message_id: messageId,
                reply_markup: { inline_keyboard: [[{ text: '◀️ Меню', callback_data: 'menu:main' }]] },
            });
        }
        s.seriesName = series.series || series.name || '';
        return renderBooks(chatId, messageId, { series: s.seriesName }, 0, `author:${s.authorId || 0}`);
    }));

    // noseries:<authorId> → книги автора без серии
    bot.on('callback_query', api.guard('onNoSeries', async (query) => {
        const data = query.data || '';
        if (!data.startsWith('noseries:')) return;
        const chatId = query.message.chat.id;
        const messageId = query.message.message_id;
        const s = sessions.get(chatId);
        if (!access.isAuthorized(s, chatId, query.from && query.from.username)) {
            await bot.answerCallbackQuery(query.id, { text: '🔒 Требуется авторизация', show_alert: true }).catch(() => {});
            return;
        }
        await bot.answerCallbackQuery(query.id).catch(() => {});

        const authorId = parseInt(data.slice(9), 10);
        if (!authorId) return;
        const author = s.authorsById.get(authorId);
        if (!author) {
            return safeEdit(bot, 'Автор устарел. Начните поиск заново.', {
                chat_id: chatId, message_id: messageId,
                reply_markup: { inline_keyboard: [[{ text: '◀️ Меню', callback_data: 'menu:main' }]] },
            });
        }
        const authorName = author.author || author.name || s.authorName || '';

        // OPDS-модель: getAuthorBookList → filter(!series) → пагинация в боте
        let list;
        try {
            list = await api.getAuthorBookList(authorId);
        } catch (e) {
            api.log(LM_ERR, `[telegram-bot][${chatId}] getAuthorBookList failed: ${e.message}`);
            return bot.sendMessage(chatId, `⚠️ Ошибка: ${escapeHtml(e.message)}`, { parse_mode: 'HTML' });
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
        const page = 0;
        const showPrev = false;
        const showNext = offset + limit < totalFound;

        const lines = [`📚 <b>${escapeHtml(authorName)}</b> — книги без серии`, ''];
        lines.push(found.length ? `Найдено: <b>${totalFound}</b>. Выберите книгу:` : 'Ничего не найдено.');

        const keyboard = booksKeyboard(found, page, totalPages, showPrev, showNext, `author:${authorId}`);
        const opts = { parse_mode: 'HTML', reply_markup: keyboard };
        return safeEdit(bot, lines.join('\n'), { chat_id: chatId, message_id: messageId, ...opts });
    }));

    // back:search — вернуться к pageContext
    bot.on('callback_query', api.guard('onBack', async (query) => {
        if (query.data !== 'back:search') return;
        const chatId = query.message.chat.id;
        const messageId = query.message.message_id;
        const s = sessions.get(chatId);
        if (!access.isAuthorized(s, chatId, query.from && query.from.username)) {
            await bot.answerCallbackQuery(query.id, { text: '🔒 Требуется авторизация', show_alert: true }).catch(() => {});
            return;
        }
        await bot.answerCallbackQuery(query.id).catch(() => {});

        const pc = s.pageContext;
        if (!pc) return renderMenu(chatId, messageId);

        if (pc.kind === 'authors') return renderAuthors(chatId, messageId, pc.query.term, 0);
        if (pc.kind === 'series') return renderSeries(chatId, messageId, pc.query.term, 0);
        if (pc.kind === 'books') return renderBooks(chatId, messageId, pc.query, 0, pc.backCallback || 'menu:main');
        if (pc.kind === 'authorSeries') {
            // вернуться к списку серий автора (первая страница)
            const all = s.authorSeriesAll || [];
            const found = all.slice(0, limit);
            const totalPages = Math.ceil(all.length / limit) || 1;
            const authorId = pc.query.authorId;
            const lines = [`👤 <b>${escapeHtml(s.authorName)}</b>`, ''];
            lines.push(all.length ? `Серий: <b>${all.length}</b>. Выберите:` : 'Серий нет.');
            const keyboard = seriesKeyboard(found, authorId, 0, totalPages, false, limit < all.length);
            return safeEdit(bot, lines.join('\n'), { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: keyboard });
        }
        if (pc.kind === 'noseries') {
            // повторный рендер «без серии» — через onNoSeries (не дублируем; вернёмся к автору)
            return safeEdit(bot, 'Вернитесь к автору заново.', {
                chat_id: chatId, message_id: messageId,
                reply_markup: { inline_keyboard: [[{ text: `👤 Автор`, callback_data: `author:${pc.query.authorId}` }], [{ text: '◀️ Меню', callback_data: 'menu:main' }]] },
            });
        }
        return renderMenu(chatId, messageId);
    }));

    // page:<n> — пагинация по pageContext
    bot.on('callback_query', api.guard('onPage', async (query) => {
        const data = query.data || '';
        if (!data.startsWith('page:')) return;
        const chatId = query.message.chat.id;
        const messageId = query.message.message_id;
        const s = sessions.get(chatId);
        if (!access.isAuthorized(s, chatId, query.from && query.from.username)) {
            await bot.answerCallbackQuery(query.id, { text: '🔒 Требуется авторизация', show_alert: true }).catch(() => {});
            return;
        }
        await bot.answerCallbackQuery(query.id).catch(() => {});

        const page = parseInt(data.slice(5), 10);
        if (isNaN(page) || page < 0) return;
        const offset = page * limit;
        const pc = s.pageContext;
        if (!pc) return renderMenu(chatId, messageId);

        if (pc.kind === 'authors') return renderAuthors(chatId, messageId, pc.query.term, offset);
        if (pc.kind === 'series') return renderSeries(chatId, messageId, pc.query.term, offset);
        if (pc.kind === 'books') return renderBooks(chatId, messageId, pc.query, offset, pc.backCallback || 'menu:main');
        if (pc.kind === 'authorSeries') {
            const all = s.authorSeriesAll || [];
            const totalFound = all.length;
            const found = all.slice(offset, offset + limit);
            const totalPages = Math.ceil(totalFound / limit) || 1;
            const showPrev = page > 0;
            const showNext = offset + limit < totalFound;

            const authorId = pc.query.authorId;
            const lines = [`👤 <b>${escapeHtml(s.authorName)}</b>`, ''];
            lines.push(totalFound ? `Серий: <b>${totalFound}</b>. Выберите:` : 'Серий нет.');
            const keyboard = seriesKeyboard(found, authorId, page, totalPages, showPrev, showNext);
            return safeEdit(bot, lines.join('\n'), { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: keyboard });
        }
        // noseries/authorSeries — пагинация по authorId (серии — без пагинации в базе; noseries — пересчёт)
        if (pc.kind === 'noseries') {
            // повторный расчёт «без серии» с offset
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
            const showPrev = page > 0;
            const showNext = offset + limit < totalFound;

            const authorName = pc.query.authorName || '';
            const lines = [`📚 <b>${escapeHtml(authorName)}</b> — книги без серии`, ''];
            lines.push(found.length ? `Найдено: <b>${totalFound}</b>. Выберите книгу:` : 'Ничего не найдено.');

            const keyboard = booksKeyboard(found, page, totalPages, showPrev, showNext, `author:${authorId}`);
            return safeEdit(bot, lines.join('\n'), { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: keyboard });
        }
        return;
    }));

    // noop
    bot.on('callback_query', api.guard('onNoop', async (query) => {
        if (query.data !== 'noop') return;
        await bot.answerCallbackQuery(query.id).catch(() => {});
    }));
}

module.exports = { register };