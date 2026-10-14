const path = require('path');
const ZipReader = require('./ZipReader');
const { spawn } = require('child_process');

class ReviewsReader {
    constructor(config, db) {
        this.config = config;
        this.db = db;
        this.reviewsDir = path.join(config.libDir, 'etc', 'reviews');
        this.cache = new Map();
        this.cacheMaxSize = 100;
        this.cacheMaxReviews = 5000;
        this.cacheReviewsCount = 0;
    }

    _spawn7z(args) {
        return new Promise((resolve, reject) => {
            const bin = ZipReader.getSevenZipPath();
            if (!bin) {
                reject(new Error('7z not found. Install 7-Zip or set sevenZipPath in config.'));
                return;
            }
            const proc = spawn(bin, args);

            const outChunks = [];
            const errChunks = [];

            proc.stdout.on('data', c => outChunks.push(c));
            proc.stderr.on('data', c => errChunks.push(c));
            proc.on('error', reject);
            proc.on('close', code => {
                if (code !== 0) {
                    reject(new Error(`7z exited with ${code}: ${Buffer.concat(errChunks).toString()}`));
                } else {
                    resolve(Buffer.concat(outChunks));
                }
            });
        });
    }

    async extractFile(archivePath, entryName) {
        const out = await this._spawn7z(['e', '-so', '-y', archivePath, `-i!${entryName}`]);
        return out;
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

    async read(folder, file) {
        folder = folder.replace(/\.zip$/i, '.7z');
        const key = `${folder}#${file}`;

        if (this.cache.has(key)) {
            return this.cache.get(key);
        }

        const result = {
            declaredCount: 0,
            sum: 0,
            foundCount: 0,
            reviews: [],
        };

        const rows = await this.db.select({
            table: 'reviews_index',
            where: `@@hash('_uid', ${this.db.esc(key)})`,
        });

        if (!rows.length) {
            this._cachePut(key, result);
            return result;
        }

        const rec = rows[0];
        result.declaredCount = rec.declaredCount || 0;
        result.sum = rec.sum || 0;

        const months = rec.months || [];
        for (const month of months) {
            const archivePath = path.join(this.reviewsDir, `${month}.7z`);
            try {
                const buf = await this.extractFile(archivePath, key);
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

        this._cachePut(key, result);
        return result;
    }

    _cachePut(key, value) {
        const reviewsCount = value.reviews ? value.reviews.length : 0;

        while (this.cache.size > 0 &&
               (this.cache.size >= this.cacheMaxSize ||
                this.cacheReviewsCount + reviewsCount > this.cacheMaxReviews)) {
            const firstKey = this.cache.keys().next().value;
            const firstVal = this.cache.get(firstKey);
            this.cacheReviewsCount -= (firstVal.reviews ? firstVal.reviews.length : 0);
            this.cache.delete(firstKey);
        }

        this.cache.set(key, value);
        this.cacheReviewsCount += reviewsCount;
    }

    clearCache() {
        this.cache.clear();
        this.cacheReviewsCount = 0;
    }
}

module.exports = ReviewsReader;