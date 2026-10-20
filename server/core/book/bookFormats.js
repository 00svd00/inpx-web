// Единое знание «ext книги → MIME / acquisition-форматы».
// Используется static.js (отдача файла) и opds/BookPage.js (formats для OPDS).

// MIME для простого файла по ext (без +zip).
const BASE_MIME = {
    mobi: 'application/x-mobipocket-ebook',
    epub: 'application/epub+zip',
};

function baseMime(ext) {
    return BASE_MIME[ext] || `application/${ext}`;
}

// static.js: имя скачивания → Content-Type.
// Учитывает .zip-обёртку (bookname.ext.zip) и mobi/epub.
function bookContentType(downFileName) {
    const path = require('path');
    const isZip = (path.extname(downFileName).toLowerCase() === '.zip');
    const name = (isZip ? path.basename(downFileName, path.extname(downFileName)) : downFileName);
    const ext = path.extname(name).substring(1).toLowerCase();

    if (!ext)
        return (isZip ? 'application/zip' : '');

    if (ext === 'epub')
        return 'application/epub+zip';   // и для .epub, и для .epub.zip

    if (ext === 'mobi')
        return 'application/x-mobipocket-ebook';

    return `application/${ext}${isZip ? '+zip' : ''}`;
}

// OPDS: ext + ссылка на простой файл → { <mime-subtype>: href }.
// Ключ становится `application/${key}` в OPDS-ссылке.
// epub: только простой epub (application/epub+zip), zip-в-zip не объявляем.
// mobi: +zip, mobi, алиас x-mobipocket-ebook.
// остальные: <ext>+zip → /zip, <ext> → link.
function bookFormats(ext, link) {
    if (ext === 'epub')
        return { 'epub+zip': link };

    const formats = {
        [`${ext}+zip`]: `${link}/zip`,
        [ext]: link,
    };
    if (ext === 'mobi')
        formats['x-mobipocket-ebook'] = link;
    return formats;
}

module.exports = { bookContentType, bookFormats, baseMime };