const path = require('path');
const fs = require('fs-extra');
const { readArchiveEntry, jxlConvert } = require('../book/bookImages');

// Достаёт данные FB2: bookInfo (через Fb2Helper) и обложку.
// Обложка: сначала встроенная (в FB2), если нет — covers/<libFolder>.
// Возвращает {fb2, cover, coverExt}. fb2 — парсер (для bookInfo + dev-режима).
// При любой ошибке — {fb2: null, cover: null, coverExt: ''}.
async function extractFb2Data(bookFile, config, libFolder, bookId, fb2Helper) {
    let fb2 = null;
    let cover = null;
    let coverExt = '';

    // 1. встроенная обложка + парсер FB2
    try {
        const parsed = await fb2Helper.getDescAndCover(bookFile);
        fb2 = parsed.fb2;
        cover = parsed.cover;
        coverExt = parsed.coverExt;
    } catch (e) {
        console.error(`[fb2Cover] getDescAndCover error: ${e.message}`);
    }

    if (cover) {
        return { fb2, cover, coverExt };
    }

    // 2. fallback: covers/<libFolder>
    try {
        const pathCover = path.join(config.libDir, 'covers', libFolder);
        if (await fs.pathExists(pathCover)) {
            const imageBuffer = await readArchiveEntry(pathCover, bookId);
            if (imageBuffer) {
                const { outputImg, ext } = await jxlConvert(imageBuffer);
                return {
                    fb2,
                    cover: outputImg,
                    coverExt: ext === 'jpeg' ? '.jpg' : '.png',
                };
            }
        }
    } catch (e) {
        console.error(`[fb2Cover] covers fallback error: ${e.message}`);
    }

    return { fb2, cover: null, coverExt: '' };
}

module.exports = { extractFb2Data };