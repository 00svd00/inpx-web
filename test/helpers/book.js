const path = require('path');
const { makeZip } = require('./zip');

const FB2 = '<?xml version="1.0" encoding="utf-8"?>\n<FictionBook><description><title-info><book-title>T</book-title></title-info></description><body><section><p>x</p></section></body></FictionBook>';

function makeFb2() {
    return FB2;
}

// makeLib(libDir, {libFolder, bookId, covers, images})
//   covers — Map|object: {entryName: Buffer} (обычно {'<bookId>': jxl})
//   images — Map|object: {entryName: Buffer} (fb2: '<bookId>_img1.jxl'; epub: '<bookId>/1')
async function makeLib(libDir, opts = {}) {
    const libFolder = opts.libFolder || 'lib0.zip';
    const { covers, images } = opts;
    if (covers)
        await makeZip(path.join(libDir, 'covers', libFolder), covers);
    if (images)
        await makeZip(path.join(libDir, 'images', libFolder), images);
}

module.exports = { FB2, makeFb2, makeLib };