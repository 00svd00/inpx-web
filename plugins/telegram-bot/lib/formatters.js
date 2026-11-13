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

function formatBookCard(book, info, genreMap) {
    const bi = (info && info.bookInfo) || {};
    const bookInfo = bi.bookInfo || {};
    const lines = [];
    lines.push(`📖 <b>${escapeHtml(book.title || '(без названия)')}</b>`);
    if (book.author) lines.push(`👤 ${escapeHtml(book.author)}`);
    if (book.series) lines.push(`📚 ${escapeHtml(book.series)}${book.serno ? ` #${book.serno}` : ''}`);
    if (book.genre) {
        const names = String(book.genre).split(',').map(c => {
            const code = c.trim();
            return (genreMap && genreMap.get(code)) || code;
        }).filter(Boolean);
        if (names.length) lines.push(`🏷️ ${escapeHtml(names.join(', '))}`);
    }
    // librate — оценка из INPX (0..5; 0 = нет оценки)
    const librate = parseInt(book.librate, 10) || 0;
    if (librate > 0)
        lines.push(`⭐ Оценка: ${librate}/5`);
    if (book.date) lines.push(`📅 ${escapeHtml(book.date)}`);
    if (book.ext) lines.push(`📄 ${escapeHtml(book.ext)}`);
    if (bookInfo.annotation) lines.push('', escapeHtml(truncate(bookInfo.annotation, 800)));
    return lines.join('\n');
}


module.exports = {
    escapeHtml, truncate, bookLabel,
    formatAuthorsList, formatSeriesList, formatBooksList, formatBookCard,
};