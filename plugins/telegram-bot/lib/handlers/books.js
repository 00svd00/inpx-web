const fs = require('fs-extra');
const { fromPath } = require('node-telegram-bot-api');
const { escapeHtml, safeEdit, formatBookCard } = require('../formatters');
const { bookKeyboard } = require('../keyboards');

const MAX_SEND_BYTES = 50 * 1024 * 1024; // Telegram Bot API limit

function register(bot, ctx) {
    const { api, sessions, access } = ctx;

    // book:<uid>
    bot.on('callback_query', api.guard('onBook', async (ctx2) => {
        const data = ctx2.callbackQuery && ctx2.callbackQuery.data ? ctx2.callbackQuery.data : '';
        if (!data.startsWith('book:')) return;
        const chatId = ctx2.chat.id;
        const messageId = ctx2.msg ? ctx2.msg.message_id : null;
        const s = sessions.get(chatId);
        if (!access.isAuthorized(s, chatId, ctx2.from && ctx2.from.username)) {
            await ctx2.answerCallbackQuery({ text: '🔒 Требуется авторизация', show_alert: true }).catch(() => {});
            return;
        }
        await ctx2.answerCallbackQuery().catch(() => {});

        const uid = data.slice(5);
        const book = (s.lastBooks || []).find(b => b._uid === uid);
        if (!book) {
            return safeEdit(bot, chatId, messageId, 'Книга устарела. Начните поиск заново.', {
                reply_markup: { inline_keyboard: [[{ text: '◀️ Меню', callback_data: 'menu:main' }]] },
            });
        }

        let info = null;
        try {
            info = await api.getBookInfo(uid);
        } catch (e) {
            if (e.message.startsWith('404'))
                return safeEdit(bot, chatId, messageId, '⚠️ Книга не найдена (возможно, удалена из библиотеки).', {
                    reply_markup: { inline_keyboard: [[{ text: '◀️ Назад', callback_data: 'back:search' }]] },
                });
            api.log(LM_WARN, `[telegram-bot][${chatId}] getBookInfo failed: ${e.message}`);
        }

        const text = formatBookCard(book, info);
        const opts = { parse_mode: 'HTML', reply_markup: bookKeyboard(uid) };
        return safeEdit(bot, chatId, messageId, text, opts);
    }));

    // dl:<uid>
    bot.on('callback_query', api.guard('onDownload', async (ctx2) => {
        const data = ctx2.callbackQuery && ctx2.callbackQuery.data ? ctx2.callbackQuery.data : '';
        if (!data.startsWith('dl:')) return;
        const chatId = ctx2.chat.id;
        const s = sessions.get(chatId);
        if (!access.isAuthorized(s, chatId, ctx2.from && ctx2.from.username)) {
            await ctx2.answerCallbackQuery({ text: '🔒 Требуется авторизация', show_alert: true }).catch(() => {});
            return;
        }
        await ctx2.answerCallbackQuery({ text: '⏳ Готовим файл…' }).catch(() => {});

        const uid = data.slice(3);

        let file;
        try {
            file = await api.getBookFile(uid, { format: 'zip' });
        } catch (e) {
            if (e.message.startsWith('404'))
                return bot.api.sendMessage({ chat_id: chatId, text: '⚠️ Файл не найден (возможно, удалён из библиотеки).' });
            api.log(LM_ERR, `[telegram-bot][${chatId}] getBookFile failed: ${e.message}`);
            return bot.api.sendMessage({ chat_id: chatId, text: `⚠️ Не удалось получить файл: ${escapeHtml(e.message)}`, parse_mode: 'HTML' });
        }

        let stat;
        try {
            stat = await fs.stat(file.path);
        } catch (e) {
            return bot.api.sendMessage({ chat_id: chatId, text: '⚠️ Файл не найден на сервере.' });
        }
        if (stat.size > MAX_SEND_BYTES) {
            return bot.api.sendMessage({ chat_id: chatId,
                text: `⚠️ Файл слишком большой для Telegram (${(stat.size / 1024 / 1024).toFixed(1)} МБ > 50 МБ).\n` +
                      'Это, скорее всего, ошибка материализации — сообщите администратору.',
            });
        }

        try {
            // v2: потоковая загрузка из файла, без буфера в памяти
            await bot.api.sendDocument({
                chat_id: chatId,
                document: await fromPath(file.path, { filename: file.filename }),
            });
        } catch (e) {
            api.log(LM_ERR, `[telegram-bot][${chatId}] sendDocument failed: ${e.message}`);
            return bot.api.sendMessage({ chat_id: chatId, text: `⚠️ Не удалось отправить файл: ${escapeHtml(e.message)}`, parse_mode: 'HTML' });
        }
    }));
}

module.exports = { register };