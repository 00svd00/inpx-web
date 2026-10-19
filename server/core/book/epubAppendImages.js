const fs = require('fs-extra');
const path = require('path');
const yazl = require('yazl');
const SevenZipHelper = require('../SevenZipHelper');
const { jxlConvert, readArchiveEntry } = require('./bookImages');

function is7zBuffer(buf) {
    return buf.length >= 6 && buf[0] === 0x37 && buf[1] === 0x7A && buf[2] === 0xBC
        && buf[3] === 0xAF && buf[4] === 0x27 && buf[5] === 0x1C;
}

function isZipBuffer(buf) {
    return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4B
        && buf[2] === 0x03 && buf[3] === 0x04;
}

// 7z-внутренний (формат 2): папка <bookId>/ + FLibraryImageIndex.json.
// Выпрямить <bookId>/ в корень, вернуть картинки (covers/images), собрать zip (yazl).
async function repack7zToZip(config, libFolder, fileName, sevenZipPath, outZip) {
    const bookId = fileName.replace(/\.(epub|zip)$/i, '');
    const prefix = `${bookId}/`;
    const tempDir = path.join(config.tempDir, `epub_${bookId}_${Date.now()}`);
    await fs.ensureDir(tempDir);

    const h = new SevenZipHelper();
    let entries = [];
    try {
        entries = await h.list(sevenZipPath);
    } catch (e) {
        await fs.remove(tempDir);
        return false;
    }

    const hasMimetype = entries.includes(`${prefix}mimetype`);
    const hasContainer = entries.includes(`${prefix}META-INF/container.xml`);

    if (!hasMimetype || !hasContainer) {
        await fs.remove(tempDir);
        return false;
    }

    await h.extractAll(sevenZipPath, tempDir);

    const containerPath = path.join(tempDir, prefix, 'META-INF', 'container.xml');
    let containerBuf = null;
    try { containerBuf = await fs.readFile(containerPath); } catch (e) {}
    if (!containerBuf) {
        await fs.remove(tempDir);
        return false;
    }

    const m = containerBuf.toString('utf8').match(/<rootfile[^>]*full-path="([^"]+)"/i);
    if (!m) {
        await fs.remove(tempDir);
        return false;
    }
    const fullPath = m[1];

    // манифест (в корне tempDir, рядом с <bookId>/)
    const manifestPath = path.join(tempDir, 'FLibraryImageIndex.json');
    let items = [];
    if (await fs.pathExists(manifestPath)) {
        try { items = JSON.parse(await fs.readFile(manifestPath, 'utf8')); } catch (e) { items = []; }
    }

    const toWrite = new Map();
    for (const {id, num} of items) {
        const archive = (num === -1 ? 'covers' : 'images');
        const srcZip = path.join(config.libDir, archive, libFolder);
        const entry = (num === -1 ? bookId : `${bookId}/${num}`);
        const imageBuf = await readArchiveEntry(srcZip, entry);
        if (!imageBuf) {
            console.log(`❌ ${archive}/${libFolder}: entry "${entry}" not found`);
            continue;
        }
        const safeId = id.replace(/\.[^.]+$/, '').replace(/[\\/]/g, '_');
        const namefile = `${bookId}_${num}_${safeId}`;
        const {outputImg} = await jxlConvert(imageBuf, tempDir, namefile);
        toWrite.set(id, await fs.readFile(outputImg));   // id от корня epub
        await fs.remove(outputImg);
    }

    // пересборка: mimetype первым (stored), entries из <bookId>/ (без префикса, кроме mimetype), картинки; без FLibraryImageIndex.json
    const srcRoot = path.join(tempDir, prefix);
    const all = await walkFiles(srcRoot);

    await new Promise((resolve, reject) => {
        const zip = new yazl.ZipFile();
        zip.addBuffer(Buffer.from('application/epub+zip'), 'mimetype', {compress: false});
        for (const rel of all) {
            if (rel === 'mimetype') continue;
            zip.addFile(path.join(srcRoot, rel), rel, {compress: true});
        }
        for (const [rel, buf] of toWrite)
            zip.addBuffer(buf, rel, {compress: false});
        zip.outputStream.pipe(fs.createWriteStream(outZip))
            .on('error', reject)
            .on('finish', () => resolve());
        zip.end();
    });

    await fs.remove(tempDir);
    return true;
}

async function walkFiles(dir, base = dir, out = []) {
    const list = await fs.readdir(dir, {withFileTypes: true});
    for (const e of list) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) await walkFiles(p, base, out);
        else out.push(path.relative(base, p).split(path.sep).join('/'));
    }
    return out;
}

async function epubAppendImages(config, libFolder, fileName, extractedPath, outZip) {
    const raw = await fs.readFile(extractedPath);

    if (is7zBuffer(raw)) {
        // формат 2: перепакованный 7z → выпрямить/картинки/zip
        const ok = await repack7zToZip(config, libFolder, fileName, extractedPath, outZip);
        if (!ok)
            await fs.copy(extractedPath, outZip, {overwrite: true});
        return;
    }

    if (isZipBuffer(raw)) {
        // формат 1: валидный epub (zip) — как есть
        await fs.copy(extractedPath, outZip, {overwrite: true});
        return;
    }

    // иное — как есть
    await fs.copy(extractedPath, outZip, {overwrite: true});
}

module.exports = epubAppendImages;