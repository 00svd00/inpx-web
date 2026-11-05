const path = require('path');
const fs = require('fs-extra');
const {
    readArchiveEntry, listArchiveEntries,
    isJpgBuffer, isPngBuffer,
    jxlConvert,
} = require('../book/bookImages');

// Достаёт обложку из epub-zip, материализованного в кеш (<bookDir>/<hash>).
// <hash> для epub — zip как есть (restoreBook не гзипит epub).
// gzip/мусор (старый битый кеш) — не парсим, возвращаем null.
// ext — '.jpg' | '.png' по сигнатуре.
//
// Механизмы OPF (по убыванию надёжности):
//   1. EPUB 3: <item properties="cover-image">
//   2. EPUB 2 (де-факто): <meta name="cover" content="<id>"> → <item id="<id>">
//   3. соглашение: <item id="cover">
async function extractEpubCover(bookFilePath) {
    const head = await readHead(bookFilePath, 2);
    if (!head || head.length < 2)
        return null;
    // zip: 'PK'
    if (head[0] !== 0x50 || head[1] !== 0x4b)
        return null;

    return await extractFromArchive(bookFilePath);
}

async function readHead(filePath, n) {
    let fh = null;
    try {
        fh = await fs.promises.open(filePath, 'r');
        const buf = Buffer.alloc(n);
        const { bytesRead } = await fh.read(buf, 0, n, 0);
        return buf.subarray(0, bytesRead);
    } catch (e) {
        return null;
    } finally {
        if (fh)
            try { await fh.close(); } catch (e) {}
    }
}

async function extractFromArchive(archivePath) {
    const entries = await listArchiveEntries(archivePath);
    if (!entries || !entries.length)
        return null;

    const normalized = new Map();
    for (const e of entries)
        normalized.set(e.replace(/^\.?\//, '').toLowerCase(), e);

    const findEntry = (name) => {
        const key = String(name || '').replace(/^\.?\//, '').toLowerCase();
        return key ? normalized.get(key) : undefined;
    };

    // 1. container.xml → full-path
    let opfPath = 'content.opf';
    const containerEntry = findEntry('META-INF/container.xml');
    if (containerEntry) {
        const buf = await readArchiveEntry(archivePath, containerEntry);
        if (buf) {
            const m = buf.toString('utf8').match(/full-path\s*=\s*"([^"]+)"/i);
            if (m) opfPath = m[1];
        }
    }
    opfPath = opfPath.replace(/^\.?\//, '');
    const opfDir = path.posix.dirname(opfPath);
    const opfPrefix = opfDir === '.' ? '' : `${opfDir}/`;

    // 2. OPF → href (properties → meta name="cover" → id="cover")
    let buffer = null;
    const opfEntry = findEntry(opfPath);
    if (opfEntry) {
        const opf = await readArchiveEntry(archivePath, opfEntry);
        if (opf) {
            const href = findCoverHref(opf.toString('utf8'));
            if (href) {
                const entry = findEntry(resolveHref(opfPrefix, href));
                if (entry)
                    buffer = await readArchiveEntry(archivePath, entry);
            }
        }
    }

    // 3. fallback: cover.jpg/jpeg/png в листинге (case-insensitive), по алфавиту
    if (!buffer) {
        const entry = findCoverEntryByName(entries);
        if (entry)
            buffer = await readArchiveEntry(archivePath, entry);
    }

    if (!buffer || !buffer.length)
        return null;

    let ext = null;
    if (isJpgBuffer(buffer)) ext = '.jpg';
    else if (isPngBuffer(buffer)) ext = '.png';
    if (!ext)
        return null;

    return { buffer, ext };
}

function findCoverEntryByName(entries) {
    const cands = entries
        .filter(e => /(^|\/)cover\.(jpe?g|png)$/i.test(e))
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return cands.length ? cands[0] : null;
}

function findCoverHref(opfText) {
    const items = [];
    const itemRe = /<item\b[^>]*>/gi;
    let m;
    while ((m = itemRe.exec(opfText)) !== null)
        items.push(parseAttrs(m[0]));

    for (const it of items) {
        if (it.href && it.properties && /\bcover-image\b/i.test(it.properties))
            return it.href;
    }

    const metaRe = /<meta\b[^>]*>/gi;
    while ((m = metaRe.exec(opfText)) !== null) {
        const attrs = parseAttrs(m[0]);
        if (attrs.name && attrs.name.toLowerCase() === 'cover' && attrs.content) {
            const it = items.find(x => x.id === attrs.content && x.href);
            if (it)
                return it.href;
        }
    }

    for (const it of items) {
        if (it.href && it.id && it.id.toLowerCase() === 'cover')
            return it.href;
    }

    return null;
}

function parseAttrs(tag) {
    const attrs = {};
    const re = /([\w:-]+)\s*=\s*"([^"]*)"/g;
    let m;
    while ((m = re.exec(tag)) !== null)
        attrs[m[1].toLowerCase()] = m[2];
    return attrs;
}

function resolveHref(prefix, href) {
    const clean = href.replace(/^\.?\//, '').split('#')[0].split('?')[0];
    if (!clean)
        return '';
    return path.posix.normalize(prefix + clean).replace(/^\.?\//, '');
}

// Достаёт данные EPUB: bookInfo (через EpubHelper) и обложку.
// Обложка: сначала встроенная (из epub), если нет — covers/<libFolder>.
// Возвращает {bookInfo, cover, coverExt}.
// При любой ошибке — {bookInfo: null, cover: null, coverExt: ''}.
async function extractEpubData(bookFile, config, libFolder, bookId, epubHelper) {
    let bookInfo = null;
    let cover = null;
    let coverExt = '';

    // 1. bookInfo из OPF
    try {
        bookInfo = await epubHelper.getBookInfo(bookFile);
    } catch (e) {
        console.error(`[epubCover] getBookInfo error: ${e.message}`);
    }

    // 2. встроенная обложка
    try {
        const c = await extractEpubCover(bookFile);
        if (c) {
            cover = c.buffer;
            coverExt = c.ext;
        }
    } catch (e) {
        console.error(`[epubCover] extractEpubCover error: ${e.message}`);
    }

    if (cover) {
        return { bookInfo, cover, coverExt };
    }

    // 3. fallback: covers/<libFolder>
    try {
        const pathCover = path.join(config.libDir, 'covers', libFolder);
        if (await fs.pathExists(pathCover)) {
            const imageBuffer = await readArchiveEntry(pathCover, bookId);
            if (imageBuffer) {
                const { outputImg, ext } = await jxlConvert(imageBuffer);
                return {
                    bookInfo,
                    cover: outputImg,
                    coverExt: ext === 'jpeg' ? '.jpg' : '.png',
                };
            }
        }
    } catch (e) {
        console.error(`[epubCover] covers fallback error: ${e.message}`);
    }

    return { bookInfo, cover: null, coverExt: '' };
}

module.exports = { extractEpubCover, extractEpubData };