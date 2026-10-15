const path = require('path');
const fs = require('fs-extra');

const SevenZipHelper = require('./SevenZipHelper');
const utils = require('./utils');

class AuthorBioIndexer {
    constructor(config) {
        this.config = config;
        this.authorsDir = path.join(config.libDir, 'etc', 'authors');
        this.archive = new SevenZipHelper();
    }

    async listArchives() {
        const files = await fs.readdir(this.authorsDir);
        return files
            .filter(f => /^\d+\.7z$/.test(f))
            .sort((a, b) => parseInt(a) - parseInt(b))
            .map(f => ({
                archiveId: f.replace(/\.7z$/, ''),
                archivePath: path.join(this.authorsDir, f),
            }));
    }

    async build(db, callback) {
        callback({progress: 0});

        const archives = await this.listArchives();
        if (!archives.length) {
            callback({progress: 1});
            return 0;
        }

        // Map<hash, archiveId>: один автор = одна запись.
        // Архивы отсортированы по возрастанию archiveId,
        // поэтому Map.set перезаписывает — "последний wins".
        const rowsMap = new Map();
        let processed = 0;

        for (const {archiveId, archivePath} of archives) {
            const entries = await this.archive.list(archivePath);

            for (const name of entries) {
                // имя файла = MD5-хеш автора, без расширения
                rowsMap.set(name, archiveId);
            }

            processed++;
            callback({progress: 0.05 + 0.85 * processed / archives.length});
        }

        callback({progress: 0.9});

        const rows = [];
        for (const [hash, archiveId] of rowsMap)
            rows.push({_uid: hash, archiveId});

        await db.create({
            table: 'authors_info',
            cacheSize: (this.config.lowMemoryMode ? 5 : 500),
        });

        const chunkSize = 10000;
        for (let i = 0; i < rows.length; i += chunkSize) {
            const chunk = rows.slice(i, i + chunkSize);
            await db.insert({table: 'authors_info', rows: chunk});

            if (this.config.lowMemoryMode) {
                await db.freeMemory();
                utils.freeMemory();
            }

            callback({progress: 0.9 + 0.1 * (i + chunkSize) / rows.length});
        }

        await db.create({
            in: 'authors_info',
            hash: {field: '_uid', type: 'string', depth: 100, unique: true},
        });

        await db.close({table: 'authors_info'});
        await db.freeMemory();
        utils.freeMemory();

        callback({progress: 1});

        return rows.length;
    }
}

module.exports = AuthorBioIndexer;
