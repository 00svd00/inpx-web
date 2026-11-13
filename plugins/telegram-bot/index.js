// Telegram-бот для inpx-web: OPDS-like поиск и навигация.
// Контракт: PluginApi 1.0 (см. plugins/example/README.md).
//
// Поток поиска (OPDS-модель):
//   пользователь пишет текст → «Что искать?» (inline: title/author/series/genre)
//   → результаты (пагинация через editMessageText) → карточка книги.
//
// Ошибки Telegram, которые НЕ являются ошибками:
//   - 400 message is not modified — тот же текст/клавиатура;
//   - 400 message is too long — текст > 4096;
//   - 400 query is too old — callback > 48ч;
//   - 400 BUTTON_DATA_INVALID — callback_data > 64 байт.
// Все они перехватываются safeEdit / api.guard и логируются, но не пробрасываются.

const TelegramBot = require('node-telegram-bot-api');

const PAGE_SIZE_DEFAULT = 10;

const sessions = new Map();

function getSession(chatId) {
    let s = sessions.get(chatId);
    if (!s) {
        s = {
            authorized: false,
            mode: 'menu',
            searchText: '',
            field: 'title',
            offset: 0,
            limit: PAGE_SIZE_DEFAULT,
            lastResults: null,
            history: [],
        };
        sessions.set(chatId, s);
    }
    return s;
}

function escapeMd(s) {
    // для parse_mode: 'HTML' достаточно экранировать < > &
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function truncate(s, n) {
    s = String(s || '');
    return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function bookLabel(b) {
    const author = b.author ? b.author.split(',')[0] : '';
    const title = b.title || '(без названия)';
    return truncate(`${author ? author + ' — ' : ''}${title}`, 60);
}

function bookUid(b) {
    return b && b._uid ? b._uid : '';
}

function makeAbsoluteUrl(base, link) {
    if (!link) return '';
    if (/^https?:\/\//i.test(link)) return link;
    if (!base) return '';
    const b = base.replace(/\/$/, '');
    const l = link.startsWith('/') ? link : `/${link}`;
    return `${b}${l}`;
}

// Telegram: некоторые 400 — не ошибки. Возвращаем true, если можно игнорировать.
function isTelegramBenign(e) {
    const desc = (e && e.response && e.response.body && e.response.body.description)
        ? String(e.response.body.description)
        : '';
    return /message is not modified/i.test(desc)
        || /message is too long/i.test(desc)
        || /query is too old/i.test(desc)
        || /BUTTON_DATA_INVALID/i.test(desc);
}

// safeEdit: обёртка editMessageText; «безобидные» 400 — не пробрасываем.
async function safeEdit(bot, text, opts) {
    try {
        return await bot.editMessageText(text, opts);
    } catch (e) {
        if (isTelegramBenign(e))
            return null;
        throw e;
    }
}

module.exports = {
    async start(api, config) {
        // 1) версия контракта
        const major = String(api.version).split('.')[0];
        if (major !== '1') {
            api.log(LM_WARN, `[telegram-bot] unsupported api.version=${api.version}, skip`);
            return;
        }

        // 2) токен
        if (!config.token) {
            api.log(LM_WARN, '[telegram-bot] token is empty, skip');
            return;
        }

        // 3) доступ
        const allowedUsers = Array.isArray(config.allowedUsers) ? config.allowedUsers : [];
        if (!config.accessPassword && !allowedUsers.length) {
            api.log(LM_WARN, '[telegram-bot] accessPassword/allowedUsers empty — refusing to start public bot, skip');
            return;
        }

        // 4) ждём БД
        try {
            await api.waitReady({ timeoutMs: 60000 });
        } catch (e) {
            api.log(LM_ERR, `[telegram-bot] waitReady failed: ${e.message}`);
            return;
        }

        // 5) бот
        const bot = new TelegramBot(config.token, { polling: true });
        const publicUrl = config.publicUrl || api.config.rootPathStatic || '';

        const isAuthorized = (chatId, username) => {
            if (allowedUsers.length)
                return allowedUsers.includes(chatId) || (username && allowedUsers.includes(username));
            const s = getSession(chatId);
            return s.authorized;
        };

        const ensureAuth = (msg) => {
            const chatId = msg.chat.id;
            const username = msg.from && msg.from.username;
            if (isAuthorized(chatId, username))
                return true;
            bot.sendMessage(chatId, '🔒 Требуется авторизация. Отправьте /start <пароль>.')
                .catch(e => api.log(LM_WARN, `[telegram-bot] sendMessage failed: ${e.message}`));
            return false;
        };

        // ---- клавиатуры ----
        const menuKeyboard = () => ({
            inline_keyboard: [
                [{ text: '🔍 Поиск', callback_data: 'menu:search' }],
                [{ text: '👤 Авторы', callback_data: 'menu:author' }, { text: '📚 Серии', callback_data: 'menu:series' }],
                [{ text: '🏷️ Жанры', callback_data: 'menu:genre' }, { text: '❓ Помощь', callback_data: 'menu:help' }],
            ],
        });

        const searchFieldKeyboard = () => ({
            inline_keyboard: [
                [{ text: '📖 Название', callback_data: 'search:title' }],
                [{ text: '👤 Автор', callback_data: 'search:author' }],
                [{ text: '📚 Серия', callback_data: 'search:series' }],
                [{ text: '🏷️ Жанр', callback_data: 'search:genre' }],
                [{ text: '◀️ Меню', callback_data: 'menu:main' }],
            ],
        });

        const resultsKeyboard = (chatId, page, totalPages, showPrev, showNext) => {
            const s = getSession(chatId);
            const rows = [];
            if (s.lastResults && s.lastResults.found) {
                for (const b of s.lastResults.found) {
                    const uid = bookUid(b);
                    if (!uid) continue;
                    rows.push([{ text: `📖 ${bookLabel(b)}`, callback_data: `book:${uid}` }]);
                }
            }
            const nav = [];
            if (showPrev) nav.push({ text: '◀️', callback_data: `page:${page - 1}` });
            nav.push({ text: `${page + 1}/${Math.max(1, totalPages)}`, callback_data: 'noop' });
            if (showNext) nav.push({ text: '▶️', callback_data: `page:${page + 1}` });
            if (nav.length) rows.push(nav);
            rows.push([{ text: '◀️ Меню', callback_data: 'menu:main' }]);
            return { inline_keyboard: rows };
        };

        const bookKeyboard = (book) => {
            const rows = [];
            const uid = bookUid(book);
            rows.push([{ text: '⬇️ Скачать', callback_data: `dl:${uid}` }]);
            if (book.author) {
                const authorName = book.author.split(',')[0].trim();
                if (authorName)
                    rows.push([{ text: `👤 ${truncate(authorName, 40)}`, callback_data: `byname:author:${authorName}` }]);
            }
            if (book.series)
                rows.push([{ text: `📚 ${truncate(book.series, 40)}`, callback_data: `byname:series:${book.series}` }]);
            rows.push([{ text: '💬 Рецензии', callback_data: `reviews:${uid}` }]);
            rows.push([{ text: '👤 Об авторе', callback_data: `bio:${uid}` }]);
            rows.push([{ text: '◀️ К результатам', callback_data: 'back:search' }]);
            return { inline_keyboard: rows };
        };

        // ---- рендеры (sendMessage — без try/catch, но с .catch; editMessageText — через safeEdit) ----
        const renderMenu = async (chatId, messageId) => {
            const text = '📚 *inpx-web*\n\nВыберите раздел:';
            const opts = { parse_mode: 'Markdown', reply_markup: menuKeyboard() };
            if (messageId)
                return safeEdit(bot, text, { chat_id: chatId, message_id: messageId, ...opts });
            return bot.sendMessage(chatId, text, opts);
        };

        const renderSearchFields = async (chatId, messageId, searchText) => {
            const s = getSession(chatId);
            s.searchText = searchText;
            s.mode = 'search';
            const text = `🔍 Запрос: *${escapeMd(truncate(searchText, 100))}*\n\nЧто искать?`;
            const opts = { parse_mode: 'Markdown', reply_markup: searchFieldKeyboard() };
            if (messageId)
                return safeEdit(bot, text, { chat_id: chatId, message_id: messageId, ...opts });
            return bot.sendMessage(chatId, text, opts);
        };

        const renderResults = async (chatId, messageId, query) => {
            const s = getSession(chatId);
            const limit = s.limit || PAGE_SIZE_DEFAULT;
            const offset = s.offset || 0;

            let res;
            try {
                res = await api.bookSearch(Object.assign({}, query, { limit, offset }));
            } catch (e) {
                if (e.message === 'DB_NOT_READY') {
                    return bot.sendMessage(chatId, '⏳ Индекс загружается, попробуйте через несколько секунд.');
                }
                api.log(LM_ERR, `[telegram-bot] bookSearch failed: ${e.message}`);
                return bot.sendMessage(chatId, `⚠️ Ошибка поиска: ${escapeMd(e.message)}`, { parse_mode: 'Markdown' });
            }

            s.mode = 'results';
            s.lastResults = { kind: 'bookSearch', totalFound: res.totalFound, found: res.found || [], query };

            const totalPages = Math.ceil(res.totalFound / limit) || 1;
            const page = Math.floor(offset / limit);
            const showPrev = page > 0;
            const showNext = offset + limit < res.totalFound;

            const lines = [`🔍 Найдено: *${res.totalFound}*`, ''];
            if (!res.found || !res.found.length)
                lines.push('Ничего не найдено.');
            else
                for (const b of res.found)
                    lines.push(`• ${escapeMd(bookLabel(b))}`);

            const text = lines.join('\n');
            const opts = { parse_mode: 'Markdown', reply_markup: resultsKeyboard(chatId, page, totalPages, showPrev, showNext) };
            if (messageId)
                return safeEdit(bot, text, { chat_id: chatId, message_id: messageId, ...opts });
            return bot.sendMessage(chatId, text, opts);
        };

        const renderBook = async (chatId, messageId, book) => {
            const uid = bookUid(book);
            let info = null;
            try {
                info = await api.getBookInfo(uid);
            } catch (e) {
                if (e.message.startsWith('404'))
                    return bot.sendMessage(chatId, '⚠️ Книга не найдена (возможно, удалена из библиотеки).');
                api.log(LM_WARN, `[telegram-bot] getBookInfo failed: ${e.message}`);
            }

            const bi = (info && info.bookInfo) || {};
            const bookInfo = bi.bookInfo || {};
            const lines = [];
            lines.push(`📖 *${escapeMd(book.title || '(без названия)')}*`);
            if (book.author) lines.push(`👤 ${escapeMd(book.author)}`);
            if (book.series) lines.push(`📚 ${escapeMd(book.series)}${book.serno ? ` #${book.serno}` : ''}`);
            if (book.genre) lines.push(`🏷️ ${escapeMd(book.genre)}`);
            if (book.date) lines.push(`📅 ${escapeMd(book.date)}`);
            if (book.ext) lines.push(`📄 ${escapeMd(book.ext)}`);
            if (bookInfo.annotation) lines.push('', escapeMd(truncate(bookInfo.annotation, 400)));

            const text = lines.join('\n');
            const opts = { parse_mode: 'Markdown', reply_markup: bookKeyboard(book) };
            if (messageId)
                return safeEdit(bot, text, { chat_id: chatId, message_id: messageId, ...opts });
            return bot.sendMessage(chatId, text, opts);
        };

        const renderReviews = async (chatId, messageId, book) => {
            const uid = bookUid(book);
            let rc;
            try {
                rc = await api.getBookReviewsCount(uid);
            } catch (e) {
                if (e.message === 'reviews_disabled')
                    return bot.sendMessage(chatId, '💬 Рецензии отключены на этом сервере.');
                api.log(LM_WARN, `[telegram-bot] getBookReviewsCount failed: ${e.message}`);
                return bot.sendMessage(chatId, '⚠️ Не удалось получить рецензии.');
            }

            const lines = [`💬 Рецензии: *${escapeMd(book.title || '')}*`, ''];
            lines.push(`Объявлено: ${rc.declaredCount}, сумма оценок: ${rc.sum}`);

            let reviewLink = '';
            try {
                const rl = await api.getReviewLink(uid);
                reviewLink = makeAbsoluteUrl(publicUrl, rl.link);
            } catch (e) {
                // .review нет — не критично
            }

            const rows = [];
            if (reviewLink)
                rows.push([{ text: '📄 Открыть рецензии', url: reviewLink }]);
            rows.push([{ text: '◀️ К книге', callback_data: `book:${uid}` }]);
            rows.push([{ text: '◀️ Меню', callback_data: 'menu:main' }]);

            const opts = { parse_mode: 'Markdown', reply_markup: { inline_keyboard: rows } };
            if (messageId)
                return safeEdit(bot, lines.join('\n'), { chat_id: chatId, message_id: messageId, ...opts });
            return bot.sendMessage(chatId, lines.join('\n'), opts);
        };

        const renderBio = async (chatId, messageId, book) => {
            const uid = bookUid(book);
            let authors;
            try {
                authors = await api.getBookAuthors(uid);
            } catch (e) {
                if (e.message === 'authors_disabled')
                    return bot.sendMessage(chatId, '👤 Биографии авторов отключены на этом сервере.');
                api.log(LM_WARN, `[telegram-bot] getBookAuthors failed: ${e.message}`);
                return bot.sendMessage(chatId, '⚠️ Не удалось получить авторов.');
            }

            if (!authors || !authors.length)
                return bot.sendMessage(chatId, '👤 Авторы не указаны.');

            const lines = [`👤 Авторы: *${escapeMd(book.title || '')}*`, ''];
            const rows = [];
            for (const a of authors) {
                lines.push(`• ${escapeMd(a.name)}${a.found ? '' : ' (нет биографии)'}`);
                if (a.found) {
                    try {
                        const bio = await api.getAuthorBio(a.hash);
                        if (bio) {
                            const plain = bio.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
                            lines.push(`  ${escapeMd(truncate(plain, 300))}`);
                        }
                    } catch (e) {
                        // authors_disabled / 404 — пропускаем
                    }
                    try {
                        const pl = await api.getPhotoLink(a.hash);
                        const url = makeAbsoluteUrl(publicUrl, pl.link);
                        if (url && !pl.link.endsWith('.nophoto'))
                            rows.push([{ text: `📷 Фото: ${truncate(a.name, 30)}`, url }]);
                    } catch (e) {
                        // нет фото — ок
                    }
                }
            }
            rows.push([{ text: '◀️ К книге', callback_data: `book:${uid}` }]);
            rows.push([{ text: '◀️ Меню', callback_data: 'menu:main' }]);

            const opts = { parse_mode: 'Markdown', reply_markup: { inline_keyboard: rows } };
            if (messageId)
                return safeEdit(bot, lines.join('\n'), { chat_id: chatId, message_id: messageId, ...opts });
            return bot.sendMessage(chatId, lines.join('\n'), opts);
        };

        // ---- обработчики: ВСЕ через api.guard ----
        bot.onText(/^\/start(?:\s+(.+))?$/, api.guard('onStart', async (msg, match) => {
            const chatId = msg.chat.id;
            const password = (match[1] || '').trim();
            const s = getSession(chatId);

            if (config.accessPassword) {
                if (!password)
                    return bot.sendMessage(chatId, '🔒 Отправьте /start <пароль>.');
                if (password !== config.accessPassword)
                    return bot.sendMessage(chatId, '❌ Неверный пароль.');
                s.authorized = true;
            } else if (allowedUsers.length) {
                const username = msg.from && msg.from.username;
                if (!isAuthorized(chatId, username))
                    return bot.sendMessage(chatId, '🔒 Доступ запрещён.');
                s.authorized = true;
            }

            return renderMenu(chatId);
        }));

        bot.onText(/^\/help$/, api.guard('onHelp', async (msg) => {
            const chatId = msg.chat.id;
            if (!ensureAuth(msg)) return;
            const text = [
                '❓ *Помощь*',
                '',
                'Просто напишите текст — бот предложит, что искать (название/автор/серия/жанр).',
                '',
                'Команды:',
                '/start — меню',
                '/search — поиск',
                '/help — эта справка',
            ].join('\n');
            return bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
        }));

        bot.onText(/^\/search$/, api.guard('onSearchCmd', async (msg) => {
            if (!ensureAuth(msg)) return;
            return bot.sendMessage(msg.chat.id, 'Напишите текст запроса — бот предложит, что искать.');
        }));

        bot.on('message', api.guard('onMessage', async (msg) => {
            if (!msg.text) return;
            if (msg.text.startsWith('/')) return;
            if (!ensureAuth(msg)) return;
            const text = msg.text.trim();
            if (!text) return;
            return renderSearchFields(msg.chat.id, null, text);
        }));

        bot.on('callback_query', api.guard('onCallback', async (query) => {
            const chatId = query.message.chat.id;
            const messageId = query.message.message_id;
            const username = query.from && query.from.username;

            if (!isAuthorized(chatId, username)) {
                await bot.answerCallbackQuery(query.id, { text: '🔒 Требуется авторизация', show_alert: true }).catch(() => {});
                return;
            }
            await bot.answerCallbackQuery(query.id).catch(() => {});

            const data = query.data || '';
            const s = getSession(chatId);

            if (data.startsWith('menu:')) {
                const what = data.slice(5);
                if (what === 'main') return renderMenu(chatId, messageId);
                if (what === 'search') {
                    return safeEdit(bot, 'Напишите текст запроса — бот предложит, что искать.', {
                        chat_id: chatId, message_id: messageId,
                        reply_markup: { inline_keyboard: [[{ text: '◀️ Меню', callback_data: 'menu:main' }]] },
                    });
                }
                if (what === 'help') {
                    return safeEdit(bot, 'Просто напишите текст — бот предложит, что искать.\n\n/start — меню\n/help — справка', {
                        chat_id: chatId, message_id: messageId,
                        reply_markup: { inline_keyboard: [[{ text: '◀️ Меню', callback_data: 'menu:main' }]] },
                    });
                }
                if (what === 'author' || what === 'series' || what === 'genre') {
                    const hint = what === 'author' ? 'имя автора' : what === 'series' ? 'название серии' : 'код жанра';
                    return safeEdit(bot, `Напишите ${hint} текстом — бот найдёт.`, {
                        chat_id: chatId, message_id: messageId,
                        reply_markup: { inline_keyboard: [[{ text: '◀️ Меню', callback_data: 'menu:main' }]] },
                    });
                }
                return;
            }

            if (data.startsWith('search:')) {
                const field = data.slice(7);
                if (!s.searchText) {
                    return safeEdit(bot, 'Сначала напишите текст запроса.', {
                        chat_id: chatId, message_id: messageId,
                        reply_markup: { inline_keyboard: [[{ text: '◀️ Меню', callback_data: 'menu:main' }]] },
                    });
                }
                s.field = field;
                s.offset = 0;
                return renderResults(chatId, messageId, { [field]: s.searchText });
            }

            if (data.startsWith('page:')) {
                const page = parseInt(data.slice(5), 10);
                if (isNaN(page) || page < 0) return;
                s.offset = page * (s.limit || PAGE_SIZE_DEFAULT);
                if (!s.lastResults) return renderMenu(chatId, messageId);
                return renderResults(chatId, messageId, s.lastResults.query);
            }

            if (data.startsWith('book:')) {
                const uid = data.slice(5);
                let book = null;
                if (s.lastResults && s.lastResults.found)
                    book = s.lastResults.found.find(b => bookUid(b) === uid);
                if (!book)
                    book = { _uid: uid, title: '', author: '', series: '' };
                return renderBook(chatId, messageId, book);
            }

            if (data.startsWith('dl:')) {
                const uid = data.slice(3);
                try {
                    const link = await api.getBookLink(uid);
                    const url = makeAbsoluteUrl(publicUrl, link.link);
                    if (url) {
                        return bot.sendMessage(chatId, `⬇️ ${escapeMd(link.downFileName || 'скачать')}: ${url}`, {
                            parse_mode: 'Markdown',
                            disable_web_page_preview: false,
                        });
                    }
                    return bot.sendMessage(chatId, `⬇️ Ссылка: ${escapeMd(link.link)}`);
                } catch (e) {
                    api.log(LM_WARN, `[telegram-bot] getBookLink failed: ${e.message}`);
                    return bot.sendMessage(chatId, `⚠️ Не удалось получить ссылку: ${escapeMd(e.message)}`, { parse_mode: 'Markdown' });
                }
            }

            if (data.startsWith('reviews:')) {
                const uid = data.slice(8);
                let book = null;
                if (s.lastResults && s.lastResults.found)
                    book = s.lastResults.found.find(b => bookUid(b) === uid);
                if (!book) book = { _uid: uid, title: '' };
                return renderReviews(chatId, messageId, book);
            }

            if (data.startsWith('bio:')) {
                const uid = data.slice(4);
                let book = null;
                if (s.lastResults && s.lastResults.found)
                    book = s.lastResults.found.find(b => bookUid(b) === uid);
                if (!book) book = { _uid: uid, title: '' };
                return renderBio(chatId, messageId, book);
            }

            if (data.startsWith('byname:')) {
                const rest = data.slice(7);
                const idx = rest.indexOf(':');
                if (idx < 0) return;
                const field = rest.slice(0, idx);
                const name = rest.slice(idx + 1);
                s.offset = 0;
                return renderResults(chatId, messageId, { [field]: name });
            }

            if (data === 'back:search') {
                if (!s.lastResults) return renderMenu(chatId, messageId);
                return renderResults(chatId, messageId, s.lastResults.query);
            }

            if (data === 'noop') return;
        }));

        bot.on('polling_error', (err) => {
            api.log(LM_ERR, `[telegram-bot] polling_error: ${err.message}`);
        });

        module.exports._bot = bot;
        api.log('[telegram-bot] started');
    },

    async stop() {
        if (module.exports._bot) {
            try { await module.exports._bot.stopPolling(); } catch (e) {}
            module.exports._bot = null;
        }
        console.log('[telegram-bot] stopped');
    },
};