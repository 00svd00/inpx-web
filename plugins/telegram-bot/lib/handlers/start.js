const { menuKeyboard } = require('../keyboards');
const { escapeHtml, safeEdit } = require('../formatters');

function register(bot, ctx) {
    const { api, sessions, access } = ctx;

    const renderMenu = async (chatId, messageId) => {
        const text = '📚 <b>inpx-web</b>\n\nВыберите раздел:';
        const opts = { parse_mode: 'HTML', reply_markup: menuKeyboard() };
        if (messageId)
            return safeEdit(bot, chatId, messageId, text, opts);
        return bot.api.sendMessage({ chat_id: chatId, text, ...opts });
    };

    ctx.renderMenu = renderMenu;

    bot.hears(/^\/start(?:\s+(.+))?$/, api.guard('onStart', async (ctx2) => {
        const chatId = ctx2.chat.id;
        const password = (ctx2.match && ctx2.match[1] ? ctx2.match[1] : '').trim();
        const s = sessions.get(chatId);

        if (access.password) {
            if (!password)
                return ctx2.reply('🔒 Отправьте /start &lt;пароль&gt;.', { parse_mode: 'HTML' });
            if (password !== access.password)
                return ctx2.reply('❌ Неверный пароль.');
            s.authorized = true;
        } else if (access.allowedUsers.length) {
            const username = ctx2.from && ctx2.from.username;
            if (!access.isAuthorized(s, chatId, username))
                return ctx2.reply('🔒 Доступ запрещён.');
            s.authorized = true;
        }

        return renderMenu(chatId);
    }));

    bot.hears(/^\/help$/, api.guard('onHelp', async (ctx2) => {
        const chatId = ctx2.chat.id;
        if (!await access.ensureAuth(bot, sessions.get(chatId), ctx2.message, api)) return;
        const text = [
            '❓ <b>Помощь</b>',
            '',
            'Напишите текст — бот предложит, что искать (автор / серия / книга).',
            '',
            'Команды:',
            '/start — меню',
            '/search — поиск',
            '/help — эта справка',
        ].join('\n');
        return ctx2.reply(text, { parse_mode: 'HTML' });
    }));

    bot.hears(/^\/search$/, api.guard('onSearchCmd', async (ctx2) => {
        if (!await access.ensureAuth(bot, sessions.get(ctx2.chat.id), ctx2.message, api)) return;
        return ctx2.reply('Напишите текст запроса — бот предложит, что искать.');
    }));
}

module.exports = { register };