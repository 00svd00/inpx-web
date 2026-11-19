const assert = require('node:assert');
const test = require('node:test');

const hooks = require('../../server/core/hooks');

// Уникальный id на тест — чтобы unregister не задевал соседние тесты
let counter = 0;
function nextId() {
    return `test-hooks-${++counter}`;
}

function cleanup(...ids) {
    for (const id of ids)
        hooks.unregisterPlugin(id);
}

// ---------------------------------------------------------------------------
// Регистрация + snapshot
// ---------------------------------------------------------------------------

test('hooks: реестр стартует пустым (нет built-in)', () => {
    const s = hooks.snapshot();
    assert.strictEqual(s.opdsPageMutators.length, 0);
    assert.strictEqual(s.opdsBookLinks.length, 0);
    assert.strictEqual(s.webBookLinks.length, 0);
});

test('hooks: registerOpdsPageMutator + snapshot', () => {
    const id = nextId();
    try {
        hooks.registerOpdsPageMutator(id, 'm1', () => {});
        const s = hooks.snapshot();
        assert.strictEqual(s.opdsPageMutators.length, 1);
        assert.strictEqual(s.opdsPageMutators[0].pluginId, id);
        assert.strictEqual(s.opdsPageMutators[0].name, 'm1');
    } finally {
        cleanup(id);
    }
});

test('hooks: name по умолчанию — fn.name или anonymous', () => {
    const id = nextId();
    try {
        function namedFn() {}
        hooks.registerOpdsPageMutator(id, undefined, namedFn);
        const s = hooks.snapshot();
        assert.strictEqual(s.opdsPageMutators[0].name, 'namedFn');

        hooks.registerOpdsPageMutator(id, undefined, () => {});
        const s2 = hooks.snapshot();
        // вторый: function.name для анонимной стрелки — пустая строка
        assert.ok(['anonymous', ''].includes(s2.opdsPageMutators[1].name));
    } finally {
        cleanup(id);
    }
});

test('hooks: registerRoute/BookLinks/WebBookLinks — валидация fn', () => {
    const id = nextId();
    assert.throws(() => hooks.registerOpdsPageMutator(id, 'x', null), /fn must be a function/);
    assert.throws(() => hooks.registerOpdsBookLinks(id, 'x', null), /fn must be a function/);
    assert.throws(() => hooks.registerWebBookLinks(id, 'x', null), /fn must be a function/);
});

// ---------------------------------------------------------------------------
// has* / unregisterPlugin
// ---------------------------------------------------------------------------

test('hooks: has* отражает наличие', () => {
    const id = nextId();
    try {
        assert.strictEqual(hooks.hasOpdsBookLinks(), false);
        assert.strictEqual(hooks.hasWebBookLinks(), false);

        hooks.registerOpdsBookLinks(id, 'x', () => []);
        hooks.registerWebBookLinks(id, 'x', () => ({}));

        assert.strictEqual(hooks.hasOpdsBookLinks(), true);
        assert.strictEqual(hooks.hasWebBookLinks(), true);
    } finally {
        cleanup(id);
    }
});

test('hooks: unregisterPlugin снимает все три типа', () => {
    const id = nextId();
    hooks.registerOpdsPageMutator(id, 'a', () => {});
    hooks.registerOpdsBookLinks(id, 'b', () => []);
    hooks.registerWebBookLinks(id, 'c', () => ({}));

    hooks.unregisterPlugin(id);

    const s = hooks.snapshot();
    assert.strictEqual(s.opdsPageMutators.length, 0);
    assert.strictEqual(s.opdsBookLinks.length, 0);
    assert.strictEqual(s.webBookLinks.length, 0);
});

test('hooks: unregisterPlugin одного плагина не трогает других', () => {
    const a = nextId();
    const b = nextId();
    try {
        hooks.registerOpdsPageMutator(a, 'a1', () => {});
        hooks.registerOpdsPageMutator(b, 'b1', () => {});

        hooks.unregisterPlugin(a);

        const s = hooks.snapshot();
        assert.strictEqual(s.opdsPageMutators.length, 1);
        assert.strictEqual(s.opdsPageMutators[0].pluginId, b);
    } finally {
        cleanup(a, b);
    }
});

test('hooks: unregisterPlugin(PLUGIN_CORE) — no-op', () => {
    const id = nextId();
    try {
        hooks.registerOpdsPageMutator(id, 'x', () => {});
        hooks.unregisterPlugin(hooks.PLUGIN_CORE);
        const s = hooks.snapshot();
        assert.strictEqual(s.opdsPageMutators.length, 1);
    } finally {
        cleanup(id);
    }
});

// ---------------------------------------------------------------------------
// runOpdsPageMutators
// ---------------------------------------------------------------------------

test('runOpdsPageMutators: порядок регистрации', async () => {
    const id = nextId();
    try {
        const order = [];
        hooks.registerOpdsPageMutator(id, 'first', async (c) => { order.push('first'); return c; });
        hooks.registerOpdsPageMutator(id, 'second', async (c) => { order.push('second'); return c; });

        await hooks.runOpdsPageMutators({entry: []}, {});
        assert.deepStrictEqual(order, ['first', 'second']);
    } finally {
        cleanup(id);
    }
});

test('runOpdsPageMutators: мутатор может мутировать in-place', async () => {
    const id = nextId();
    try {
        hooks.registerOpdsPageMutator(id, 'add', (c) => {
            c.entry.push({id: 'new'});
            // ничего не возвращает
        });

        const out = await hooks.runOpdsPageMutators({entry: []}, {});
        assert.strictEqual(out.entry.length, 1);
    } finally {
        cleanup(id);
    }
});

test('runOpdsPageMutators: мутатор может вернуть новый content', async () => {
    const id = nextId();
    try {
        hooks.registerOpdsPageMutator(id, 'replace', () => ({entry: [{id: 'x'}]}));

        const out = await hooks.runOpdsPageMutators({entry: []}, {});
        assert.strictEqual(out.entry.length, 1);
        assert.strictEqual(out.entry[0].id, 'x');
    } finally {
        cleanup(id);
    }
});

test('runOpdsPageMutators: изоляция ошибок (один упал — остальные работают)', async () => {
    const id = nextId();
    try {
        const order = [];
        hooks.registerOpdsPageMutator(id, 'boom', async () => { order.push('boom'); throw new Error('boom'); });
        hooks.registerOpdsPageMutator(id, 'ok', (c) => { order.push('ok'); return c; });

        const out = await hooks.runOpdsPageMutators({entry: []}, {});
        assert.deepStrictEqual(order, ['boom', 'ok']);   // второй отработал после ошибки
        assert.ok(out);   // content не потерян
    } finally {
        cleanup(id);
    }
});

test('runOpdsPageMutators: ctx проксируется в мутатор', async () => {
    const id = nextId();
    try {
        let seen = null;
        hooks.registerOpdsPageMutator(id, 'peek', (c, ctx) => { seen = ctx; return c; });

        await hooks.runOpdsPageMutators({entry: []}, {req: 'R', page: 'P', id: 'book'});
        assert.deepStrictEqual(seen, {req: 'R', page: 'P', id: 'book'});
    } finally {
        cleanup(id);
    }
});

// ---------------------------------------------------------------------------
// runOpdsBookLinks
// ---------------------------------------------------------------------------

test('runOpdsBookLinks: мерж от нескольких плагинов', async () => {
    const a = nextId();
    const b = nextId();
    try {
        hooks.registerOpdsBookLinks(a, 'a', async () => [{href: '/a', title: 'A'}]);
        hooks.registerOpdsBookLinks(b, 'b', async () => [{href: '/b', title: 'B'}]);

        const links = await hooks.runOpdsBookLinks({uid: 'u1'});
        assert.strictEqual(links.length, 2);
        assert.deepStrictEqual(links.map(l => l.href), ['/a', '/b']);
    } finally {
        cleanup(a, b);
    }
});

test('runOpdsBookLinks: undefined и пустой массив — пропускаются', async () => {
    const id = nextId();
    try {
        hooks.registerOpdsBookLinks(id, 'empty', async () => []);
        hooks.registerOpdsBookLinks(id, 'undef', async () => undefined);
        hooks.registerOpdsBookLinks(id, 'link', async () => [{href: '/x', title: 'X'}]);

        const links = await hooks.runOpdsBookLinks({uid: 'u1'});
        assert.strictEqual(links.length, 1);
    } finally {
        cleanup(id);
    }
});

test('runOpdsBookLinks: ссылка без href отбрасывается', async () => {
    const id = nextId();
    try {
        hooks.registerOpdsBookLinks(id, 'bad', async () => [
            {title: 'no-href'},
            {href: '/ok', title: 'ok'},
        ]);
        const links = await hooks.runOpdsBookLinks({uid: 'u1'});
        assert.strictEqual(links.length, 1);
        assert.strictEqual(links[0].href, '/ok');
    } finally {
        cleanup(id);
    }
});

test('runOpdsBookLinks: изоляция ошибок', async () => {
    const id = nextId();
    try {
        hooks.registerOpdsBookLinks(id, 'boom', async () => { throw new Error('boom'); });
        hooks.registerOpdsBookLinks(id, 'ok', async () => [{href: '/x', title: 'X'}]);

        const links = await hooks.runOpdsBookLinks({uid: 'u1'});
        assert.strictEqual(links.length, 1);
    } finally {
        cleanup(id);
    }
});

// ---------------------------------------------------------------------------
// runWebBookLinks / runWebBookLinksBatch
// ---------------------------------------------------------------------------

test('runWebBookLinksBatch: контракт {uid, book} → {uid: [...]}', async () => {
    const id = nextId();
    try {
        hooks.registerWebBookLinks(id, 'x', async (items) => {
            const out = {};
            for (const {uid, book} of items)
                out[uid] = [{key: 'k', title: `T ${book.title}`, href: '/x'}];
            return out;
        });

        const items = [
            {uid: 'u1', book: {title: 'A'}},
            {uid: 'u2', book: {title: 'B'}},
        ];
        const result = await hooks.runWebBookLinksBatch(items);

        assert.strictEqual(result.u1[0].title, 'T A');
        assert.strictEqual(result.u2[0].title, 'T B');
    } finally {
        cleanup(id);
    }
});

test('runWebBookLinksBatch: мерж от нескольких плагинов по uid', async () => {
    const a = nextId();
    const b = nextId();
    try {
        hooks.registerWebBookLinks(a, 'a', async (items) => {
            const out = {};
            for (const {uid} of items) out[uid] = [{key: 'a', title: 'A', href: '/a'}];
            return out;
        });
        hooks.registerWebBookLinks(b, 'b', async (items) => {
            const out = {};
            for (const {uid} of items) out[uid] = [{key: 'b', title: 'B', href: '/b'}];
            return out;
        });

        const result = await hooks.runWebBookLinksBatch([{uid: 'u1', book: null}]);
        assert.strictEqual(result.u1.length, 2);
        assert.deepStrictEqual(result.u1.map(i => i.key), ['a', 'b']);
    } finally {
        cleanup(a, b);
    }
});

test('runWebBookLinksBatch: плагин может вернуть Map', async () => {
    const id = nextId();
    try {
        hooks.registerWebBookLinks(id, 'map', async () => {
            return new Map([['u1', [{key: 'k', title: 'T', href: '/x'}]]]);
        });

        const result = await hooks.runWebBookLinksBatch([{uid: 'u1', book: null}]);
        assert.strictEqual(result.u1.length, 1);
    } finally {
        cleanup(id);
    }
});

test('runWebBookLinksBatch: пункты без key/title отбрасываются', async () => {
    const id = nextId();
    try {
        hooks.registerWebBookLinks(id, 'bad', async () => ({
            u1: [
                {title: 'no-key'},
                {key: 'k', title: 'ok', href: '/x'},
            ],
        }));
        const result = await hooks.runWebBookLinksBatch([{uid: 'u1', book: null}]);
        assert.strictEqual(result.u1.length, 1);
    } finally {
        cleanup(id);
    }
});

test('runWebBookLinksBatch: изоляция ошибок', async () => {
    const a = nextId();
    const b = nextId();
    try {
        hooks.registerWebBookLinks(a, 'boom', async () => { throw new Error('boom'); });
        hooks.registerWebBookLinks(b, 'ok', async () => ({u1: [{key: 'k', title: 'T', href: '/x'}]}));

        const result = await hooks.runWebBookLinksBatch([{uid: 'u1', book: null}]);
        assert.strictEqual(result.u1.length, 1);
    } finally {
        cleanup(a, b);
    }
});

test('runWebBookLinksBatch: пустой вход → {}', async () => {
    const id = nextId();
    try {
        hooks.registerWebBookLinks(id, 'x', async () => ({u1: [{key: 'k', title: 'T'}]}));
        assert.deepStrictEqual(await hooks.runWebBookLinksBatch([]), {});
        assert.deepStrictEqual(await hooks.runWebBookLinksBatch(null), {});
    } finally {
        cleanup(id);
    }
});

test('runWebBookLinks: per-book обёртка над batch', async () => {
    const id = nextId();
    try {
        hooks.registerWebBookLinks(id, 'x', async (items) => {
            const out = {};
            for (const {uid, book} of items)
                out[uid] = [{key: 'k', title: book.title, href: '/x'}];
            return out;
        });

        const items = await hooks.runWebBookLinks('u1', {title: 'Book'});
        assert.strictEqual(items.length, 1);
        assert.strictEqual(items[0].title, 'Book');
    } finally {
        cleanup(id);
    }
});

test('runWebBookLinks: uid без результата → []', async () => {
    const id = nextId();
    try {
        hooks.registerWebBookLinks(id, 'x', async () => ({}));
        const items = await hooks.runWebBookLinks('u1', {});
        assert.deepStrictEqual(items, []);
    } finally {
        cleanup(id);
    }
});