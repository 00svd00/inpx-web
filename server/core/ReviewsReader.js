const path = require('path');
const fs = require('fs-extra');
const zlib = require('zlib');

const SevenZipHelper = require('./SevenZipHelper');

class ReviewsReader {
    constructor(config, db) {
        this.config = config;
        this.db = db;
        this.reviewsDir = path.join(config.libDir || '', 'etc', 'reviews');
        this.archive = new SevenZipHelper();
        this.bookDir = config.bookDir;
    }

    // только счётчики, без открытия 7z — дёшево
    async getCount(folder, file) {
        folder = folder.replace(/\.zip$/i, '.7z');
        const key = `${folder}#${file}`;

        const rows = await this.db.select({
            table: 'reviews_index',
            where: `@@hash('_uid', ${this.db.esc(key)})`,
        });

        if (!rows.length)
            return {declaredCount: 0, sum: 0};

        return {
            declaredCount: rows[0].declaredCount || 0,
            sum: rows[0].sum || 0,
        };
    }

    // hash — <hash> книги (sha256 содержимого), для имени файла public-files/book/<hash>.review
    async read(folder, file, hash) {
        folder = folder.replace(/\.zip$/i, '.7z');
        const key = `${folder}#${file}`;

        const result = {
            declaredCount: 0,
            sum: 0,
            foundCount: 0,
            reviews: [],
            months: [],
        };

        const rows = await this.db.select({
            table: 'reviews_index',
            where: `@@hash('_uid', ${this.db.esc(key)})`,
        });

        if (!rows.length)
            return result;

        const rec = rows[0];
        result.declaredCount = rec.declaredCount || 0;
        result.sum = rec.sum || 0;
        result.months = rec.months || [];

        // 1) кэш на диске
        const cacheFile = hash ? path.join(this.bookDir, `${hash}.review`) : '';
        if (cacheFile && await fs.pathExists(cacheFile)) {
            try {
                const cached = JSON.parse(zlib.gunzipSync(await fs.readFile(cacheFile)).toString('utf8'));
                const sameMonths = Array.isArray(cached.months)
                    && cached.months.length === result.months.length
                    && cached.months.every((m, i) => m === result.months[i]);
                if (cached && Array.isArray(cached.reviews) && sameMonths) {
                    cached.declaredCount = result.declaredCount;
                    cached.sum = result.sum;
                    return cached;
                }
                await fs.remove(cacheFile);
            } catch (e) {
                try { await fs.remove(cacheFile); } catch (e2) {}
            }
        }

        // 2) архивы — только если есть libDir (поставщик/сингл)
        if (!this.config.libDir)
            return result;

        for (const month of result.months) {
            const archivePath = path.join(this.reviewsDir, `${month}.7z`);
            try {
                const buf = await this.archive.extract(archivePath, key);
                const arr = JSON.parse(buf.toString('utf8'));
                if (Array.isArray(arr))
                    result.reviews.push(...arr);
            } catch (e) {
                // файл мог быть удалён — пропускаем
            }
        }

        result.reviews.sort((a, b) => {
            const ta = a.time || '';
            const tb = b.time || '';
            return ta > tb ? -1 : (ta < tb ? 1 : 0);
        });

        result.foundCount = result.reviews.length;

        // 3) записать кэш на диск (атомарно: tmp + move)
        if (cacheFile) {
            try {
                await fs.ensureDir(this.bookDir);
                const tmpFile = `${cacheFile}.tmp`;
                await fs.writeFile(tmpFile, zlib.gzipSync(JSON.stringify(result)));
                await fs.move(tmpFile, cacheFile, {overwrite: true});
            } catch (e) {
                // не критично
            }
        }

        return result;
    }

    clearCache() {
        // кэш на диске чистится периодической чисткой bookDir (periodicCleanDir)
    }
}

module.exports = ReviewsReader;