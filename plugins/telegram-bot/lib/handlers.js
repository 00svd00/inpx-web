// Тонкие handlers: (tgCtx, data, ctx) -> Promise.
// Без answerCallbackQuery (router), без isAuthorized (router), без safeEdit (renders/tg).
// Только логика сессии: обновить s.pageContext / s.lastBooks / s.authorId / ... и вызвать render*.
const { escapeHtml } = require('./formatters');
const { seriesKeyboard } = require('./keyboards');

function makeHandlers(ctx) {
    const { api, tg, sessions, renders, limit } = ctx;

    function chatAndMsg(tgCtx) {
        const m = tgCtx.msg || (tgCtx.callbackQuery && tgCtx.callbackQuery.message);
        return {
            chatId: tgCtx.chat.id,
            messageId: m ? m.message_id : null,
        };
    }

    // menu:*
    async function onMenu(tgCtx, data) {
        const { chatId, messageId } = chatAndMsg(tgCtx);
        const what = data.slice(5);
        const s = sessions.get(chatId);
        if (what === 'main') {
            s.searchText = '';
            s.mode = 'menu';
            return renders.renderMenu(chatId, messageId);
        }
        if (what === 'search') {
            s.searchText = '';
            s.mode = 'search';
            return renders.renderSearchFields(chatId, messageId, '');
        }
        if (what === 'help') {
            return tg.edit(chatId, messageId,
                'Напишите текст — бот предложит, что искать.\n\n/start — меню\n/help — справка',
                { reply_markup: { inline_keyboard: [[{ text: '◀️ Меню', callback_data: 'menu:main' }]] } });
        }
        if (what === 'author' || what === 'series') {
            const hint = what === 'author' ? 'имя автора' : 'название серии';
            s.mode = what;   // 'author' | 'series' — следующий текст пойдёт в render*
            return tg.edit(chatId, messageId, `Напишите ${hint} текстом — бот найдёт.`,
                { reply_markup: { inline_keyboard: [[{ text: '◀️ Меню', callback_data: 'menu:main' }]] } });
        }
    }

    // search:<field>
    async function onSearchField(tgCtx, data) {
        const { chatId, messageId } = chatAndMsg(tgCtx);
        const s = sessions.get(chatId);
        const field = data.slice(7);

        if (!s.searchText) {
            return tg.edit(chatId, messageId, 'Сначала напишите текст запроса.', {
                reply_markup: { inline_keyboard: [[{ text: '◀️ Меню', callback_data: 'menu:main' }]] },
            });
        }

        if (field === 'author') {
            s.pageContext = { kind: 'authors', query: { term: s.searchText } };
            return renders.renderAuthors(chatId, messageId, s.searchText, 0, limit, s.authorsById);
        }
        if (field === 'series') {
            s.pageContext = { kind: 'series', query: { term: s.searchText } };
            return renders.renderSeries(chatId, messageId, s.searchText, 0, limit, s.seriesById);
        }
        if (field === 'title') {
            s.pageContext = { kind: 'books', query: { title: s.searchText }, backCallback: 'menu:main' };
            return renders.renderBooks(chatId, messageId, { title: s.searchText }, 0, limit, s.lastBooks, 'menu:main');
        }
    }

    // author:<id>
    async function onAuthor(tgCtx, data) {
        const { chatId, messageId } = chatAndMsg(tgCtx);
        const s = sessions.get(chatId);
        const id = parseInt(data.slice(7), 10);
        if (!id) return;

        const author = s.authorsById.get(id);
        if (!author) {
            return tg.edit(chatId, messageId, 'Автор устарел. Начните поиск заново.', {
                reply_markup: { inline_keyboard: [[{ text: '◀️ Меню', callback_data: 'menu:main' }]] },
            });
        }

        s.authorId = id;
        s.authorName = author.author || author.name || '';
        // «без серии»: считаем из books (один getAuthorBookList)
        let noSeriesCount = 0;
        try {
            const list = await api.getAuthorBookList(id);
            noSeriesCount = (list.books || []).filter(b => !b.series).length;
        } catch (e) {
            api.log(LM_WARN, `[telegram-bot][${chatId}] getAuthorBookList failed: ${e.message}`);
        }
        s.authorSeriesNoSeriesCount = noSeriesCount;
        s.seriesById = new Map();
        s.pageContext = { kind: 'series', query: { term: '', authorName: s.authorName, authorId: id } };
        return renders.renderSeries(chatId, messageId, '', 0, limit, s.seriesById, s.authorName, id, noSeriesCount);
    }

    // series:<id>
    async function onSeries(tgCtx, data) {
        const { chatId, messageId } = chatAndMsg(tgCtx);
        const s = sessions.get(chatId);
        const id = parseInt(data.slice(7), 10);
        if (!id) return;

        const series = s.seriesById.get(id);
        if (!series) {
            return tg.edit(chatId, messageId, 'Серия устарела. Начните поиск заново.', {
                reply_markup: { inline_keyboard: [[{ text: '◀️ Меню', callback_data: 'menu:main' }]] },
            });
        }

        s.seriesName = series.series || series.name || '';
        const backCallback = s.authorId ? `author:${s.authorId}` : 'menu:main';
        // серия с одинаковым названием может быть у разных авторов — фильтруем по автору,
        // если пришли из author:<id> (authorId задан)
        const query = { series: s.seriesName };
        if (s.authorId && s.authorName)
            query.author = s.authorName;
        s.pageContext = { kind: 'books', query, backCallback };
        return renders.renderBooks(chatId, messageId, query, 0, limit, s.lastBooks, backCallback);
    }

    // noseries:<authorId>
    async function onNoSeries(tgCtx, data) {
        const { chatId, messageId } = chatAndMsg(tgCtx);
        const s = sessions.get(chatId);
        const authorId = parseInt(data.slice(9), 10);
        if (!authorId) return;
        return renders.renderNoSeries(chatId, messageId, authorId, 0, limit, s);
    }

    // book:<uid>
    async function onBook(tgCtx, data) {
        const { chatId, messageId } = chatAndMsg(tgCtx);
        const s = sessions.get(chatId);
        const uid = data.slice(5);
        const book = (s.lastBooks || []).find(b => b._uid === uid);
        if (!book) {
            return tg.edit(chatId, messageId, 'Книга устарела. Начните поиск заново.', {
                reply_markup: { inline_keyboard: [[{ text: '◀️ Меню', callback_data: 'menu:main' }]] },
            });
        }
        return renders.renderBook(chatId, messageId, book);
    }

    // dl:<uid>
    async function onDownload(tgCtx, data) {
        const { chatId } = chatAndMsg(tgCtx);
        const uid = data.slice(3);
        return renders.renderBookFile(chatId, uid);
    }

    // page:<n>
    async function onPage(tgCtx, data) {
        const { chatId, messageId } = chatAndMsg(tgCtx);
        const s = sessions.get(chatId);
        const page = parseInt(data.slice(5), 10);
        if (isNaN(page) || page < 0) return;
        const offset = page * limit;
        const pc = s.pageContext;
        if (!pc) return renders.renderMenu(chatId, messageId);

        if (pc.kind === 'authors')
            return renders.renderAuthors(chatId, messageId, pc.query.term, offset, limit, s.authorsById);
        if (pc.kind === 'series')
            return renders.renderSeries(chatId, messageId, pc.query.term || '', offset, limit, s.seriesById,
                pc.query.authorName, pc.query.authorId, s.authorSeriesNoSeriesCount);
        if (pc.kind === 'books')
            return renders.renderBooks(chatId, messageId, pc.query, offset, limit, s.lastBooks, pc.backCallback || 'menu:main');
        if (pc.kind === 'noseries')
            return renders.renderNoSeries(chatId, messageId, pc.query.authorId, offset, limit, s);
    }

    // back:search
    async function onBack(tgCtx) {
        const { chatId, messageId } = chatAndMsg(tgCtx);
        const s = sessions.get(chatId);
        const pc = s.pageContext;
        if (!pc) return renders.renderMenu(chatId, messageId);

        if (pc.kind === 'authors')
            return renders.renderAuthors(chatId, messageId, pc.query.term, 0, limit, s.authorsById);
        if (pc.kind === 'series')
            return renders.renderSeries(chatId, messageId, pc.query.term || '', offset, limit, s.seriesById,
                pc.query.authorName, pc.query.authorId, s.authorSeriesNoSeriesCount);
        if (pc.kind === 'books')
            return renders.renderBooks(chatId, messageId, pc.query, 0, limit, s.lastBooks, pc.backCallback || 'menu:main');
        if (pc.kind === 'noseries')
            return renders.renderNoSeries(chatId, messageId, pc.query.authorId, 0, limit, s);
        return renders.renderMenu(chatId, messageId);
    }

    async function onNoop() {
        return;
    }

    return {
        onMenu, onSearchField, onAuthor, onSeries, onNoSeries,
        onBook, onDownload, onPage, onBack, onNoop,
    };
}

module.exports = { makeHandlers };