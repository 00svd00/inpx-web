function makeAccess(config) {
    const allowedUsers = Array.isArray(config.allowedUsers) ? config.allowedUsers : [];
    const password = config.accessPassword || '';

    function isAuthorized(session, chatId, username) {
        if (allowedUsers.length)
            return allowedUsers.includes(chatId) || (username && allowedUsers.includes(username));
        return !!(session && session.authorized);
    }

    // true — можно; false — уже отправлено сообщение об отказе
    async function ensureAuth(bot, session, msg, api) {
        const chatId = msg.chat.id;
        const username = msg.from && msg.from.username;
        if (isAuthorized(session, chatId, username))
            return true;
        try {
            await bot.sendMessage(chatId, '🔒 Требуется авторизация. Отправьте /start <пароль>.');
        } catch (e) {
            api.log(LM_WARN, `[telegram-bot][${chatId}] sendMessage failed: ${e.message}`);
        }
        return false;
    }

    return { isAuthorized, ensureAuth, password, allowedUsers };
}

module.exports = { makeAccess };