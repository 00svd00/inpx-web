const fs = require('fs-extra');
const path = require('path');
const yazl = require('yazl');
const ZipReader = require('../../server/core/ZipReader');

function makeZip(zipFile, files) {
    return new Promise(async (resolve, reject) => {
        try { await fs.ensureDir(path.dirname(zipFile)); }
        catch (e) { return reject(e); }
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

async function readZip(zipPath) {
    const zr = new ZipReader();
    await zr.open(zipPath);
    const entries = Object.keys(zr.zipEntries);
    const data = {};
    for (const name of entries) {
        const entry = zr.zipEntries[name];
        if (entry && entry.isDirectory) continue;   // пропускаем директории
        data[name] = await zr.extractToBuf(name);
    }
    await zr.close();
    return {entries, data};
}

module.exports = { makeZip, readZip };