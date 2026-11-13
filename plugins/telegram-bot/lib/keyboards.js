function menuKeyboard() {
    return {
        inline_keyboard: [
            [{ text: '🔍 Поиск', callback_data: 'menu:search' }],
            [{ text: '👤 Авторы', callback_data: 'menu:author' }, { text: '📚 Серии', callback_data: 'menu:series' }],
            [{ text: '❓ Помощь', callback_data: 'menu:help' }],
        ],
    };
}

function searchFieldKeyboard() {
    return {
        inline_keyboard: [
            [{ text: '👤 Автор', callback_data: 'search:author' }],
            [{ text: '📚 Серия', callback_data: 'search:series' }],
            [{ text: '📖 Книга', callback_data: 'search:title' }],
            [{ text: '◀️ Меню', callback_data: 'menu:main' }],
        ],
    };
}

function authorsKeyboard(found, page, totalPages, showPrev, showNext) {
    const rows = [];
    for (const a of found) {
        if (!a.id || !a.bookCount) continue;
        rows.push([{ text: `👤 ${a.author || a.name} (${a.bookCount})`, callback_data: `author:${a.id}` }]);
    }
    rows.push(navRow(page, totalPages, showPrev, showNext));
    rows.push([{ text: '◀️ Меню', callback_data: 'menu:main' }]);
    return { inline_keyboard: rows };
}

function seriesKeyboard(found, authorId, page, totalPages, showPrev, showNext) {
    const rows = [];
    if (authorId)
        rows.push([{ text: '📚 Без серии', callback_data: `noseries:${authorId}` }]);
    for (const s of found) {
        if (!s.id || !s.bookCount) continue;
        rows.push([{ text: `📚 ${s.series || s.name} (${s.bookCount})`, callback_data: `series:${s.id}` }]);
    }
    rows.push(navRow(page, totalPages, showPrev, showNext));
    rows.push([{ text: '◀️ Меню', callback_data: 'menu:main' }]);
    return { inline_keyboard: rows };
}

function booksKeyboard(found, page, totalPages, showPrev, showNext, backCallback) {
    const { bookLabel } = require('./formatters');
    const rows = [];
    for (const b of found) {
        if (!b._uid) continue;
        rows.push([{ text: `📖 ${bookLabel(b)}`, callback_data: `book:${b._uid}` }]);
    }
    rows.push(navRow(page, totalPages, showPrev, showNext));
    rows.push([{ text: '◀️ Назад', callback_data: backCallback || 'menu:main' }]);
    return { inline_keyboard: rows };
}

function bookKeyboard(uid) {
    return {
        inline_keyboard: [
            [{ text: '⬇️ Скачать', callback_data: `dl:${uid}` }],
            [{ text: '◀️ Назад', callback_data: 'back:search' }],
        ],
    };
}

function navRow(page, totalPages, showPrev, showNext) {
    const nav = [];
    if (showPrev) nav.push({ text: '◀️', callback_data: `page:${page - 1}` });
    nav.push({ text: `${page + 1}/${Math.max(1, totalPages)}`, callback_data: 'noop' });
    if (showNext) nav.push({ text: '▶️', callback_data: `page:${page + 1}` });
    return nav;
}

module.exports = {
    menuKeyboard, searchFieldKeyboard,
    authorsKeyboard, seriesKeyboard, booksKeyboard, bookKeyboard,
};