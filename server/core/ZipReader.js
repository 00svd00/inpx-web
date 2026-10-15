const fs = require('fs-extra');
const StreamUnzip = require('node-stream-zip');
const SevenZipHelper = require('./SevenZipHelper');

// Архивы многих inpx-коллекций (в частности, Флибусты) сжаты PPMd (метод 98).
// node-stream-zip умеет только deflate и падает на "Unknown compression method: 98",
// поэтому такие записи достаем внешним 7z, если он есть в системе.

function isUnsupportedMethod(e) {
    return e && /Unknown compression method/i.test(e.message || '');
}

class ZipReader {
    constructor() {
        this.zip = null;
        this.zipFile = null;
        this.sevenZip = new SevenZipHelper();
    }

    checkState() {
        if (!this.zip)
            throw new Error('Zip closed');
    }

    async open(zipFile, zipEntries = true) {
        if (this.zip)
            throw new Error('Zip file is already open');

        const zip = new StreamUnzip.async({file: zipFile, skipEntryNameValidation: true});

        if (zipEntries)
            this.zipEntries = await zip.entries();

        this.zip = zip;
        this.zipFile = zipFile;
    }

    get entries() {
        this.checkState();
        return this.zipEntries;
    }

    fallbackOrThrow(e) {
        if (!isUnsupportedMethod(e))
            throw e;

        const cmd = SevenZipHelper.getSevenZipPath();
        if (!cmd)
            throw new Error(`${e.message}. Install 7-Zip (7z) to read such archives`);

        return cmd;
    }

    async extractToBuf(entryFilePath) {
        this.checkState();

        try {
            return await this.zip.entryData(entryFilePath);
        } catch (e) {
            this.fallbackOrThrow(e);
            return await this.sevenZip.extract(this.zipFile, entryFilePath);
        }
    }

    async extractToFile(entryFilePath, outputFile) {
        this.checkState();

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
        }
    }
}

module.exports = ZipReader;