function escapeHtml(s) {
    return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
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

function isTelegramBenign(e) {
    const desc = (e && e.response && e.response.body && e.response.body.description)
        ? String(e.response.body.description)
        : '';
    return /message is not modified/i.test(desc)
        || /message is too long/i.test(desc)
        || /query is too old/i.test(desc)
        || /BUTTON_DATA_INVALID/i.test(desc);
}

async function safeEdit(bot, text, opts) {
    try {
        return await bot.editMessageText(text, opts);
    } catch (e) {
        if (isTelegramBenign(e))
            return null;
        throw e;
    }
}

function formatAuthorsList(found, totalFound) {
    const lines = [`👤 Найдено авторов: <b>${totalFound}</b>`, ''];
    lines.push(found.length ? 'Выберите автора:' : 'Ничего не найдено.');
    return lines.join('\n');
}

function formatSeriesList(found, totalFound) {
    const lines = [`📚 Найдено серий: <b>${totalFound}</b>`, ''];
    lines.push(found.length ? 'Выберите серию:' : 'Ничего не найдено.');
    return lines.join('\n');
}

function formatBooksList(found, totalFound) {
    const lines = [`📖 Найдено книг: <b>${totalFound}</b>`, ''];
    lines.push(found.length ? 'Выберите книгу:' : 'Ничего не найдено.');
    return lines.join('\n');
}

function formatBookCard(book, info) {
    const bi = (info && info.bookInfo) || {};
    const bookInfo = bi.bookInfo || {};
    const lines = [];
    lines.push(`📖 <b>${escapeHtml(book.title || '(без названия)')}</b>`);
    if (book.author) lines.push(`👤 ${escapeHtml(book.author)}`);
    if (book.series) lines.push(`📚 ${escapeHtml(book.series)}${book.serno ? ` #${book.serno}` : ''}`);
    if (book.genre) lines.push(`🏷️ ${escapeHtml(book.genre)}`);
    if (book.date) lines.push(`📅 ${escapeHtml(book.date)}`);
    if (book.ext) lines.push(`📄 ${escapeHtml(book.ext)}`);
    if (bookInfo.annotation) lines.push('', escapeHtml(truncate(bookInfo.annotation, 800)));
    return lines.join('\n');
}

module.exports = {
    escapeHtml, truncate, bookLabel,
    isTelegramBenign, safeEdit,
    formatAuthorsList, formatSeriesList, formatBooksList, formatBookCard,
};