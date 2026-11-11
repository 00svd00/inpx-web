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

        // Map<key, bookIds[]> из book:
        //   key = folder(.7z)#file.ext — формат books.json / reviews_index
        //   book.folder (.zip) → .7z; book.file + '.' + book.ext
        // Дубли (одна книга в разных сериях после слияния библиотек) накапливаются
        // в массив bookIds — обратный поиск и ratingCount увидят все.
        const bookIdMap = new Map();
        const bookRows = await db.select({
            table: 'book',
            rawResult: true,
            where: `
                const result = [];
                for (const id of @all()) {
                    const r = @unsafeRow(id);
                    result.push({id: r.id, folder: r.folder, file: r.file, ext: r.ext});
                }
                return result;
            `,
        });
        for (const r of bookRows[0].rawResult) {
            const folder = (r.folder || '').replace(/\.zip$/i, '.7z');
            const file = `${r.file}.${r.ext}`;
            const key = `${folder}#${file}`;
            let arr = bookIdMap.get(key);
            if (!arr) {
                arr = [];
                bookIdMap.set(key, arr);
            }
            arr.push(r.id);
        }

        const allKeys = new Set([...booksMap.keys(), ...monthsMap.keys()]);
        const rows = [];

        for (const key of allKeys) {
            const idx = key.indexOf('#');
            if (idx < 0)
                continue;

            const bookIds = bookIdMap.get(key);
            if (!bookIds || !bookIds.length)
                continue;   // книги нет в book (отфильтрована/удалена) — пропускаем

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
                bookIds,
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

        await db.create({
           in: 'reviews_index',
           index: {field: 'declaredCount', type: 'number', depth: 1000},
       });

        await db.close({table: 'reviews_index'});
        await db.freeMemory();
        utils.freeMemory();

        callback({progress: 1});

        return rows.length;
    }
}

module.exports = ReviewsIndexer;