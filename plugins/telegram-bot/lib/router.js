// Router: только диспатч. answerCallbackQuery / isAuthorized — здесь (до handler'а).
function registerRouter(bot, ctx) {
    const { api, tg, sessions, access, handlers } = ctx;

    const ROUTES = [
        { prefix: 'menu:',     handler: 'onMenu' },
        { prefix: 'search:',   handler: 'onSearchField' },
        { prefix: 'author:',   handler: 'onAuthor' },
        { prefix: 'title:',    handler: 'onTitle' },
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

    bot.on('message', api.guard('onMessage', handlers.onMessage));
}

module.exports = { registerRouter };