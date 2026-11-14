// Handlers: оркестрация. Читают сессию → render* (возвращают данные) → сохраняют в сессию.
// answerCallbackQuery / isAuthorized — в router (до вызова handler).
const { escapeHtml, formatHelp } = require('./formatters');

function makeHandlers(ctx) {
    const { api, tg, sessions, renders, limit, access } = ctx;

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
            sessions.resetSearch(s);
            sessions.resetAuthor(s);
            sessions.resetPage(s);
            return renders.renderMenu(chatId, messageId);
        }
        if (what === 'help') {
            return tg.edit(chatId, messageId, formatHelp(), {
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: [[{ text: '◀️ Меню', callback_data: 'menu:main' }]] },
            });
        }
        if (what === 'author' || what === 'series' || what === 'title') {
            const hint = what === 'author' ? 'имя автора'
                : what === 'series' ? 'название серии'
                : 'название книги';
            sessions.resetAuthor(s);
            s.mode = what;
            return tg.edit(chatId, messageId, `Напишите ${hint} текстом — бот найдёт.`, {
                reply_markup: { inline_keyboard: [[{ text: '◀️ Меню', callback_data: 'menu:main' }]] },
            });
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

        sessions.resetAuthor(s);
        if (field === 'author') {
            s.pageContext = { kind: 'authors', query: { term: s.searchText } };
            const r = await renders.renderAuthors(chatId, messageId, s.searchText, 0, limit);
            if (r && r.found) for (const a of r.found) if (a.id && a.bookCount) s.authorsById.set(a.id, a);
            return;
        }
        if (field === 'series') {
            s.pageContext = { kind: 'series', query: { term: s.searchText } };
            const r = await renders.renderSeries(chatId, messageId, s.searchText, 0, limit);
            if (r && r.found) for (const x of r.found) if (x.id && x.bookCount) s.seriesById.set(x.id, x);
            return;
        }
        if (field === 'title') {
            s.pageContext = { kind: 'titles', query: { term: s.searchText } };
            const r = await renders.renderTitles(chatId, messageId, s.searchText, 0, limit, s.titlesById);
            return;
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

        let noSeriesCount = 0;
        try {
            const list = await api.getAuthorBookList(id);
            noSeriesCount = (list.books || []).filter(b => !b.series).length;
        } catch (e) {
            api.log(LM_WARN, `[telegram-bot][${chatId}] getAuthorBookList failed: ${e.message}`);
        }
        s.authorSeriesNoSeriesCount = noSeriesCount;

        s.pageContext = { kind: 'series', query: { term: '', authorName: s.authorName, authorId: id } };
        const r = await renders.renderSeries(chatId, messageId, '', 0, limit, {
            authorName: s.authorName, authorId: id, noSeriesCount,
        });
        if (r && r.found) for (const x of r.found) if (x.id && x.bookCount) s.seriesById.set(x.id, x);
    }

    // title:<id>
    async function onTitle(tgCtx, data) {
        const { chatId, messageId } = chatAndMsg(tgCtx);
        const s = sessions.get(chatId);
        const id = parseInt(data.slice(6), 10);
        if (!id) return;

        const title = s.titlesById.get(id);
        if (!title) {
            return tg.edit(chatId, messageId, 'Название устарело. Начните поиск заново.', {
                reply_markup: { inline_keyboard: [[{ text: '◀️ Меню', callback_data: 'menu:main' }]] },
            });
        }

        const titleName = title.title || title.name || '';
        s.pageContext = { kind: 'titleBooks', query: { titleId: id, titleName, term: s.searchText || '' }, backCallback: 'back:titles' };
        const r = await renders.renderTitleBooks(chatId, messageId, titleName, title.books || [], 0, limit, 'back:titles');
        if (r && r.found) s.lastBooks = r.found;
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
        if (s.authorId && s.authorName) {
            const backCallback = `author:${s.authorId}`;
            s.pageContext = { kind: 'seriesBooks', query: { seriesName: s.seriesName, authorName: s.authorName }, backCallback };
            const r = await renders.renderSeriesBooks(chatId, messageId, s.seriesName, s.authorName, 0, limit, backCallback);
            if (r && r.found) s.lastBooks = r.found;
            return;
        }
        s.pageContext = { kind: 'seriesBooks', query: { seriesName: s.seriesName, authorName: '' }, backCallback: 'menu:main' };
        const r = await renders.renderSeriesBooks(chatId, messageId, s.seriesName, '', 0, limit, 'menu:main');
        if (r && r.found) s.lastBooks = r.found;
    }

    // noseries:<authorId>
    async function onNoSeries(tgCtx, data) {
        const { chatId, messageId } = chatAndMsg(tgCtx);
        const s = sessions.get(chatId);
        const authorId = parseInt(data.slice(9), 10);
        if (!authorId) return;
        s.pageContext = { kind: 'noseries', query: { authorId, authorName: s.authorName }, backCallback: `author:${authorId}` };
        const r = await renders.renderNoSeries(chatId, messageId, authorId, 0, limit, s.authorName, `author:${authorId}`);
        if (r && r.found) s.lastBooks = r.found;
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

        if (pc.kind === 'authors') {
            const r = await renders.renderAuthors(chatId, messageId, pc.query.term, offset, limit);
            if (r && r.found) for (const a of r.found) if (a.id && a.bookCount) s.authorsById.set(a.id, a);
            return;
        }
        if (pc.kind === 'series') {
            const r = await renders.renderSeries(chatId, messageId, pc.query.term || '', offset, limit, {
                authorName: pc.query.authorName, authorId: pc.query.authorId,
                noSeriesCount: s.authorSeriesNoSeriesCount,
            });
            if (r && r.found) for (const x of r.found) if (x.id && x.bookCount) s.seriesById.set(x.id, x);
            return;
        }
        if (pc.kind === 'titles') {
            await renders.renderTitles(chatId, messageId, pc.query.term, offset, limit, s.titlesById);
            return;
        }
        if (pc.kind === 'titleBooks') {
            const t = s.titlesById.get(pc.query.titleId);
            const r = await renders.renderTitleBooks(chatId, messageId, pc.query.titleName, t ? t.books : [], offset, limit, pc.backCallback || 'back:titles');
            if (r && r.found) s.lastBooks = r.found;
            return;
        }
        if (pc.kind === 'seriesBooks') {
            const r = await renders.renderSeriesBooks(chatId, messageId, pc.query.seriesName, pc.query.authorName, offset, limit, pc.backCallback || 'menu:main');
            if (r && r.found) s.lastBooks = r.found;
            return;
        }
        if (pc.kind === 'noseries') {
            const r = await renders.renderNoSeries(chatId, messageId, pc.query.authorId, offset, limit, s.authorName, pc.backCallback);
            if (r && r.found) s.lastBooks = r.found;
        }
    }

    // back:search / back:titles
    async function onBack(tgCtx) {
        const data = tgCtx.callbackQuery && tgCtx.callbackQuery.data ? tgCtx.callbackQuery.data : '';
        if (data === 'back:titles') return onBackTitles(tgCtx);

        const { chatId, messageId } = chatAndMsg(tgCtx);
        const s = sessions.get(chatId);
        const pc = s.pageContext;
        if (!pc) return renders.renderMenu(chatId, messageId);

        if (pc.kind === 'authors') {
            const r = await renders.renderAuthors(chatId, messageId, pc.query.term, 0, limit);
            if (r && r.found) for (const a of r.found) if (a.id && a.bookCount) s.authorsById.set(a.id, a);
            return;
        }
        if (pc.kind === 'series') {
            const r = await renders.renderSeries(chatId, messageId, pc.query.term || '', 0, limit, {
                authorName: pc.query.authorName, authorId: pc.query.authorId,
                noSeriesCount: s.authorSeriesNoSeriesCount,
            });
            if (r && r.found) for (const x of r.found) if (x.id && x.bookCount) s.seriesById.set(x.id, x);
            return;
        }
        if (pc.kind === 'titles')
            return renders.renderTitles(chatId, messageId, pc.query.term, 0, limit, s.titlesById);
        if (pc.kind === 'titleBooks') {
            const t = s.titlesById.get(pc.query.titleId);
            return renders.renderTitleBooks(chatId, messageId, pc.query.titleName, t ? t.books : [], 0, limit, pc.backCallback || 'back:titles');
        }
        if (pc.kind === 'seriesBooks') {
            const r = await renders.renderSeriesBooks(chatId, messageId, pc.query.seriesName, pc.query.authorName, 0, limit, pc.backCallback || 'menu:main');
            if (r && r.found) s.lastBooks = r.found;
            return;
        }
        if (pc.kind === 'noseries') {
            const r = await renders.renderNoSeries(chatId, messageId, pc.query.authorId, 0, limit, s.authorName, pc.backCallback);
            if (r && r.found) s.lastBooks = r.found;
            return;
        }
        return renders.renderMenu(chatId, messageId);
    }

    // back:titles — из книг названия вернуться к списку названий
    async function onBackTitles(tgCtx) {
        const { chatId, messageId } = chatAndMsg(tgCtx);
        const s = sessions.get(chatId);
        const pc = s.pageContext;
        if (pc && pc.kind === 'titleBooks' && pc.query.term) {
            return renders.renderTitles(chatId, messageId, pc.query.term, 0, limit, s.titlesById);
        }
        return renders.renderMenu(chatId, messageId);
    }

    async function onNoop() {
        return;
    }

    // onMessage — из router (был большой, теперь здесь)
    async function onMessage(tgCtx) {
        const msg = tgCtx.message;
        if (!msg || !msg.text) return;
        const msgAge = Date.now() / 1000 - (msg.date || 0);
        if (msgAge > 60) return;

        const text = msg.text.trim();
        const chatId = msg.chat.id;
        const s = sessions.get(chatId);

        const username = tgCtx.from && tgCtx.from.username;
        const authed = access.isAuthorized(s, chatId, username);

        // не авторизован
        if (!authed) {
            if (!access.password)
                return tg.send(chatId, '🔒 Доступ запрещён.');

            if (text === '/start')
                return tg.send(chatId, '🔒 Введите пароль.');

            let attempt = null;
            if (text.startsWith('/start '))
                attempt = text.slice(7).trim();
            else if (!text.startsWith('/'))
                attempt = text;
            else
                return tg.send(chatId, '🔒 Введите пароль.');

            const r = access.checkPassword(s, attempt);
            if (r.ok) {
                try { await access.addAuthorized(chatId); } catch (e) {
                    api.log(LM_WARN, `[telegram-bot][${chatId}] addAuthorized failed: ${e.message}`);
                }
                sessions.resetSearch(s);
                sessions.resetAuthor(s);
                sessions.resetPage(s);
                return renders.renderMenu(chatId, null);
            }
            if (r.locked)
                return tg.send(chatId, `🚫 Вы заблокированы. Попробуйте через ${r.minutes} мин.`);
            return tg.send(chatId, '❌ Не авторизован.');
        }

        // авторизован
        if (text === '/start' || text.startsWith('/start ')) {
            sessions.resetSearch(s);
            sessions.resetAuthor(s);
            sessions.resetPage(s);
            return renders.renderMenu(chatId, null);
        }
        if (text === '/help') {
            return tg.send(chatId, formatHelp(), { parse_mode: 'HTML' });
        }

        if (text === '/author' || text === '/series' || text === '/title') {
            sessions.resetAuthor(s);
            s.mode = text.slice(1);
            const hint = s.mode === 'author' ? 'имя автора' : s.mode === 'series' ? 'название серии' : 'название книги';
            return tg.send(chatId, `Напишите ${hint} — бот найдёт.`);
        }

        if (s.mode === 'author') {
            s.mode = 'menu';
            sessions.resetAuthor(s);
            s.pageContext = { kind: 'authors', query: { term: text } };
            const r = await renders.renderAuthors(chatId, null, text, 0, limit);
            if (r && r.found) for (const a of r.found) if (a.id && a.bookCount) s.authorsById.set(a.id, a);
            return;
        }
        if (s.mode === 'series') {
            s.mode = 'menu';
            sessions.resetAuthor(s);
            s.pageContext = { kind: 'series', query: { term: text } };
            const r = await renders.renderSeries(chatId, null, text, 0, limit);
            if (r && r.found) for (const x of r.found) if (x.id && x.bookCount) s.seriesById.set(x.id, x);
            return;
        }
        if (s.mode === 'title') {
            s.mode = 'menu';
            sessions.resetAuthor(s);
            s.pageContext = { kind: 'titles', query: { term: text } };
            await renders.renderTitles(chatId, null, text, 0, limit, s.titlesById);
            return;
        }

        s.searchText = text;
        s.mode = 'search';
        return renders.renderSearchFields(chatId, null, text);
    }

    return {
        onMenu, onSearchField, onAuthor, onTitle, onSeries, onNoSeries,
        onBook, onDownload, onPage, onBack, onBackTitles, onNoop, onMessage,
    };
}

module.exports = { makeHandlers };