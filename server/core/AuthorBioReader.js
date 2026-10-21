const path = require('path');
const fs = require('fs-extra');
const zlib = require('zlib');

const SevenZipHelper = require('./SevenZipHelper');
const { sanitizeHtml } = require('./sanitize');

class AuthorBioReader {
    constructor(config, db) {
        this.config = config;
        this.db = db;

        this.authorsDir = path.join(config.libDir || '', 'etc', 'authors');
        this.picturesDir = path.join(this.authorsDir, 'pictures');
        this.bioDir = config.authorDir;
        this.photoDir = config.authorDir;

        this.archive = new SevenZipHelper();
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

    /**
     * Читает/создаёт public-files/author/<hash>.bio (gzip JSON {archiveId, html}).
     * Возвращает HTML биографии или null.
     */
    async getBio(hash) {
        const archiveId = await this.getArchiveId(hash);
        if (archiveId === null)
            return null;

        const bioFile = path.join(this.bioDir, `${hash}.bio`);

        // 1) кэш на диске — если валиден, возвращаем; иначе removeCached(hash)
        if (await fs.pathExists(bioFile)) {
            try {
                const cached = JSON.parse(zlib.gunzipSync(await fs.readFile(bioFile)).toString('utf8'));
                if (cached && cached.archiveId === archiveId && typeof cached.html === 'string')
                    return cached.html;
            } catch (e) {
                // битый кэш
            }
            await this.removeCached(hash);          // невалиден — снести .bio + фото + .nophoto
        } else {
            await this.removeCached(hash);          // .bio нет — снести «сиротские» фото/.nophoto
        }

        // 2) архивы — только если есть libDir
        if (!this.config.libDir)
            return null;

        const archivePath = path.join(this.authorsDir, `${archiveId}.7z`);

        let html = null;
        try {
            const buf = await this.archive.extract(archivePath, hash);
            html = sanitizeHtml(buf.toString('utf8'));
        } catch (e) {
            html = null;
        }

        if (html === null)
            return null;

        // 3) записать кэш (атомарно: tmp + move)
        try {
            await fs.ensureDir(this.bioDir);
            const tmpFile = `${bioFile}.tmp`;
            await fs.writeFile(tmpFile, zlib.gzipSync(JSON.stringify({ archiveId, html })));
            await fs.move(tmpFile, bioFile, { overwrite: true });
        } catch (e) {
            // не критично
        }

        return html;
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

    async _writeNoPhoto(hash) {
        try {
            await fs.ensureDir(this.photoDir);
            await fs.writeFile(path.join(this.photoDir, `${hash}.nophoto`), '');
        } catch (e) {
            // не критично
        }
    }

    // ---- инвалидация кэша автора ---------------------------------------
    // Сносит все кэшированные артефакты автора по hash:
    //   <hash>.bio, <hash>.<ext> (.jpg/.jpeg/.png/.gif/.webp), <hash>.nophoto.
    // Не трогает .tmp/.dev/.replaced. Возвращает true, если что-то снёс.
    async removeCached(hash) {
        let removed = false;
        const candidates = [
            path.join(this.bioDir, `${hash}.bio`),
            path.join(this.photoDir, `${hash}.jpg`),
            path.join(this.photoDir, `${hash}.jpeg`),
            path.join(this.photoDir, `${hash}.png`),
            path.join(this.photoDir, `${hash}.gif`),
            path.join(this.photoDir, `${hash}.webp`),
            path.join(this.photoDir, `${hash}.nophoto`),
        ];
        for (const f of candidates) {
            try {
                if (await fs.pathExists(f)) {
                    await fs.remove(f);
                    removed = true;
                }
            } catch (e) {
                // не критично
            }
        }
        return removed;
    }

    /**
     * Кэш на диске <hash>.<ext>; маркер <hash>.nophoto — «фото нет»
     * (переживает рестарт, не перебирает архивы повторно).
     * Возвращает {path, ext} или null.
     */
    async getPhoto(hash) {
        const cached = await this._findCachedPhoto(hash);
        if (cached)
            return cached;

        // негативный маркер (0 байт)
        if (await fs.pathExists(path.join(this.photoDir, `${hash}.nophoto`)))
            return null;

        // потребитель: без libDir — только кэш/маркер (скачает через downloadPhoto)
        if (!this.config.libDir)
            return null;

        const archiveId = await this.getArchiveId(hash);
        if (archiveId === null) {
            await this._writeNoPhoto(hash);
            return null;
        }

        const archivePath = path.join(this.picturesDir, `${archiveId}.zip`);
        if (!await fs.pathExists(archivePath)) {
            await this._writeNoPhoto(hash);
            return null;
        }

        let files;
        try {
            files = await this.archive.list(archivePath);
        } catch (e) {
            await this._writeNoPhoto(hash);
            return null;
        }

        const prefix = `${hash}/`;
        const matched = files
            .filter(name => name.startsWith(prefix) && !name.endsWith('/'))
            .sort();

        if (!matched.length) {
            await this._writeNoPhoto(hash);
            return null;
        }

        const entry = matched[0];
        const ext = this._photoExtFromName(entry);

        await fs.ensureDir(this.photoDir);
        const outPath = path.join(this.photoDir, `${hash}${ext}`);

        try {
            const buf = await this.archive.extract(archivePath, entry);
            await fs.writeFile(outPath, buf);
            // если был маркер — удалить
            try { await fs.remove(path.join(this.photoDir, `${hash}.nophoto`)); } catch (e) {}
        } catch (e) {
            await this._writeNoPhoto(hash);
            return null;
        }

        return {path: outPath, ext};
    }

    mimeFromExt(ext) {
        return this._mimeFromExt(ext);
    }

    clearCache() {
        // кэш на диске чистится periodicCleanDir (authorDir)
    }
}

module.exports = AuthorBioReader;