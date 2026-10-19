const fs = require('fs-extra');
const path = require('path');
const seven7z = require('node-7z');
const SevenZipHelper = require('./SevenZipHelper');
const fb2AppendImages = require('./book/fb2AppendImages');
const epubAppendImages = require('./book/epubAppendImages');

// Извлечь fileName из 7z в tempDir. Возвращает {extractedPath, rawBuffer}.
async function extractFrom7z(config, arhivePath, fileName) {
    const sevenZipPath = config.sevenZipPath || SevenZipHelper.getSevenZipPath();
    if (!sevenZipPath)
        throw new Error('7-Zip not found. Install it or specify "sevenZipPath" in config.json');

    return new Promise((resolve, reject) => {
        const stream = seven7z.extractFull(arhivePath, config.tempDir, {
            $bin: sevenZipPath,
            $cherryPick: fileName,
            recursive: true,
        });
        stream.on('end', async () => {
            try {
                const extractedPath = `${config.tempDir}/${fileName}`;
                const rawBuffer = await fs.readFile(extractedPath);
                resolve({extractedPath, rawBuffer});
            } catch (err) { reject(err); }
        });
        stream.on('error', reject);
    });
}

async function BookAppendImages(config, libFolder, fileName, outFile) {
    const path7z = `${config.libDir}/${libFolder}`.replace('.zip', '.7z');
    if (!(await fs.pathExists(path7z))) {
        console.log(`❌ Path to 7z "${path7z}" not found!`);
        return;
    }

    const {extractedPath, rawBuffer} = await extractFrom7z(config, path7z, fileName);
    try {
        const ext = path.extname(fileName).slice(1).toLowerCase();

        if (ext === 'epub') {
            await epubAppendImages(config, libFolder, fileName, extractedPath, outFile);
        } else if (ext === 'fb2') {
            await fb2AppendImages(config, libFolder, fileName, rawBuffer, outFile);
        } else {
            await fs.move(extractedPath, outFile, {overwrite: true});
            // неизвестный/неподдерживаемый формат — отдаём как есть, без обогащения
        }
    } finally {
        await fs.remove(extractedPath).catch(() => {});
    }
}

module.exports = BookAppendImages;