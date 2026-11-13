// Обёртки Telegram (v2.4.0). Единое место: send / edit (с fallback) / answer / fromPath / isBenign.
const { fromPath } = require('node-telegram-bot-api/node');

function isBenign(e) {
    const desc = (e && e.response && e.response.body && e.response.body.description)
        ? String(e.response.body.description)
        : (e && e.message ? String(e.message) : '');
    return /message is not modified/i.test(desc)
        || /message is too long/i.test(desc)
        || /query is too old/i.test(desc)
        || /BUTTON_DATA_INVALID/i.test(desc);
}

function isEditNotFound(e) {
    const desc = (e && e.response && e.response.body && e.response.body.description)
        ? String(e.response.body.description)
        : (e && e.message ? String(e.message) : '');
    return /message to edit not found/i.test(desc)
        || /message can't be edited/i.test(desc);
}

function makeTg(bot) {
    async function send(chatId, text, opts) {
        return bot.api.sendMessage({ chat_id: chatId, text, ...(opts || {}) });
    }

    // editMessageText; при message to edit not found / can't be edited — fallback на send.
    // benign (not modified / too long / query too old / BUTTON_DATA_INVALID) — вернуть null.
    async function edit(chatId, messageId, text, opts) {
        if (!messageId)
            return send(chatId, text, opts);
        try {
            return await bot.api.editMessageText({
                chat_id: chatId,
                message_id: messageId,
                text,
                ...(opts || {}),
            });
        } catch (e) {
            if (isBenign(e))
                return null;
            if (isEditNotFound(e))
                return send(chatId, text, opts);
            throw e;
        }
    }

    async function answer(tgCtx, opts) {
        try {
            return await tgCtx.answerCallbackQuery(opts);
        } catch (e) {
            return null;
        }
    }

    async function sendDocument(chatId, filePath, opts) {
        const doc = await fromPath(filePath, opts);
        return bot.api.sendDocument({ chat_id: chatId, document: doc });
    }

    return { send, edit, answer, fromPath, sendDocument, isBenign, isEditNotFound };
}

module.exports = { makeTg, isBenign, isEditNotFound };