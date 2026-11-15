const assert = require('node:assert');
const test = require('node:test');

const hooks = require('../../server/core/hooks');
const { applyTolinoPlainNavLinks } = require('../../plugins/opds-tolino');
const plugin = require('../../plugins/opds-tolino');

const TEST_PLUGIN_ID = 'opds-tolino-test';

function mockApi(pluginId = TEST_PLUGIN_ID) {
    return {
        version: '1.0',
        log: () => {},
        registerOpdsPageMutator: (fn, name) => hooks.registerOpdsPageMutator(pluginId, name, fn),
    };
}

// ---------------------------------------------------------------------------
// Чистая функция applyTolinoPlainNavLinks
// ---------------------------------------------------------------------------

test('opds-tolino: одна subsection → plain-дубль без rel', () => {
    const content = {entry: [{link: [
        {'*ATTRS': {href: '/x', rel: 'subsection', type: 'application/atom+xml;profile=opds-catalog'}},
    ]}]};

    applyTolinoPlainNavLinks(content);

    const links = content.entry[0].link;
    assert.strictEqual(links.length, 2);
    assert.strictEqual(links[0]['*ATTRS'].rel, 'subsection');
    assert.strictEqual(links[1]['*ATTRS'].rel, undefined);
    assert.strictEqual(links[1]['*ATTRS'].href, '/x');
});

test('opds-tolino: две subsection → plain-дубль один (первая)', () => {
    const content = {entry: [{link: [
        {'*ATTRS': {href: '/a', rel: 'subsection'}},
        {'*ATTRS': {href: '/b', rel: 'subsection'}},
    ]}]};

    applyTolinoPlainNavLinks(content);

    const links = content.entry[0].link;
    assert.strictEqual(links.length, 3);
    assert.strictEqual(links[2]['*ATTRS'].href, '/a');
    assert.strictEqual(links[2]['*ATTRS'].rel, undefined);
});

test('opds-tolino: acquisition + subsection → acquisition не тронут', () => {
    const content = {entry: [{link: [
        {'*ATTRS': {href: '/dl', rel: 'http://opds-spec.org/acquisition', type: 'application/fb2+zip'}},
        {'*ATTRS': {href: '/nav', rel: 'subsection'}},
    ]}]};

    applyTolinoPlainNavLinks(content);

    const links = content.entry[0].link;
    assert.strictEqual(links.length, 3);
    assert.strictEqual(links[0]['*ATTRS'].rel, 'http://opds-spec.org/acquisition');
    assert.strictEqual(links[2]['*ATTRS'].href, '/nav');
    assert.strictEqual(links[2]['*ATTRS'].rel, undefined);
});

test('opds-tolino: related + acquisition → plain-дубля нет', () => {
    const content = {entry: [{link: [
        {'*ATTRS': {href: '/a', rel: 'related'}},
        {'*ATTRS': {href: '/b', rel: 'http://opds-spec.org/acquisition'}},
    ]}]};

    applyTolinoPlainNavLinks(content);

    assert.strictEqual(content.entry[0].link.length, 2);
});

test('opds-tolino: entry без link — no-op, не падает', () => {
    const content = {entry: [{title: 'x'}]};
    applyTolinoPlainNavLinks(content);
    assert.strictEqual(content.entry[0].link, undefined);
});

test('opds-tolino: entry — одиночный объект (не массив)', () => {
    const content = {entry: {link: [{'*ATTRS': {href: '/x', rel: 'subsection'}}]}};
    applyTolinoPlainNavLinks(content);
    assert.strictEqual(content.entry.link.length, 2);
});

test('opds-tolino: идемпотентен (если plain-ссылка уже есть — no-op)', () => {
    const content = {entry: [{link: [
        {'*ATTRS': {href: '/x', rel: 'subsection'}},
        {'*ATTRS': {href: '/x'}},
    ]}]};

    applyTolinoPlainNavLinks(content);

    assert.strictEqual(content.entry[0].link.length, 2);   // не тронут
});

// ---------------------------------------------------------------------------
// Интеграция через hooks
// ---------------------------------------------------------------------------

test('opds-tolino: start() регистрирует page-мутатор', async () => {
    try {
        await plugin.start(mockApi());
        const snap = hooks.snapshot();
        assert.strictEqual(snap.opdsPageMutators.length, 1);
        assert.strictEqual(snap.opdsPageMutators[0].pluginId, TEST_PLUGIN_ID);
        assert.strictEqual(snap.opdsPageMutators[0].name, 'opds-tolino');
    } finally {
        hooks.unregisterPlugin(TEST_PLUGIN_ID);
    }
});

test('opds-tolino: runOpdsPageMutators применяет plain-дубль', async () => {
    try {
        await plugin.start(mockApi());
        const content = {entry: [{link: [{'*ATTRS': {href: '/x', rel: 'subsection'}}]}]};
        const out = await hooks.runOpdsPageMutators(content, {});
        assert.strictEqual(out.entry[0].link.length, 2);
        assert.strictEqual(out.entry[0].link[1]['*ATTRS'].href, '/x');
    } finally {
        hooks.unregisterPlugin(TEST_PLUGIN_ID);
    }
});

test('opds-tolino: unregisterPlugin снимает мутатор', async () => {
    await plugin.start(mockApi());
    assert.strictEqual(hooks.snapshot().opdsPageMutators.length, 1);

    hooks.unregisterPlugin(TEST_PLUGIN_ID);

    assert.strictEqual(hooks.snapshot().opdsPageMutators.length, 0);
});

test('opds-tolino: start() при несовместимом api.version — не регистрирует', async () => {
    const api = Object.assign(mockApi(), {version: '2.0'});
    try {
        await plugin.start(api);
        assert.strictEqual(hooks.snapshot().opdsPageMutators.length, 0);
    } finally {
        hooks.unregisterPlugin(TEST_PLUGIN_ID);
    }
});

test('opds-tolino: start() без registerOpdsPageMutator — не падает', async () => {
    const api = {version: '1.0', log: () => {}};
    try {
        await plugin.start(api);   // должен просто залогировать WARN и вернуться
        assert.strictEqual(hooks.snapshot().opdsPageMutators.length, 0);
    } finally {
        hooks.unregisterPlugin(TEST_PLUGIN_ID);
    }
});