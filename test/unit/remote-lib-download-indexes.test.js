const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');

const RemoteLib = require('../../server/core/RemoteLib');
const { makeTmpDir, cleanup } = require('../helpers/tmpdir');

// fakeThis без конструктора (singleton не трогаем).
// downloadIndexes использует: this.handshake(), this.wsRequest, this.providerFeatures.
function makeFakeThis({ dataDir, reviewsEnabled = true, authorsBioEnabled = true, providerIndexes = ['reviews_index', 'authors_info'], responses = {}, handshakeDone = true } = {}) {
    const calls = {ws: [], handshake: 0};
    const fake = {
        config: {dataDir, reviewsEnabled, authorsBioEnabled},
        providerFeatures: {indexes: providerIndexes},
        handshakeDone,
        calls,
        async handshake() {
            calls.handshake++;
            if (handshakeDone) return;
            // эмулируем handshake: get-config → protocolVersion
            const cfg = await fake.wsRequest({action: 'get-config'});
            if (!cfg.protocolVersion) throw new Error('provider_too_old');
            fake.handshakeDone = true;
            fake.providerFeatures = cfg.features || fake.providerFeatures;
        },
        async wsRequest(req) {
            calls.ws.push(req);
            if (responses[req.table])
                return responses[req.table](req);
            // дефолт: data нет, hash нет
            return {};
        },
    };
    return fake;
}

function writeDump(dataDir, table, content, hash) {
    const file = path.join(dataDir, `${table}.json.gz`);
    const hashFile = `${file}.hash`;
    fs.writeFileSync(file, content);
    fs.writeFileSync(hashFile, hash);
    return {file, hashFile};
}

function sha256(buf) {
    return crypto.createHash('sha256').update(buf).digest('hex');
}

test('downloadIndexes: provider не содержит indexes → пропуск, null', async () => {
    const dir = await makeTmpDir();
    try {
        const fake = makeFakeThis({dataDir: dir, providerIndexes: []});
        const res = await RemoteLib.prototype.downloadIndexes.call(fake, fake.config);
        assert.deepStrictEqual(res, {reviews_index: null, authors_info: null});
        assert.strictEqual(fake.calls.ws.length, 0);
    } finally { await cleanup(dir); }
});

test('downloadIndexes: фича выключена в config → пропуск (даже если provider содержит)', async () => {
    const dir = await makeTmpDir();
    try {
        const fake = makeFakeThis({dataDir: dir, reviewsEnabled: false, authorsBioEnabled: false});
        const res = await RemoteLib.prototype.downloadIndexes.call(fake, fake.config);
        assert.deepStrictEqual(res, {reviews_index: null, authors_info: null});
        assert.strictEqual(fake.calls.ws.length, 0);
    } finally { await cleanup(dir); }
});

test('downloadIndexes: hash совпал → локальный дамп используется (data: null)', async () => {
    const dir = await makeTmpDir();
    try {
        const content = Buffer.from('cached-dump');
        const hash = sha256(content);
        const {file} = writeDump(dir, 'reviews_index', content, hash);

        const fake = makeFakeThis({
            dataDir: dir,
            providerIndexes: ['reviews_index'],
            reviewsEnabled: true,
            authorsBioEnabled: false,
            responses: {
                reviews_index: (req) => {
                    assert.strictEqual(req.hash, hash, 'consumer sends local hash');
                    return {data: null, hash};
                },
            },
        });

        const res = await RemoteLib.prototype.downloadIndexes.call(fake, fake.config);
        assert.strictEqual(res.reviews_index, file);
        assert.strictEqual(res.authors_info, null);
    } finally { await cleanup(dir); }
});

test('downloadIndexes: data нет, hash не совпал → удаляет локальный дамп, null', async () => {
    const dir = await makeTmpDir();
    try {
        const content = Buffer.from('stale');
        const {file, hashFile} = writeDump(dir, 'reviews_index', content, 'deadbeef');

        const fake = makeFakeThis({
            dataDir: dir,
            providerIndexes: ['reviews_index'],
            reviewsEnabled: true,
            authorsBioEnabled: false,
            responses: {
                reviews_index: () => ({data: null, hash: 'other'}),
            },
        });

        const res = await RemoteLib.prototype.downloadIndexes.call(fake, fake.config);
        assert.strictEqual(res.reviews_index, null);
        assert.ok(!await fs.pathExists(file), 'stale dump must be removed');
        assert.ok(!await fs.pathExists(hashFile), 'stale hash must be removed');
    } finally { await cleanup(dir); }
});

test('downloadIndexes: data есть → пишет файл + .hash, возвращает path', async () => {
    const dir = await makeTmpDir();
    try {
        const content = Buffer.from('new-dump');
        const hash = sha256(content);

        const fake = makeFakeThis({
            dataDir: dir,
            providerIndexes: ['reviews_index'],
            reviewsEnabled: true,
            authorsBioEnabled: false,
            responses: {
                reviews_index: () => ({data: content.toString('base64'), hash}),
            },
        });

        const res = await RemoteLib.prototype.downloadIndexes.call(fake, fake.config);
        const file = path.join(dir, 'reviews_index.json.gz');
        assert.strictEqual(res.reviews_index, file);
        assert.deepStrictEqual(await fs.readFile(file), content);
        assert.strictEqual((await fs.readFile(`${file}.hash`, 'utf8')).trim(), hash);
    } finally { await cleanup(dir); }
});

test('downloadIndexes: authors_info — симметрично (data → path)', async () => {
    const dir = await makeTmpDir();
    try {
        const content = Buffer.from('authors-dump');
        const hash = sha256(content);

        const fake = makeFakeThis({
            dataDir: dir,
            providerIndexes: ['authors_info'],
            reviewsEnabled: false,
            authorsBioEnabled: true,
            responses: {
                authors_info: () => ({data: content.toString('base64'), hash}),
            },
        });

        const res = await RemoteLib.prototype.downloadIndexes.call(fake, fake.config);
        assert.strictEqual(res.authors_info, path.join(dir, 'authors_info.json.gz'));
        assert.deepStrictEqual(await fs.readFile(res.authors_info), content);
    } finally { await cleanup(dir); }
});

test('downloadIndexes: handshakeDone=false → вызывает handshake (get-config)', async () => {
    const dir = await makeTmpDir();
    try {
        const content = Buffer.from('x');
        const hash = sha256(content);

        const fake = makeFakeThis({
            dataDir: dir,
            providerIndexes: ['reviews_index'],
            reviewsEnabled: true,
            authorsBioEnabled: false,
            handshakeDone: false,
            responses: {
                // get-config — через wsRequest({action:'get-config'})
                reviews_index: () => ({data: content.toString('base64'), hash}),
            },
        });

        // handshake в fakeThis: wsRequest({action:'get-config'}) → нет в responses → {}
        // → handshake упадёт с provider_too_old. Добавим get-config в wsRequest:
        const origWs = fake.wsRequest;
        fake.wsRequest = async (req) => {
            if (req.action === 'get-config')
                return {protocolVersion: 2, features: {indexes: ['reviews_index']}};
            return origWs(req);
        };

        const res = await RemoteLib.prototype.downloadIndexes.call(fake, fake.config);
        assert.strictEqual(fake.calls.handshake, 1);
        assert.strictEqual(res.reviews_index, path.join(dir, 'reviews_index.json.gz'));
    } finally { await cleanup(dir); }
});