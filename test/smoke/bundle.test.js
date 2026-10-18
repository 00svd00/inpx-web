const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs-extra');
const path = require('path');
const { execFileSync } = require('child_process');

const bundle = path.resolve(__dirname, '../../dist/bundle/index.js');

test('dist/bundle/index.js существует и непустой', async () => {
    assert.ok(await fs.pathExists(bundle), 'run `npm run build:bundle` first');
    assert.ok((await fs.stat(bundle)).size > 1000);
});

test('бандл содержит ключевые символы', async () => {
    const src = await fs.readFile(bundle, 'utf8');
    for (const sym of ['PROTOCOL_VERSION', 'materializeReviews', 'materializeBio',
                       'getReviewLink', 'getBioLink', 'getPhotoLink', 'getBookReviewsCount',
                       'createWebApp'])
        assert.ok(src.includes(sym), `bundle missing ${sym}`);
});

test('dist/public.json инлайнится (путь не остаётся строкой)', async () => {
    const src = await fs.readFile(bundle, 'utf8');
    assert.ok(!src.includes('../dist/public.json'), 'public.json не инлайнится esbuild');
});

test('бандл не тянет test/ (нет node:test и require из test/)', async () => {
    const src = await fs.readFile(bundle, 'utf8');
    assert.ok(!src.includes('node:test'), 'bundle must not include node:test');
    assert.ok(!/require\(["'][^"']*\/test\//.test(src), 'bundle must not require test/ modules');
});

test('node --check: синтаксис валиден', () => {
    execFileSync(process.execPath, ['--check', bundle]);
});