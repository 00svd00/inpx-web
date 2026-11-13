const fs = require('fs-extra');
const { escapeHtml, safeEdit, formatBookCard } = require('../formatters');
const { bookKeyboard } = require('../keyboards');

const MAX_SEND_BYTES = 50 * 1024 * 1024; // Telegram Bot API limit

function register(bot, ctx) {
    const { api, sessions, access } = ctx;

    // book:<uid> — карточка
    bot.on('callback_query', api.guard('onBook', async (query) => {
        const data = query.data || '';
        if (!data.startsWith('book:')) return;
        const chatId = query.message.chat.id;
        const messageId = query.message.message_id;
        const s = sessions.get(chatId);
        if (!access.isAuthorized(s, chatId, query.from && query.from.username)) {
            await bot.answerCallbackQuery(query.id, { text: '🔒 Требуется авторизация', show_alert: true }).catch(() => {});
            return;
        }
        await bot.answerCallbackQuery(query.id).catch(() => {});

        const uid = data.slice(5);
        const book = (s.lastBooks || []).find(b => b._uid === uid);
        if (!book) {
            return safeEdit(bot, 'Книга устарела. Начните поиск заново.', {
                chat_id: chatId, message_id: messageId,
                reply_markup: { inline_keyboard: [[{ text: '◀️ Меню', callback_data: 'menu:main' }]] },
            });
        }

        let info = null;
        try {
            info = await api.getBookInfo(uid);
        } catch (e) {
            if (e.message.startsWith('404'))
                return safeEdit(bot, '⚠️ Книга не найдена (возможно, удалена из библиотеки).', {
                    chat_id: chatId, message_id: messageId,
                    reply_markup: { inline_keyboard: [[{ text: '◀️ Назад', callback_data: 'back:search' }]] },
                });
            api.log(LM_WARN, `[telegram-bot] getBookInfo failed: ${e.message}`);
        }

        const text = formatBookCard(book, info);
        const opts = { parse_mode: 'HTML', reply_markup: bookKeyboard(uid) };
        return safeEdit(bot, text, { chat_id: chatId, message_id: messageId, ...opts });
    }));

    // dl:<uid> — скачать и отправить файлом
    bot.on('callback_query', api.guard('onDownload', async (query) => {
        const data = query.data || '';
        if (!data.startsWith('dl:')) return;
        const chatId = query.message.chat.id;
        const s = sessions.get(chatId);
        if (!access.isAuthorized(s, chatId, query.from && query.from.username)) {
            await bot.answerCallbackQuery(query.id, { text: '🔒 Требуется авторизация', show_alert: true }).catch(() => {});
            return;
        }
        await bot.answerCallbackQuery(query.id, { text: '⏳ Готовим файл…' }).catch(() => {});

        const uid = data.slice(3);

        let file;
        try {
            file = await api.getBookFile(uid, { format: 'zip' });
        } catch (e) {
            if (e.message.startsWith('404'))
                return bot.sendMessage(chatId, '⚠️ Файл не найден (возможно, удалён из библиотеки).');
            api.log(LM_ERR, `[telegram-bot] getBookFile failed: ${e.message}`);
            return bot.sendMessage(chatId, `⚠️ Не удалось получить файл: ${escapeHtml(e.message)}`, { parse_mode: 'HTML' });
        }

        let stat;
        try {
            stat = await fs.stat(file.path);
        } catch (e) {
            return bot.sendMessage(chatId, '⚠️ Файл не найден на сервере.');
        }
        if (stat.size > MAX_SEND_BYTES) {
            return bot.sendMessage(chatId,
                `⚠️ Файл слишком большой для Telegram (${(stat.size / 1024 / 1024).toFixed(1)} МБ > 50 МБ).\n` +
                'Это, скорее всего, ошибка материализации — сообщите администратору.');
        }

        try {
            await bot.sendDocument(chatId, file.path, {}, {
                filename: file.filename,
                contentType: file.mime || 'application/octet-stream',
            });
        } catch (e) {
            api.log(LM_ERR, `[telegram-bot] sendDocument failed: ${e.message}`);
            return bot.sendMessage(chatId, `⚠️ Не удалось отправить файл: ${escapeHtml(e.message)}`, { parse_mode: 'HTML' });
        }
    }));
}

module.exports = { register };