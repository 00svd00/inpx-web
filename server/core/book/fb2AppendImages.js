const fs = require('fs-extra');
const iconv = require('iconv-lite');
const path = require('path');
const {
    jxlConvert,
    readArchiveEntry,
    listArchiveEntries,
} = require('./bookImages');

function convertImageToBase64(filePath) {
    try {
        return fs.readFileSync(filePath).toString('base64');
    } catch (error) {
        console.error(`Error converting file to Base64: ${error.message}`);
        throw error;
    }
}

async function getCoverByBookId(config, libFolder, bookId, pathTmp) {
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

    return await jxlConvert(coverBuff, pathTmp, `${bookId}_cover`);
}

// fb2: iconv (encoding из <?xml?>), <binary> перед </FictionBook>, utf-8.
// cover — из covers/<libFolder> (независимо от images);
// images/<libFolder> — опционально (если нет — cover всё равно добавляется).
async function getImagesBase64(config, libFolder, fileName) {
    const obj_images = {};
    const bookId = fileName.replace('.fb2', '');
    const pathTmp = `${config.tempDir}/${bookId}`;
    if (!fs.pathExistsSync(pathTmp))
        fs.mkdirSync(pathTmp, {recursive: true});

    // Get cover (covers/<libFolder> — независимо от images)
    const cover_obj = await getCoverByBookId(config, libFolder, bookId, pathTmp);
    if (cover_obj) {
        const {outputImg, ext} = cover_obj;
        obj_images['cover'] = convertImageToBase64(outputImg, ext);
    } else {
        console.log(`❌ Error coverpage equal null!`);
    }

    // Get illustrations (images/<libFolder> — опционально)
    const pathImages = path.join(config.libDir, 'images', libFolder);
    if (!(await fs.pathExists(pathImages))) {
        console.log(`❌ Error path to illustrations "${pathImages}" not found!`);
        if (fs.pathExistsSync(pathTmp))
            fs.rmSync(pathTmp, {recursive: true});
        return obj_images;
    }

    try {
        const entries = await listArchiveEntries(pathImages);
        for (const entry of entries) {
            if (entry.includes(bookId)) {
                const imageBuff = await readArchiveEntry(pathImages, entry);
                if (!imageBuff)
                    continue;
                const namefile = entry.slice(entry.lastIndexOf('/') + 1);
                const {outputImg, ext} = await jxlConvert(imageBuff, pathTmp, namefile);
                obj_images[namefile] = convertImageToBase64(outputImg, ext);
            }
        }
    } catch (e) {
        console.error(e);
    } finally {
        if (fs.pathExistsSync(pathTmp))
            fs.rmSync(pathTmp, {recursive: true});
    }

    return obj_images;
}

async function fb2AppendImages(config, libFolder, fileName, rawBuffer, outFile) {
    const preview = rawBuffer.slice(0, 500).toString('ascii');
    const match = preview.match(/encoding=["']([^"']+)["']/i);
    const encoding = match ? match[1].toLowerCase() : 'windows-1251';

    let fb2Text = iconv.decode(rawBuffer, encoding);

    const entries = await getImagesBase64(config, libFolder, fileName);

    let binaryBlocks = '';
    for (const imageName in entries) {
        const pureBase64 = entries[imageName].replace(/^data:image\/\w+;base64,/, '');
        const contentType = imageName.toLowerCase().endsWith('.jpg') || imageName.toLowerCase().endsWith('.jpeg')
            ? 'image/jpeg'
            : 'image/png';
        binaryBlocks += `\n<binary id="${imageName}" content-type="${contentType}">${pureBase64}</binary>`;
    }

    if (fb2Text.includes('</FictionBook>'))
        fb2Text = fb2Text.replace('</FictionBook>', `${binaryBlocks}\n</FictionBook>`);
    else
        fb2Text += binaryBlocks;

    fb2Text = fb2Text.replace(/encoding=["']([^"']+)["']/i, 'encoding="utf-8"');

    await fs.writeFile(outFile, fb2Text, 'utf-8');
}

module.exports = fb2AppendImages;