const fs = require('fs-extra');
const iconv = require('iconv-lite');
const path = require('path');
const os = require('os');
const {
    jxlConvert,
    readArchiveEntry,
    readArchiveEntries,
} = require('./bookImages');

async function getCoverByBookId(config, libFolder, bookId) {
    const pathCover = path.join(config.libDir, 'covers', libFolder);
    if (!await fs.pathExists(pathCover)) {
        console.log(`❌ Error path to coverpage "${pathCover}" not found!`);
        return null;
    }

    const coverBuff = await readArchiveEntry(pathCover, bookId);
    if (!coverBuff) {
        console.log(`❌ Cover buffer data is incorrect!`);
        return null;
    }

    return await jxlConvert(coverBuff);
}

async function getImagesBase64(config, libFolder, fileName) {
    const obj_images = {};
    const bookId = fileName.replace('.fb2', '');

    // cover — один entry, не в пуле (один)
    const cover_obj = await getCoverByBookId(config, libFolder, bookId);
    if (cover_obj) {
        const {outputImg} = cover_obj;
        obj_images['cover'] = outputImg.toString('base64');
    } else {
        console.log(`❌ Error coverpage equal null!`);
    }

    // иллюстрации — опционально
    const pathImages = path.join(config.libDir, 'images', libFolder);
    if (!(await fs.pathExists(pathImages))) {
        console.log(`❌ Error path to illustrations "${pathImages}" not found!`);
        return obj_images;
    }

    try {
        const images = await readArchiveEntries(pathImages, n => n.includes(bookId));

        const MAX_CONCURRENCY = 8;
        const concurrency = Math.min(os.availableParallelism(), MAX_CONCURRENCY);
        const queue = images.slice();

        const workers = [];
        for (let w = 0; w < concurrency; w++) {
            workers.push((async () => {
                while (queue.length) {
                    const {name, buf} = queue.shift();
                    const namefile = name.slice(name.lastIndexOf('/') + 1);
                    const {outputImg} = await jxlConvert(buf);
                    obj_images[namefile] = outputImg.toString('base64');
                }
            })());
        }
        await Promise.all(workers);
    } catch (e) {
        console.error(e);
    }

    return obj_images;
}

async function fb2AppendImages(config, libFolder, fileName, rawBuffer, outFile) {
    const preview = rawBuffer.slice(0, 500).toString('ascii');
    const match = preview.match(/encoding=["']([^"']+)["']/i);
    const encoding = match ? match[1].toLowerCase() : 'windows-1251';

    let fb2Text = iconv.decode(rawBuffer, encoding);

    const entries = await getImagesBase64(config, libFolder, fileName);

    const blocks = [];
    for (const imageName in entries) {
        const pureBase64 = entries[imageName].replace(/^data:image\/\w+;base64,/, '');
        const contentType = imageName.toLowerCase().endsWith('.jpg') || imageName.toLowerCase().endsWith('.jpeg')
            ? 'image/jpeg'
            : 'image/png';
        blocks.push(`\n<binary id="${imageName}" content-type="${contentType}">${pureBase64}</binary>`);
    }
    const binaryBlocks = blocks.join('');

    if (fb2Text.includes('</FictionBook>'))
        fb2Text = fb2Text.replace('</FictionBook>', `${binaryBlocks}\n</FictionBook>`);
    else
        fb2Text += binaryBlocks;

    fb2Text = fb2Text.replace(/encoding=["']([^"']+)["']/i, 'encoding="utf-8"');

    await fs.writeFile(outFile, fb2Text, 'utf-8');
}

module.exports = fb2AppendImages;