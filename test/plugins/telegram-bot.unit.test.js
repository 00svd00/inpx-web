// Тесты handlers/renders с mock api + mock tg + fake sessions.
// Бот и Telegram API не используются — всё через ctx.
const assert = require('node:assert');
const test = require('node:test');
const os = require('os');
const path = require('path');
const fs = require('fs').promises;

if (global.LM_WARN === undefined) global.LM_WARN = 1;
if (global.LM_ERR === undefined) global.LM_ERR = 2;

const { SessionStore } = require('../../plugins/telegram-bot/lib/SessionStore');
const { makeAccess } = require('../../plugins/telegram-bot/lib/access');
const { makeRenders } = require('../../plugins/telegram-bot/lib/renders');
const { makeHandlers } = require('../../plugins/telegram-bot/lib/handlers');
const { makeTg } = require('../../plugins/telegram-bot/lib/tg');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFakeTg() {
    const botCalls = { sendMessage: [], editMessageText: [], sendDocument: [] };
    const bot = {
        api: {
            async sendMessage(msg) { botCalls.sendMessage.push(msg); return { ok: true }; },
            async editMessageText(msg) { botCalls.editMessageText.push(msg); return { ok: true }; },
            async sendDocument(msg) { botCalls.sendDocument.push(msg); return { ok: true }; },
        },
    };
    const tg = makeTg(bot);
    tg.calls = {
        send: botCalls.sendMessage,
        edit: botCalls.editMessageText,
        sendDocument: botCalls.sendDocument,   // теперь фейковый, см. ниже
        answer: [],
    };
    // answer считаем через обёртку (реальный tg.answer зовёт tgCtx.answerCallbackQuery)
    const origAnswer = tg.answer;
    tg.answer = async (tgCtx, opts) => {
        tg.calls.answer.push({ tgCtx, opts });
        return origAnswer(tgCtx, opts);
    };
    // sendDocument заменяем на записывающий filePath (реальный fromPath — интеграционная зона)
    tg.sendDocument = async (chatId, filePath, opts) => {
        tg.calls.sendDocument.push({ chatId, filePath, opts });
        return { ok: true };
    };
    return tg;
}

function makeFakeApi(opts = {}) {
    const calls = {
        search: [], getAuthorBookList: [], getSeriesBookList: [], getBookInfo: [],
        getBookFile: [], getGenreMap: [], log: [],
    };
    const defaults = {
        'author': { found: [], totalFound: 0 },
        'series': { found: [], totalFound: 0 },
        'title': { found: [], totalFound: 0 },
    };
    const api = {
        calls,
        version: '1.0',
        log(levelOrMsg, msg) { calls.log.push({ levelOrMsg, msg }); },
        async search(from, q) {
            calls.search.push({ from, q });
            if (opts.search) {
                const r = opts.search(from, q);
                if (r) return r;
            }
            return defaults[from] || { found: [], totalFound: 0 };
        },
        async getAuthorBookList(id) {
            calls.getAuthorBookList.push(id);
            if (opts.getAuthorBookList) return opts.getAuthorBookList(id);
            return { author: null, books: [] };
        },
        async getSeriesBookList(series) {
            calls.getSeriesBookList.push(series);
            if (opts.getSeriesBookList) return opts.getSeriesBookList(series);
            return { books: [] };
        },
        async getBookInfo(uid) {
            calls.getBookInfo.push(uid);
            if (opts.getBookInfo) return opts.getBookInfo(uid);
            return { bookInfo: null };
        },
        async getBookFile(uid, o) {
            calls.getBookFile.push({ uid, o });
            if (opts.getBookFile) return opts.getBookFile(uid, o);
            return { path: '/tmp/x', filename: 'x.zip', mime: 'application/zip' };
        },
        async getGenreMap() {
            calls.getGenreMap.push(true);
            if (opts.getGenreMap) return opts.getGenreMap();
            return new Map();
        },
    };
    return api;
}

function makeCtx(overrides = {}) {
    const api = overrides.api || makeFakeApi();
    const tg = overrides.tg || makeFakeTg();
    const sessions = overrides.sessions || new SessionStore({});
    const access = overrides.access || makeAccess({ allowedUsers: [], accessPassword: '' });
    const limit = overrides.limit || 10;
    const renders = makeRenders(api, tg);
    const ctx = { api, tg, sessions, access, limit, renders };
    ctx.handlers = makeHandlers(ctx);
    return ctx;
}

function makeTgCtx(chatId, data, extra = {}) {
    return {
        chat: { id: chatId },
        from: extra.from || { username: 'u' },
        callbackQuery: { data, message: { message_id: 100 } },
        answerCallbackQuery: async () => { extra.answered = true; },
        ...extra,
    };
}

function makeTgMsgCtx(chatId, text, date = Math.floor(Date.now() / 1000)) {
    return {
        chat: { id: chatId },
        from: { username: 'u' },
        message: { chat: { id: chatId }, text, date },
    };
}

// ---------------------------------------------------------------------------
// renders: пагинация и лимиты
// ---------------------------------------------------------------------------

test('renders.renderAuthors: пустой результат — "Ничего не найдено"', async () => {
    const ctx = makeCtx();
    const r = await ctx.renders.renderAuthors(1, 10, 'q', 0, 10);
    assert.strictEqual(r.totalFound, 0);
    assert.match(ctx.tg.calls.edit[0].text, /Ничего не найдено/);
});

test('renders.renderAuthors: totalPages рассчитан верно', async () => {
    const api = makeFakeApi({
        search: () => ({ found: [{ id: 1, author: 'A', bookCount: 1 }], totalFound: 25 }),
    });
    const ctx = makeCtx({ api });
    const r = await ctx.renders.renderAuthors(1, 10, 'q', 0, 10);
    assert.strictEqual(r.totalFound, 25);
    // 25/10 → 3 страницы
    const kb = ctx.tg.calls.edit[0].reply_markup.inline_keyboard;
    const nav = kb.find(row => row.some(b => b.callback_data === 'noop'));
    assert.match(nav.find(b => b.callback_data === 'noop').text, /1\/3/);
});

test('renders.renderAuthors: DB_NOT_READY → отдельное сообщение', async () => {
    const api = makeFakeApi({ search: () => { const e = new Error('DB_NOT_READY'); throw e; } });
    const ctx = makeCtx({ api });
    await ctx.renders.renderAuthors(1, null, 'q', 0, 10);
    assert.match(ctx.tg.calls.send[0].text, /Индекс загружается/);
});

test('renders.renderAuthors: ошибка поиска → "Ошибка поиска"', async () => {
    const api = makeFakeApi({ search: () => { throw new Error('boom'); } });
    const ctx = makeCtx({ api });
    await ctx.renders.renderAuthors(1, null, 'q', 0, 10);
    assert.match(ctx.tg.calls.send[0].text, /Ошибка поиска: boom/);
});

test('renders.renderSeries: authorId пробрасывается в keyboard', async () => {
    const api = makeFakeApi({
        search: () => ({ found: [{ id: 1, series: 'S', bookCount: 2 }], totalFound: 1 }),
    });
    const ctx = makeCtx({ api });
    await ctx.renders.renderSeries(1, 10, '', 0, 10, { authorId: 5, noSeriesCount: 3 });
    const kb = ctx.tg.calls.edit[0].reply_markup.inline_keyboard;
    assert.ok(kb.some(row => row.some(b => b.callback_data === 'noseries:5')));
});

test('renders.renderSeries: term → query.series, authorName → query.author', async () => {
    const api = makeFakeApi();
    const ctx = makeCtx({ api });
    await ctx.renders.renderSeries(1, 10, 'term', 0, 10, { authorName: 'A' });
    const q = api.calls.search[0].q;
    assert.strictEqual(q.series, 'term');
    assert.strictEqual(q.author, 'A');
});

test('renders.renderTitles: сохраняет titlesById', async () => {
    const api = makeFakeApi({
        search: () => ({ found: [{ id: 7, title: 'T', bookCount: 2, books: [{ _uid: 'u1' }] }], totalFound: 1 }),
    });
    const ctx = makeCtx({ api });
    const titlesById = new Map();
    await ctx.renders.renderTitles(1, 10, 'q', 0, 10, titlesById);
    assert.ok(titlesById.has(7));
    assert.deepStrictEqual(titlesById.get(7).books, [{ _uid: 'u1' }]);
});

test('renders.renderTitleBooks: пагинация из локального массива', async () => {
    const books = Array.from({ length: 25 }, (_, i) => ({ _uid: 'u' + i, title: 'T' + i }));
    const ctx = makeCtx();
    const r = await ctx.renders.renderTitleBooks(1, 10, 'Название', books, 10, 10);
    assert.strictEqual(r.totalFound, 25);
    assert.strictEqual(r.found.length, 10);
    assert.strictEqual(r.found[0]._uid, 'u10');
});

test('renders.renderSeriesBooks: фильтр по автору (соавторы)', async () => {
    const api = makeFakeApi({
        getSeriesBookList: () => ({
            books: [
                { _uid: 'a', author: 'Иванов', series: 'S' },
                { _uid: 'b', author: 'Петров, Иванов', series: 'S' },
                { _uid: 'c', author: 'Сидоров', series: 'S' },
            ],
        }),
    });
    const ctx = makeCtx({ api });
    const r = await ctx.renders.renderSeriesBooks(1, 10, 'S', 'иванов', 0, 10);
    assert.strictEqual(r.totalFound, 2);
    assert.deepStrictEqual(r.found.map(b => b._uid).sort(), ['a', 'b']);
});

test('renders.renderSeriesBooks: без authorName — все книги', async () => {
    const api = makeFakeApi({
        getSeriesBookList: () => ({ books: [{ _uid: 'a' }, { _uid: 'b' }] }),
    });
    const ctx = makeCtx({ api });
    const r = await ctx.renders.renderSeriesBooks(1, 10, 'S', '', 0, 10);
    assert.strictEqual(r.totalFound, 2);
});

test('renders.renderNoSeries: фильтрует книги без series', async () => {
    const api = makeFakeApi({
        getAuthorBookList: () => ({
            books: [
                { _uid: 'a', series: 'S' },
                { _uid: 'b' },
                { _uid: 'c', series: '' },
            ],
        }),
    });
    const ctx = makeCtx({ api });
    const r = await ctx.renders.renderNoSeries(1, 10, 5, 0, 10, 'A', 'author:5');
    assert.deepStrictEqual(r.found.map(b => b._uid).sort(), ['b', 'c']);
});

test('renders.renderBook: onReady вызывается после getBookInfo', async () => {
    let ready = false;
    const api = makeFakeApi({
        getBookInfo: () => ({ bookInfo: { book: { title: 'T' }, bookInfo: { titleInfo: {} } } }),
    });
    const ctx = makeCtx({ api });
    await ctx.renders.renderBook(1, 10, { _uid: 'u1', title: 'T' }, async () => { ready = true; });
    assert.strictEqual(ready, true);
});

test('renders.renderBook: 404 → "Книга не найдена", onReady всё равно вызван', async () => {
    let ready = false;
    const api = makeFakeApi({ getBookInfo: () => { throw new Error('404 not found'); } });
    const ctx = makeCtx({ api });
    await ctx.renders.renderBook(1, 10, { _uid: 'u1' }, async () => { ready = true; });
    assert.strictEqual(ready, true);
    assert.match(ctx.tg.calls.edit[0].text, /Книга не найдена/);
});

test('renders.renderBookFile: файл > 50MB → отказ', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tgbot-big-'));
    const file = path.join(dir, 'big.zip');
    await fs.writeFile(file, Buffer.alloc(51 * 1024 * 1024)); // 51MB
    const api = makeFakeApi({ getBookFile: () => ({ path: file, filename: 'big.zip', mime: 'application/zip' }) });
    const ctx = makeCtx({ api });
    await ctx.renders.renderBookFile(1, 'u1');
    assert.match(ctx.tg.calls.send[0].text, /слишком большой/);
    await fs.rm(dir, { recursive: true, force: true });
});

test('renders.renderBookFile: успешная отправка → sendDocument', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tgbot-doc-'));
    const file = path.join(dir, 'ok.zip');
    await fs.writeFile(file, 'data');
    const api = makeFakeApi({ getBookFile: () => ({ path: file, filename: 'ok.zip', mime: 'application/zip' }) });
    const ctx = makeCtx({ api });
    await ctx.renders.renderBookFile(1, 'u1');
    assert.strictEqual(ctx.tg.calls.sendDocument.length, 1);
    assert.strictEqual(ctx.tg.calls.sendDocument[0].filePath, file);
    await fs.rm(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// handlers: сценарии
// ---------------------------------------------------------------------------

test('onMenu: menu:main сбрасывает поиск/автора/страницу', async () => {
    const ctx = makeCtx();
    const s = ctx.sessions.get(1);
    s.searchText = 'x'; s.authorId = 5; s.pageContext = { kind: 'authors' };
    await ctx.handlers.onMenu(makeTgCtx(1, 'menu:main'), 'menu:main');
    assert.strictEqual(s.searchText, '');
    assert.strictEqual(s.authorId, 0);
    assert.strictEqual(s.pageContext, null);
});

test('onMenu: menu:help → formatHelp', async () => {
    const ctx = makeCtx();
    await ctx.handlers.onMenu(makeTgCtx(1, 'menu:help'), 'menu:help');
    assert.match(ctx.tg.calls.edit[0].text, /Памятка по поиску/);
});

test('onMenu: menu:author — подсказка и mode', async () => {
    const ctx = makeCtx();
    const s = ctx.sessions.get(1);
    await ctx.handlers.onMenu(makeTgCtx(1, 'menu:author'), 'menu:author');
    assert.strictEqual(s.mode, 'author');
    assert.match(ctx.tg.calls.edit[0].text, /имя автора/);
});

test('onSearchField: без searchText → "Сначала напишите текст"', async () => {
    const ctx = makeCtx();
    await ctx.handlers.onSearchField(makeTgCtx(1, 'search:author'), 'search:author');
    assert.match(ctx.tg.calls.edit[0].text, /Сначала напишите текст/);
});

test('onSearchField: author → search("author"), authorsById заполнен', async () => {
    const api = makeFakeApi({
        search: () => ({ found: [{ id: 7, author: 'A', bookCount: 3 }], totalFound: 1 }),
    });
    const ctx = makeCtx({ api });
    const s = ctx.sessions.get(1);
    s.searchText = 'pushkin';
    await ctx.handlers.onSearchField(makeTgCtx(1, 'search:author'), 'search:author');
    assert.strictEqual(api.calls.search[0].from, 'author');
    assert.ok(s.authorsById.has(7));
});

test('onAuthor: неизвестный id → "Автор устарел"', async () => {
    const ctx = makeCtx();
    await ctx.handlers.onAuthor(makeTgCtx(1, 'author:999'), 'author:999');
    assert.match(ctx.tg.calls.edit[0].text, /Автор устарел/);
});

test('onAuthor: getAuthorBookList → Map серий, noSeriesCount, seriesById', async () => {
    const api = makeFakeApi({
        getAuthorBookList: () => ({
            author: { id: 1, name: 'A' },
            books: [
                { series: 'S1' }, { series: 'S1' }, { series: 'S2' }, {},
            ],
        }),
        search: () => ({ found: [{ id: 10, series: 'S1', bookCount: 2 }, { id: 11, series: 'S2', bookCount: 1 }], totalFound: 2 }),
    });
    const ctx = makeCtx({ api });
    const s = ctx.sessions.get(1);
    s.authorsById.set(1, { id: 1, author: 'A', bookCount: 4 });
    await ctx.handlers.onAuthor(makeTgCtx(1, 'author:1'), 'author:1');
    assert.strictEqual(s.authorSeriesNoSeriesCount, 1);
    assert.strictEqual(s.authorSeriesCounts.get('S1'), 2);
    assert.strictEqual(s.authorSeriesCounts.get('S2'), 1);
    assert.ok(s.seriesById.has(10));
});

test('onTitle: неизвестный id → "Название устарело"', async () => {
    const ctx = makeCtx();
    await ctx.handlers.onTitle(makeTgCtx(1, 'title:999'), 'title:999');
    assert.match(ctx.tg.calls.edit[0].text, /Название устарело/);
});

test('onSeries: из автора → backCallback = author:<id>', async () => {
    const api = makeFakeApi({
        getSeriesBookList: () => ({ books: [{ _uid: 'a', author: 'A' }] }),
    });
    const ctx = makeCtx({ api });
    const s = ctx.sessions.get(1);
    s.authorId = 5; s.authorName = 'A';
    s.seriesById.set(10, { id: 10, series: 'S' });
    await ctx.handlers.onSeries(makeTgCtx(1, 'series:10'), 'series:10');
    const kb = ctx.tg.calls.edit[0].reply_markup.inline_keyboard;
    const back = kb[kb.length - 1][0];
    assert.strictEqual(back.callback_data, 'author:5');
});

test('onCardAuthor: находит автора через =firstAuthor', async () => {
    const authorCalls = [];
    const api = makeFakeApi({
        search: (from, q) => {
            if (from === 'author') authorCalls.push(q.author);
            if (from === 'author' && q.author === '=Иванов') return { found: [{ id: 3, author: 'Иванов', bookCount: 1 }], totalFound: 1 };
            return { found: [], totalFound: 0 };
        },
        getAuthorBookList: () => ({ author: null, books: [] }),
    });
    const ctx = makeCtx({ api });
    const s = ctx.sessions.get(1);
    s.lastBooks = [{ _uid: 'u1', author: 'Иванов, Петров' }];
    await ctx.handlers.onCardAuthor(makeTgCtx(1, 'cardauthor:u1'), 'cardauthor:u1');
    assert.deepStrictEqual(authorCalls, ['=Иванов']);
    assert.ok(s.authorsById.has(3));
});


test('onCardAuthor: fallback *firstAuthor', async () => {
    const authorCalls = [];
    const api = makeFakeApi({
        search: (from, q) => {
            if (from === 'author') authorCalls.push(q.author);
            if (from === 'author' && q.author === '=Иванов') return { found: [], totalFound: 0 };
            if (from === 'author' && q.author === '*Иванов') return { found: [{ id: 4, author: 'Иванов', bookCount: 1 }], totalFound: 1 };
            return { found: [], totalFound: 0 };
        },
        getAuthorBookList: () => ({ author: null, books: [] }),
    });
    const ctx = makeCtx({ api });
    const s = ctx.sessions.get(1);
    s.lastBooks = [{ _uid: 'u1', author: 'Иванов' }];
    await ctx.handlers.onCardAuthor(makeTgCtx(1, 'cardauthor:u1'), 'cardauthor:u1');
    assert.deepStrictEqual(authorCalls, ['=Иванов', '*Иванов']);
    assert.ok(s.authorsById.has(4));
});

test('onCardSeries: fallback на *series', async () => {
    const calls = [];
    const api = makeFakeApi({
        search: (from, q) => {
            calls.push(q);
            if (q.series === '=S') return { found: [], totalFound: 0 };
            if (q.series === '*S') return { found: [{ id: 9, series: 'S', bookCount: 1 }], totalFound: 1 };
            return { found: [], totalFound: 0 };
        },
        getSeriesBookList: () => ({ books: [] }),
    });
    const ctx = makeCtx({ api });
    const s = ctx.sessions.get(1);
    s.lastBooks = [{ _uid: 'u1', series: 'S' }];
    await ctx.handlers.onCardSeries(makeTgCtx(1, 'cardseries:u1'), 'cardseries:u1');
    assert.deepStrictEqual(calls.map(q => q.series), ['=S', '*S']);
    assert.ok(s.seriesById.has(9));
});

test('onBook: неизвестный uid → "Книга устарела" + tg.answer', async () => {
    const ctx = makeCtx();
    await ctx.handlers.onBook(makeTgCtx(1, 'book:u999'), 'book:u999');
    assert.match(ctx.tg.calls.edit[0].text, /Книга устарела/);
    assert.strictEqual(ctx.tg.calls.answer.length, 1);
});

test('onDownload: вызывает renders.renderBookFile', async () => {
    const api = makeFakeApi({ getBookFile: () => ({ path: '/tmp/x', filename: 'x.zip', mime: 'application/zip' }) });
    const ctx = makeCtx({ api });
    await ctx.handlers.onDownload(makeTgCtx(1, 'dl:u1'), 'dl:u1');
    assert.strictEqual(api.calls.getBookFile.length, 1);
});

test('onPage: page:<n> → offset = n * limit', async () => {
    const api = makeFakeApi({
        search: () => ({ found: [{ id: 1, author: 'A', bookCount: 1 }], totalFound: 25 }),
    });
    const ctx = makeCtx({ api, limit: 10 });
    const s = ctx.sessions.get(1);
    s.pageContext = { kind: 'authors', query: { term: 'q' } };
    await ctx.handlers.onPage(makeTgCtx(1, 'page:2'), 'page:2');
    assert.strictEqual(api.calls.search[0].q.offset, 20);
});

test('onPage: невалидный n → игнор', async () => {
    const ctx = makeCtx();
    await ctx.handlers.onPage(makeTgCtx(1, 'page:-1'), 'page:-1');
    assert.strictEqual(ctx.tg.calls.edit.length, 0);
});

test('onMessage: не авторизован + нет пароля → "Доступ запрещён"', async () => {
    const ctx = makeCtx();
    await ctx.handlers.onMessage(makeTgMsgCtx(1, 'hi'));
    assert.match(ctx.tg.calls.send[0].text, /Доступ запрещён/);
});

test('onMessage: /start без пароля → "Введите пароль"', async () => {
    const access = makeAccess({ accessPassword: 'secret' });
    const ctx = makeCtx({ access });
    await ctx.handlers.onMessage(makeTgMsgCtx(1, '/start'));
    assert.match(ctx.tg.calls.send[0].text, /Введите пароль/);
});

test('onMessage: неверный пароль → "Неверный пароль"', async () => {
    const access = makeAccess({ accessPassword: 'secret' });
    const ctx = makeCtx({ access });
    await ctx.handlers.onMessage(makeTgMsgCtx(1, 'wrong'));
    assert.match(ctx.tg.calls.send[0].text, /Неверный пароль/);
});

test('onMessage: верный пароль → addAuthorized + menu', async () => {
    const access = makeAccess({ accessPassword: 'secret' });
    const ctx = makeCtx({ access });
    await ctx.handlers.onMessage(makeTgMsgCtx(1, 'secret'));
    // renderMenu(chatId, null) → tg.edit с messageId=null → fallback на send
    assert.strictEqual(ctx.tg.calls.edit.length, 0);
    assert.strictEqual(ctx.tg.calls.send.length, 1);
    assert.match(ctx.tg.calls.send[0].text, /Что искать/);
});

test('onMessage: authLocked → "заблокированы"', async () => {
    const access = makeAccess({ accessPassword: 'secret' });
    const ctx = makeCtx({ access });
    const s = ctx.sessions.get(1);
    s.authLocked = true;
    await ctx.handlers.onMessage(makeTgMsgCtx(1, 'secret'));
    assert.match(ctx.tg.calls.send[0].text, /заблокированы/);
});

test('onMessage: сообщение старше 60 сек — игнорируется', async () => {
    const ctx = makeCtx();
    const oldDate = Math.floor(Date.now() / 1000) - 3600;
    await ctx.handlers.onMessage(makeTgMsgCtx(1, 'hello', oldDate));
    assert.strictEqual(ctx.tg.calls.send.length, 0);
    assert.strictEqual(ctx.tg.calls.edit.length, 0);
});

test('onMessage: авторизован + /start → renderMenu', async () => {
    const access = makeAccess({ allowedUsers: [1] });
    const ctx = makeCtx({ access });
    await ctx.handlers.onMessage(makeTgMsgCtx(1, '/start'));
    assert.strictEqual(ctx.tg.calls.edit.length, 0);
    assert.strictEqual(ctx.tg.calls.send.length, 1);
    assert.match(ctx.tg.calls.send[0].text, /Что искать/);
});

test('onMessage: авторизован + свободный текст → renderSearchFields', async () => {
    const access = makeAccess({ allowedUsers: [1] });
    const ctx = makeCtx({ access });
    const s = ctx.sessions.get(1);
    await ctx.handlers.onMessage(makeTgMsgCtx(1, 'pushkin'));
    assert.strictEqual(s.searchText, 'pushkin');
    assert.strictEqual(s.mode, 'search');
    assert.match(ctx.tg.calls.send[0].text, /Что искать/);
});

test('onMessage: mode=author + текст → search("author")', async () => {
    const access = makeAccess({ allowedUsers: [1] });
    const api = makeFakeApi({
        search: () => ({ found: [{ id: 1, author: 'A', bookCount: 1 }], totalFound: 1 }),
    });
    const ctx = makeCtx({ access, api });
    const s = ctx.sessions.get(1);
    s.mode = 'author';
    await ctx.handlers.onMessage(makeTgMsgCtx(1, 'pushkin'));
    assert.strictEqual(api.calls.search[0].from, 'author');
    assert.strictEqual(s.mode, 'menu');
});