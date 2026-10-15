const path = require('path');
const fs = require('fs-extra');

const SevenZipHelper = require('./SevenZipHelper');

class AuthorBioReader {
    constructor(config, db) {
        this.config = config;
        this.db = db;

        this.authorsDir = path.join(config.libDir, 'etc', 'authors');
        this.picturesDir = path.join(this.authorsDir, 'pictures');
        this.photoDir = this.photoDir = config.authorDir;

        this.archive = new SevenZipHelper();

        this.bioCache = new Map();
        this.bioCacheMax = 100;
        this.noPhotoCache = new Set();
    }

    async getArchiveId(hash) {
        const rows = await this.db.select({
            table: 'authors_info',
            where: `@@hash('_uid', ${this.db.esc(hash)})`,
        });

        if (!rows.length)
            return null;

        return rows[0].archiveId;
    }

    // ---- био ------------------------------------------------------------

    _bioCachePut(hash, value) {
        if (this.bioCache.has(hash))
            this.bioCache.delete(hash);

        this.bioCache.set(hash, value);

        while (this.bioCache.size > this.bioCacheMax) {
            const firstKey = this.bioCache.keys().next().value;
            this.bioCache.delete(firstKey);
        }
    }

    /**
     * Дорого: открывает authors/<archiveId>.7z.
     * Возвращает HTML биографии или null.
     */
    async getBio(hash) {
        if (this.bioCache.has(hash))
            return this.bioCache.get(hash);

        const archiveId = await this.getArchiveId(hash);
        if (archiveId === null) {
            this._bioCachePut(hash, null);
            return null;
        }

        const archivePath = path.join(this.authorsDir, `${archiveId}.7z`);

        let bio = null;
        try {
            const buf = await this.archive.extract(archivePath, hash);
            bio = buf.toString('utf8');
        } catch (e) {
            bio = null;
        }

        this._bioCachePut(hash, bio);
        return bio;
    }

    // ---- фото -----------------------------------------------------------

    _photoExtFromName(name) {
        const ext = path.extname(name).toLowerCase();
        if (ext === '.jpg' || ext === '.jpeg')
            return '.jpg';
        if (ext === '.png')
            return '.png';
        if (ext === '.gif')
            return '.gif';
        if (ext === '.webp')
            return '.webp';
        return ext || '.jpg';
    }

    _mimeFromExt(ext) {
        switch (ext) {
            case '.jpg':
            case '.jpeg':
                return 'image/jpeg';
            case '.png':
                return 'image/png';
            case '.gif':
                return 'image/gif';
            case '.webp':
                return 'image/webp';
            default:
                return 'application/octet-stream';
        }
    }

    async _findCachedPhoto(hash) {
        const exts = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
        for (const ext of exts) {
            const p = path.join(this.photoDir, `${hash}${ext}`);
            if (await fs.pathExists(p))
                return {path: p, ext};
        }
        return null;
    }

    /**
     * Дорого при первом вызове (открывает pictures/<archiveId>.zip),
     * дёшево при повторном (кеш на диске + noPhotoCache).
     * Возвращает {path, ext} или null.
     */
    async getPhoto(hash) {
        const cached = await this._findCachedPhoto(hash);
        if (cached)
            return cached;

        if (this.noPhotoCache.has(hash))
            return null;

        const archiveId = await this.getArchiveId(hash);
        if (archiveId === null) {
            this.noPhotoCache.add(hash);
            return null;
        }

        const archivePath = path.join(this.picturesDir, `${archiveId}.zip`);
        if (!await fs.pathExists(archivePath)) {
            this.noPhotoCache.add(hash);
            return null;
        }

        let files;
        try {
            files = await this.archive.list(archivePath);
        } catch (e) {
            this.noPhotoCache.add(hash);
            return null;
        }

        const prefix = `${hash}/`;
        const matched = files
            .filter(name => name.startsWith(prefix) && !name.endsWith('/'))
            .sort();

        if (!matched.length) {
            this.noPhotoCache.add(hash);
            return null;
        }

        const entry = matched[0];
        const ext = this._photoExtFromName(entry);

        await fs.ensureDir(this.photoDir);
        const outPath = path.join(this.photoDir, `${hash}${ext}`);

        try {
            const buf = await this.archive.extract(archivePath, entry);
            await fs.writeFile(outPath, buf);
        } catch (e) {
            this.noPhotoCache.add(hash);
            return null;
        }

        return {path: outPath, ext};
    }

    mimeFromExt(ext) {
        return this._mimeFromExt(ext);
    }

    clearCache() {
        this.bioCache.clear();
        this.noPhotoCache.clear();
    }
}

module.exports = AuthorBioReader;