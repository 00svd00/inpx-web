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
// api.getBookInfo → {bookInfo: {book, cover, bookInfo: {titleInfo}, ...}}
    // .i.json → {book, cover, bookInfo: {titleInfo}, ...}
    // берём deepest.bookInfo (если есть), иначе info.bookInfo
    const outer = (info && info.bookInfo) || {};
    const inner = outer.bookInfo || outer;
    const ti = inner.titleInfo || {};
    const annotation = ti.annotationHtml || ti.annotationXml || '';

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
    const librate = parseInt(book.librate, 10) || 0;
    if (librate > 0) lines.push(`⭐ Оценка: ${librate}/5`);
    if (book.date) lines.push(`📅 ${escapeHtml(book.date)}`);
    if (book.ext) lines.push(`📄 ${escapeHtml(book.ext)}`);
    if (annotation) {
        const plain = annotation.replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '').trim();
        if (plain) lines.push('', escapeHtml(truncate(plain, 800)));
    }
    return lines.join('\n');
}

function formatHelp() {
    return [
        '❓ <b>Памятка по поиску</b>',
        '',
        'Просто напишите текст — бот предложит, что искать (автор / серия / книга).',
        '',
        '<b>Префиксы</b> (в любом поле):',
        '<code>=</code> — точное совпадение. <code>=Пушкин Александр Сергеевич</code>',
        '<code>%</code> — все слова одновременно. <code>%Александр Пушкин</code>',
        '<code>*</code> — подстрока с пробелами. <code>*Александр Сергеевич</code>',
        '<code>#</code> — не с буквы (рус./лат.) + подстрока. <code>#поворот</code>',
        '<code>~</code> — регулярное выражение. <code>~^\\s</code> (начинается с пробела)',
        '<code>?</code> — пустое или начинается с «?». <code>?</code> в «Серия» — книги без серии',
    ].join('\n');
}


module.exports = {
    escapeHtml, truncate, bookLabel,
    formatAuthorsList, formatSeriesList, formatBooksList, formatBookCard,
    formatHelp,
};