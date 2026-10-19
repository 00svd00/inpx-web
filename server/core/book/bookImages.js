const fs = require('fs-extra');
const { execFileSync } = require('node:child_process');
const ZipReader = require('../ZipReader');
const SevenZipHelper = require('../SevenZipHelper');
const { resolveDjxl } = require('../DjxlResolver');

const JXL_JPEG_QUALITY = 70;

// --- магические байты изображений (общее для fb2/epub: в архивах может быть солянка) ---

function isJxlBuffer(buffer) {
    return buffer.length > 2 && buffer[0] === 0xFF && buffer[1] === 0x0A;
}

function isPngBuffer(buffer) {
    return buffer.length > 2 && buffer[0] === 0x89 && buffer[1] === 0x50;
}

function isJpgBuffer(buffer) {
    return buffer.length > 2 && buffer[0] === 0xFF && buffer[1] === 0xD8;
}

// JXL -> JPEG (djxl); PNG/JPEG — как есть.
// Возвращает { outputImg, ext }.
async function jxlConvert(imageBuff, pathTmp, namefile) {
    let ext = 'png';
    let outputImg = `${pathTmp}/${namefile}.${ext}`;

    if (isJxlBuffer(imageBuff)) {
        const djxlPath = resolveDjxl();
        if (!djxlPath)
            throw new Error('djxl not found neither next to executable nor in PATH');
        ext = 'jpeg';
        outputImg = `${pathTmp}/${namefile}.jpg`;

        execFileSync(djxlPath, [
            '--quiet',
            '--bits_per_sample=8',
            `--jpeg_quality=${JXL_JPEG_QUALITY}`,
            '--background=white',
            '--alpha_blend',
            '--use_sjpeg',
            '-',
            outputImg,
        ], {
            input: imageBuff,
            maxBuffer: 50 * 1024 * 1024,
            stdio: ['pipe', 'pipe', 'pipe'],
        });
    } else {
        if (isJpgBuffer(imageBuff)) {
            ext = 'jpeg';
            outputImg = `${pathTmp}/${namefile}.jpg`;
        }
        fs.writeFileSync(outputImg, imageBuff, {flag: 'w'});
    }

    return {outputImg, ext};
}

// --- чтение архивов: ZipReader (zip, быстро) → fallback SevenZipHelper (7z/иное) на Bad archive ---

async function readArchiveEntry(archivePath, entryName) {
    const zipReader = new ZipReader();
    try {
        await zipReader.open(archivePath);
        if (entryName in zipReader.zipEntries)
            return await zipReader.extractToBuf(entryName);
        return null;
    } catch (e) {
        if (/Bad archive/i.test(e.message || '')) {
            const h = new SevenZipHelper();
            try { return await h.extract(archivePath, entryName); }
            catch (e2) { return null; }
        }
        throw e;
    } finally {
        try { await zipReader.close(); } catch (e) {}
    }
}

async function listArchiveEntries(archivePath) {
    const zipReader = new ZipReader();
    try {
        await zipReader.open(archivePath);
        return Object.keys(zipReader.zipEntries);
    } catch (e) {
        if (/Bad archive/i.test(e.message || '')) {
            const h = new SevenZipHelper();
            try { return await h.list(archivePath); }
            catch (e2) { return []; }
        }
        throw e;
    } finally {
        try { await zipReader.close(); } catch (e) {}
    }
}

module.exports = {
    isJxlBuffer, isPngBuffer, isJpgBuffer,
    jxlConvert,
    readArchiveEntry, listArchiveEntries,
    JXL_JPEG_QUALITY,
};