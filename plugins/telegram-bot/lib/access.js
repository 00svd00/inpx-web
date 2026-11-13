function makeAccess(config) {
    const allowedUsers = Array.isArray(config.allowedUsers) ? config.allowedUsers : [];
    const password = config.accessPassword || '';

    function isAuthorized(session, chatId, username) {
        if (allowedUsers.length) {
            const id = String(chatId);
            const name = username ? String(username) : '';
            return allowedUsers.some(u => String(u) === id || (name && String(u) === name));
        }
        return !!(session && session.authorized);
    }

    return { isAuthorized, password, allowedUsers };
}

module.exports = { makeAccess };