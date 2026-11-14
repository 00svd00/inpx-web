const fsp = require('fs').promises;
const path = require('path');

function makeAccess(config, opts = {}) {
    const allowedUsers = Array.isArray(config.allowedUsers) ? config.allowedUsers : [];
    const password = config.accessPassword || '';
    const authFile = opts.authFile || '';
    const maxFailures = opts.maxFailures || 3;
    const authorizedUsers = new Set();   // Set<chatId string>, персистентно в authFile

    function norm(v) { return v === undefined || v === null ? '' : String(v); }

    function inList(list, chatId, username) {
        const id = norm(chatId);
        const name = norm(username);
        return list.some(u => norm(u) === id || (name && norm(u) === name));
    }

    function isAuthorized(session, chatId, username) {
        if (inList(allowedUsers, chatId, username)) return true;
        if (authorizedUsers.has(norm(chatId))) return true;
        return !!(session && session.authorized);
    }

    async function loadAuthorized() {
        if (!authFile) return;
        try {
            const raw = await fsp.readFile(authFile, 'utf8');
            const arr = JSON.parse(raw);
            if (Array.isArray(arr)) for (const id of arr) authorizedUsers.add(norm(id));
        } catch (e) {
            if (e.code !== 'ENOENT') throw e;   // нет файла — ок, создадим при первой записи
        }
    }

    async function addAuthorized(chatId) {
        const id = norm(chatId);
        if (!id) return;
        if (authorizedUsers.has(id)) return;
        authorizedUsers.add(id);
        if (!authFile) return;
        try {
            await fsp.mkdir(path.dirname(authFile), { recursive: true });
            await fsp.writeFile(authFile, JSON.stringify(Array.from(authorizedUsers), null, 4));
        } catch (e) {
            // caller логирует
        }
    }

    // результат: { ok: true } | { ok: false, locked: true } | { ok: false }
    // lock — boolean на сессии; снимается только когда сессия истекает
    // (т.е. пользователь перестал слать сообщения на TTL + CLEAN_INTERVAL).
    // Активный брутфорс — lock не снимается (намеренно).
    function checkPassword(session, text) {
        if (session.authLocked)
            return { ok: false, locked: true };
        if (text && text === password) {
            session.authorized = true;
            session.authFailures = 0;
            session.authLocked = false;
            return { ok: true };
        }
        session.authFailures = (session.authFailures || 0) + 1;
        if (session.authFailures > maxFailures) {
            session.authLocked = true;
            return { ok: false, locked: true };
        }
        return { ok: false };
    }

    return { isAuthorized, loadAuthorized, addAuthorized, checkPassword, password, allowedUsers, maxFailures };
}

module.exports = { makeAccess };