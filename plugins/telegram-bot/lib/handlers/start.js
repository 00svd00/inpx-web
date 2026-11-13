const { menuKeyboard } = require('../keyboards');
const { safeEdit } = require('../formatters');

function register(bot, ctx) {
    const { api, sessions, access } = ctx;

    const renderMenu = async (chatId, messageId) => {
        const text = '📚 <b>inpx-web</b>\n\nВыберите раздел:';
        const opts = { parse_mode: 'HTML', reply_markup: menuKeyboard() };
        if (messageId)
            return safeEdit(bot, text, { chat_id: chatId, message_id: messageId, ...opts });
        return bot.sendMessage(chatId, text, opts);
    };

    ctx.renderMenu = renderMenu; // используется в других handlers

    bot.onText(/^\/start(?:\s+(.+))?$/, api.guard('onStart', async (msg, match) => {
        const chatId = msg.chat.id;
        const password = (match[1] || '').trim();
        const s = sessions.get(chatId);

        if (access.password) {
            if (!password)
                return bot.sendMessage(chatId, '🔒 Отправьте /start &lt;пароль&gt;.', { parse_mode: 'HTML' });
            if (password !== access.password)
                return bot.sendMessage(chatId, '❌ Неверный пароль.');
            s.authorized = true;
        } else if (access.allowedUsers.length) {
            const username = msg.from && msg.from.username;
            if (!access.isAuthorized(s, chatId, username))
                return bot.sendMessage(chatId, '🔒 Доступ запрещён.');
            s.authorized = true;
        }

        return renderMenu(chatId);
    }));

    bot.onText(/^\/help$/, api.guard('onHelp', async (msg) => {
        const chatId = msg.chat.id;
        if (!await access.ensureAuth(bot, sessions.get(chatId), msg, api)) return;
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
        return bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
    }));

    bot.onText(/^\/search$/, api.guard('onSearchCmd', async (msg) => {
        if (!await access.ensureAuth(bot, sessions.get(msg.chat.id), msg, api)) return;
        return bot.sendMessage(msg.chat.id, 'Напишите текст запроса — бот предложит, что искать.');
    }));
}

module.exports = { register };