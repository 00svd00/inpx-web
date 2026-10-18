const fs = require('fs-extra');
const path = require('path');
const yazl = require('yazl');

// files: Map<string, Buffer|string> | object
function makeZip(zipFile, files) {
    return new Promise((resolve, reject) => {
        const zip = new yazl.ZipFile();
        const entries = (files instanceof Map) ? files : new Map(Object.entries(files));
        for (const [name, data] of entries)
            zip.addBuffer(Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8'), name);

        zip.outputStream
            .pipe(fs.createWriteStream(zipFile))
            .on('error', reject)
            .on('finish', () => resolve(zipFile));
        zip.end();
    });
}

module.exports = { makeZip };