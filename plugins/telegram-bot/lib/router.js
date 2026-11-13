// Один bot.on('callback_query') → dispatch по data. Один bot.on('message') → onText.
// bot.hears(/^\/start|help|search/) → onCommand.
// answerCallbackQuery — ОДИН раз здесь (до логики), isAuthorized — ОДИН раз здесь.
function registerRouter(bot, ctx) {
    const { api, tg, sessions, access, handlers, renders } = ctx;
    const { formatHelp } = require('./formatters');

    const ROUTES = [
        { prefix: 'menu:',     handler: 'onMenu' },
        { prefix: 'search:',   handler: 'onSearchField' },
        { prefix: 'author:',   handler: 'onAuthor' },
        { prefix: 'series:',   handler: 'onSeries' },
        { prefix: 'noseries:', handler: 'onNoSeries' },
        { prefix: 'book:',     handler: 'onBook' },
        { prefix: 'dl:',       handler: 'onDownload' },
        { prefix: 'page:',     handler: 'onPage' },
        { prefix: 'back:',     handler: 'onBack' },
    ];

    bot.on('callback_query', api.guard('onCallback', async (tgCtx) => {
        const data = tgCtx.callbackQuery && tgCtx.callbackQuery.data ? tgCtx.callbackQuery.data : '';
        const chatId = tgCtx.chat.id;

        await tg.answer(tgCtx);

        const s = sessions.get(chatId);
        if (!access.isAuthorized(s, chatId, tgCtx.from && tgCtx.from.username))
            return tg.send(chatId, '🔒 Требуется авторизация. Отправьте /start <пароль>.');

        if (data === 'noop') return handlers.onNoop(tgCtx);

        const route = ROUTES.find(r => data.startsWith(r.prefix));
        if (!route) return;
        return handlers[route.handler](tgCtx, data, ctx);
    }));

    bot.on('message', api.guard('onMessage', async (tgCtx) => {
        const msg = tgCtx.message;
        if (!msg || !msg.text) return;
        // игнор накопившихся сообщений (пока бот был offline): старше 1 минуты
        const msgAge = Date.now() / 1000 - (msg.date || 0);
        if (msgAge > 60) {
            // тихо, без ответа (пользователь напишет ещё раз)
            return;
        }
        const text = msg.text.trim();
        const chatId = msg.chat.id;
        const s = sessions.get(chatId);

        if (text.startsWith('/start')) {
            const password = (text.split(/\s+/)[1] || '').trim();
            if (access.password) {
                if (!password)
                    return tg.send(chatId, '🔒 Отправьте /start &lt;пароль&gt;.', { parse_mode: 'HTML' });
                if (password !== access.password)
                    return tg.send(chatId, '❌ Неверный пароль.');
                s.authorized = true;
            } else if (access.allowedUsers.length) {
                if (!access.isAuthorized(s, chatId, tgCtx.from && tgCtx.from.username))
                    return tg.send(chatId, '🔒 Доступ запрещён.');
                s.authorized = true;
            }
            s.searchText = '';
            s.authorId = 0;
            s.authorName = '';
            return renders.renderMenu(chatId, null);
        }

        if (text === '/help') {
            if (!access.isAuthorized(s, chatId, tgCtx.from && tgCtx.from.username))
                return tg.send(chatId, '🔒 Требуется авторизация. Отправьте /start <пароль>.');
            const { formatHelp } = require('./formatters');
            return tg.send(chatId, formatHelp(), { parse_mode: 'HTML' });
        }

        if (text === '/author' || text === '/series' || text === '/title') {
            if (!access.isAuthorized(s, chatId, tgCtx.from && tgCtx.from.username))
                return tg.send(chatId, '🔒 Требуется авторизация. Отправьте /start <пароль>.');
            s.mode = text.slice(1);
            s.authorId = 0;
            s.authorName = '';
            const hint = s.mode === 'author' ? 'имя автора' : s.mode === 'series' ? 'название серии' : 'название книги';
            return tg.send(chatId, `Напишите ${hint} — бот найдёт.`);
        }

        // свободный текст
        if (!access.isAuthorized(s, chatId, tgCtx.from && tgCtx.from.username))
            return tg.send(chatId, '🔒 Требуется авторизация. Отправьте /start <пароль>.');
        
        // s.mode: 'author' | 'series' | 'title' — шорткат; иначе — «Что искать?»
        if (s.mode === 'author') {
            s.mode = 'menu';
            s.authorId = 0;
            s.authorName = '';
            s.pageContext = { kind: 'authors', query: { term: text } };
            return renders.renderAuthors(chatId, null, text, 0, ctx.limit, s.authorsById);
        }
        if (s.mode === 'series') {
            s.mode = 'menu';
            s.authorId = 0;
            s.authorName = '';
            s.pageContext = { kind: 'series', query: { term: text } };
            return renders.renderSeries(chatId, null, text, 0, ctx.limit, s.seriesById);
        }
        if (s.mode === 'title') {
            s.mode = 'menu';
            s.authorId = 0;
            s.authorName = '';
            s.pageContext = { kind: 'books', query: { title: text }, backCallback: 'menu:main' };
            return renders.renderBooks(chatId, null, { title: text }, 0, ctx.limit, s.lastBooks, 'menu:main');
        }

        s.searchText = text;
        s.mode = 'search';
        return renders.renderSearchFields(chatId, null, text);
    }));
}

module.exports = { registerRouter };