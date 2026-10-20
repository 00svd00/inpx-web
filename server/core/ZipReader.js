const fs = require('fs-extra');
const StreamUnzip = require('node-stream-zip');
const SevenZipHelper = require('./SevenZipHelper');

// node-stream-zip умеет только deflate и падает:
//  - "Bad archive" — это не zip (например, 7z);
//  - "Unknown compression method" — это zip, но entry сжата не deflate (PPMd, метод 98).
// В обоих случаях пробуем 7z (если он есть в системе).

// zip не смог прочитать архив/entry — пробуем 7z
function shouldFallbackTo7z(e) {
    return e && (
        /Bad archive/i.test(e.message || '') ||
        /Unknown compression method/i.test(e.message || '')
    );
}

// 7z есть — ок; нет — понятная ошибка (с исходным сообщением zip)
function sevenZipOrThrow(e) {
    const cmd = SevenZipHelper.getSevenZipPath();
    if (!cmd)
        throw new Error(`${e.message}. Install 7-Zip (7z) to read such archives`);
    return cmd;
}

class ZipReader {
    constructor() {
        this.zip = null;
        this.zipFile = null;
        this.sevenZip = new SevenZipHelper();
        this.is7z = false;
    }

    checkState() {
        if (!this.zip && !this.is7z)
            throw new Error('Zip closed');
    }

    async open(zipFile, zipEntries = true) {
        if (this.zip || this.is7z)
            throw new Error('Zip file is already open');

        let zip = null;
        try {
            zip = new StreamUnzip.async({file: zipFile, skipEntryNameValidation: true});
            if (zipEntries)
                this.zipEntries = await zip.entries();
        } catch (e) {
            if (zip) {
                try { await zip.close(); } catch (e2) {}
                zip = null;
            }
            if (!shouldFallbackTo7z(e))
                throw e;

            // не zip (или zip не открылся) — пробуем 7z
            sevenZipOrThrow(e);

            this.zipFile = zipFile;
            this.is7z = true;
            if (zipEntries) {
                const list = await this.sevenZip.list(zipFile);
                this.zipEntries = Object.fromEntries(list.map(n => [n, true]));
            }
            return;
        }

        this.zip = zip;
        this.zipFile = zipFile;
    }

    get entries() {
        this.checkState();
        return this.zipEntries;
    }

    fallbackOrThrow(e) {
        if (!shouldFallbackTo7z(e))
            throw e;
        sevenZipOrThrow(e);
    }

    async extractToBuf(entryFilePath) {
        this.checkState();

        if (this.is7z)
            return await this.sevenZip.extract(this.zipFile, entryFilePath);

        try {
            return await this.zip.entryData(entryFilePath);
        } catch (e) {
            this.fallbackOrThrow(e);
            return await this.sevenZip.extract(this.zipFile, entryFilePath);
        }
    }

    async extractToFile(entryFilePath, outputFile) {
        this.checkState();

        if (this.is7z) {
            const buf = await this.sevenZip.extract(this.zipFile, entryFilePath);
            await fs.writeFile(outputFile, buf);
            return;
        }

        try {
            await this.zip.extract(entryFilePath, outputFile);
        } catch (e) {
            this.fallbackOrThrow(e);
            const buf = await this.sevenZip.extract(this.zipFile, entryFilePath);
            await fs.writeFile(outputFile, buf);
        }
    }

    async extractAllToDir(outputDir) {
        this.checkState();

        if (this.is7z) {
            await fs.ensureDir(outputDir);
            await this.sevenZip.extractAll(this.zipFile, outputDir);
            return;
        }

        try {
            await this.zip.extract(null, outputDir);
        } catch (e) {
            this.fallbackOrThrow(e);
            await fs.ensureDir(outputDir);
            await this.sevenZip.extractAll(this.zipFile, outputDir);
        }
    }

    async close() {
        if (this.zip) {
            await this.zip.close();
            this.zip = null;
            this.zipFile = null;
            this.zipEntries = undefined;
        } else if (this.is7z) {
            this.is7z = false;
            this.zipFile = null;
            this.zipEntries = undefined;
        }
    }
}

module.exports = ZipReader;