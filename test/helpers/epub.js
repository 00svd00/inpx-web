const path = require('path');
const { makeZip } = require('./zip');
const { make7z } = require('./sevenZip');

// container.xml (OCF)
function containerXml(fullPath) {
    return `<?xml version="1.0" encoding="utf-8"?><container><rootfiles><rootfile full-path="${fullPath}" media-type="application/oebps-package+xml"/></rootfiles></container>`;
}

// 7z-внутренний (формат 2): <bookId>/mimetype, <bookId>/META-INF/container.xml, <bookId>/..., FLibraryImageIndex.json
// opts: {bookId, fullPath, files, manifest, withMimetype, withContainer}
function makeEpub7z(dir, name, opts = {}) {
    const bookId = opts.bookId || '673407';
    const prefix = `${bookId}/`;
    const fullPath = opts.fullPath || 'content.opf';
    const manifest = opts.manifest !== undefined
        ? opts.manifest
        : [{id: 'cover.jpg', num: -1}, {id: 'index-1_1.jpg', num: 1}];

    const files = {};
    files[`${prefix}mimetype`] = Buffer.from('application/epub+zip');
    files[`${prefix}META-INF/container.xml`] = Buffer.from(containerXml(fullPath));
    files[`${prefix}${fullPath}`] = Buffer.from('<?xml version="1.0"?><package/>');
    for (const [rel, buf] of Object.entries(opts.files || {}))
        files[`${prefix}${rel}`] = buf;
    if (manifest !== null)
        files['FLibraryImageIndex.json'] = Buffer.from(JSON.stringify(manifest));

    return make7z(dir, name, files);
}

// zip-внутренний (формат 1): валидный epub (mimetype, META-INF/container.xml, content.opf, ...)
async function makeEpubZip(zipFile, opts = {}) {
    const fullPath = opts.fullPath || 'content.opf';
    const files = {
        'mimetype': Buffer.from('application/epub+zip'),
        'META-INF/container.xml': Buffer.from(containerXml(fullPath)),
        [fullPath]: Buffer.from('<?xml version="1.0"?><package/>'),
    };
    for (const [rel, buf] of Object.entries(opts.files || {}))
        files[rel] = buf;
    return makeZip(zipFile, files);
}

module.exports = { containerXml, makeEpub7z, makeEpubZip };