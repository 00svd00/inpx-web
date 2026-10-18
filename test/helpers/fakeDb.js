// Минимальный in-memory фейк jembadb для Reader/Indexer/loadIndexFromDump.
// Поддерживает: select({table, where}), esc, create, insert, close, freeMemory, open, openAll.
class FakeDb {
    constructor() {
        this.tables = new Map();       // table -> rows[]
        this.hashes = new Map();       // table -> Set<field> (созданные hash-индексы)
        this.created = [];             // {table, index?, hash?}
        this.inserted = [];            // {table, rows}
    }

    esc(v) {
        return `'${String(v).replace(/'/g, "''")}'`;
    }

    async select({ table, where }) {
        const rows = this.tables.get(table) || [];
        if (!where) return rows.slice();

        // поддержка @@hash('_uid', 'x') и @@hash('_uid', ['a','b'])
        const m = where.match(/@@hash\('([^']+)',\s*(.+?)\)$/);
        if (m) {
            const [, field, raw] = m;
            let key = raw.trim();
            let values;
            if (key.startsWith('[')) {
                values = key.slice(1, -1).split(',').map(s => s.trim().replace(/^'|'$/g, ''));
            } else {
                values = [key.replace(/^'|'$/g, '')];
            }
            const set = new Set(values);
            return rows.filter(r => set.has(r[field]));
        }

        // @@id('x')
        const mid = where.match(/@@id\((.+?)\)$/);
        if (mid) {
            const key = mid[1].trim().replace(/^'|'$/g, '');
            return rows.filter(r => String(r.id) === key);
        }

        return rows.slice();
    }

    async create(opts) {
        this.created.push(opts);
        if (opts.table && !this.tables.has(opts.table))
            this.tables.set(opts.table, []);
        if (opts.in && opts.hash) {
            if (!this.hashes.has(opts.in)) this.hashes.set(opts.in, new Set());
            this.hashes.get(opts.in).add(opts.hash.field);
        }
    }

    async insert({ table, rows }) {
        const arr = this.tables.get(table) || [];
        arr.push(...rows);
        this.tables.set(table, arr);
        this.inserted.push({ table, rows });
    }

    async close() {}
    async open() {}
    async openAll() {}
    async freeMemory() {}
}

module.exports = FakeDb;