const fs = require('fs-extra');
const path = require('path');
const ZipReader = require('./ZipReader.js');
const { jxlConvert } = require('./book/bookImages');

async function getCoverBuff(pathCover, entryBook) {
    const zipReader = new ZipReader();
    try {
        await zipReader.open(pathCover);
        if (entryBook in zipReader.entries)
            return await zipReader.extractToBuf(entryBook);
    } catch (e) {
        console.error(e);
        return null;
    } finally {
        try { await zipReader.close(); } catch (e) {}
    }
}

async function extractZipCoverAndConvert(config, hash, bookFile, entryBook) {
    try {
        const pathCover = path.join(config.libDir, 'covers', bookFile);
        if (!await fs.pathExists(pathCover)) {
            console.log(`❌ Book "${bookFile}" cover not found!`);
            return null;
        }

        const imageBuffer = await getCoverBuff(pathCover, entryBook);
        if (!imageBuffer) {
            console.log(`❌ Cover buffer data is incorrect!`);
            return null;
        }

        const {outputImg, ext} = await jxlConvert(imageBuffer);
        const outputExt = ext === 'jpeg' ? '.jpg' : '.png';
        const outputImage = path.join(config.bookDir, `${hash}${outputExt}`);
        await fs.writeFile(outputImage, outputImg);

        return `${config.bookPathStatic}/${hash}${outputExt}`;
    } catch (error) {
        console.error(`Error: ${error.message}`);
        return null;
    }
}

module.exports = extractZipCoverAndConvert;