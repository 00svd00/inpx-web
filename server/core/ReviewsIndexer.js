const path = require('path');
const fs = require('fs-extra');

const SevenZipHelper = require('./SevenZipHelper');
const utils = require('./utils');

class ReviewsIndexer {
    constructor(config) {
        this.config = config;
        this.reviewsDir = path.join(config.libDir, 'etc', 'reviews');
        this.archive = new SevenZipHelper();
    }

    async loadBooksJson() {
        const additionalZip = path.join(this.reviewsDir, 'additional.zip');
        const buf = await this.archive.extract(additionalZip, 'books.json');
        const arr = JSON.parse(buf.toString('utf8'));

        const map = new Map();
        for (const rec of arr) {
            const key = `${rec.folder}#${rec.file}`;
            map.set(key, {declaredCount: rec.count, sum: rec.sum});
        }

        return map;
    }

    async listMonths() {
        const files = await fs.readdir(this.reviewsDir);
        return files
            .filter(f => /^\d{6}\.7z$/.test(f))
            .sort()
            .map(f => f.replace(/\.7z$/, ''));
    }

    async build(db, callback) {
        callback({progress: 0});

        const booksMap = await this.loadBooksJson();
        callback({progress: 0.05});

        const months = await this.listMonths();
        const monthsMap = new Map();

        let processed = 0;
        for (const month of months) {
            const archivePath = path.join(this.reviewsDir, `${month}.7z`);
            const entries = await this.archive.list(archivePath);

            for (const entry of entries) {
                let arr = monthsMap.get(entry);
                if (!arr) {
                    arr = [];
                    monthsMap.set(entry, arr);
                }
                arr.push(month);
            }

            processed++;
            callback({progress: 0.05 + 0.85 * processed / months.length});
        }

        const allKeys = new Set([...booksMap.keys(), ...monthsMap.keys()]);
        const rows = [];

        for (const key of allKeys) {
            const idx = key.indexOf('#');
            if (idx < 0)
                continue;

            const folder = key.substring(0, idx);
            const file = key.substring(idx + 1);
            const monthsArr = monthsMap.get(key) || [];
            const bj = booksMap.get(key) || {declaredCount: 0, sum: 0};

            rows.push({
                folder,
                file,
                months: monthsArr,
                declaredCount: bj.declaredCount,
                sum: bj.sum,
                _uid: key,
            });
        }

        callback({progress: 0.9});

        await db.create({
            table: 'reviews_index',
            cacheSize: (this.config.lowMemoryMode ? 5 : 500),
        });

        const chunkSize = 10000;
        for (let i = 0; i < rows.length; i += chunkSize) {
            const chunk = rows.slice(i, i + chunkSize);
            await db.insert({table: 'reviews_index', rows: chunk});

            if (this.config.lowMemoryMode) {
                await db.freeMemory();
                utils.freeMemory();
            }

            callback({progress: 0.9 + 0.1 * (i + chunkSize) / rows.length});
        }

        await db.create({
            in: 'reviews_index',
            hash: {field: '_uid', type: 'string', depth: 100, unique: true},
        });

        await db.close({table: 'reviews_index'});
        await db.freeMemory();
        utils.freeMemory();

        callback({progress: 1});

        return rows.length;
    }
}

module.exports = ReviewsIndexer;