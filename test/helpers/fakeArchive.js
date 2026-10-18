// Фейк SevenZipHelper: extract/list по заранее заданной Map.
// Ключи: `${archivePath}#${entryName}` для extract, archivePath для list.
class FakeArchive {
    constructor({ files = new Map(), lists = new Map(), errors = new Map() } = {}) {
        this.files = files;
        this.lists = lists;
        this.errors = errors;
        this.listCalls = [];
        this.extractCalls = [];
    }

    async extract(archivePath, entryName) {
        this.extractCalls.push([archivePath, entryName]);
        const key = `${archivePath}#${entryName}`;
        if (this.errors.has(key))
            throw this.errors.get(key);
        if (this.files.has(key))
            return this.files.get(key);
        throw new Error(`FakeArchive: no entry ${key}`);
    }

    async list(archivePath) {
        this.listCalls.push(archivePath);
        if (this.errors.has(archivePath))
            throw this.errors.get(archivePath);
        return this.lists.get(archivePath) || [];
    }

    async extractAll() {
        throw new Error('FakeArchive: extractAll not implemented');
    }
}

module.exports = FakeArchive;