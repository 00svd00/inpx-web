const assert = require('node:assert');
const test = require('node:test');
const express = require('express');
const routes = require('../../server/core/routes');

function startApp() {
    const app = express();
    routes.mount(app, '/plugin');
    // error-handler, чтобы wrapAsync-ошибки отдавались как 500, а не падали
    app.use((err, req, res, next) => res.status(500).send('err: ' + err.message));
    return new Promise(resolve => {
        const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
    });
}

function url(srv, p) {
    return `http://127.0.0.1:${srv.address().port}${p}`;
}

test('routes: registerRoute + mount → handler вызывается', async () => {
    const srv = await startApp();
    try {
        routes.registerRoute('p1', '/hello', (req, res) => res.send('ok'));
        const r = await fetch(url(srv, '/plugin/p1/hello'));
        assert.strictEqual(r.status, 200);
        assert.strictEqual(await r.text(), 'ok');
    } finally {
        routes.unregisterPlugin('p1');
        srv.close();
    }
});

test('routes: разные pluginId — не пересекаются', async () => {
    const srv = await startApp();
    try {
        routes.registerRoute('a', '/x', (req, res) => res.send('A'));
        routes.registerRoute('b', '/x', (req, res) => res.send('B'));

        assert.strictEqual(await (await fetch(url(srv, '/plugin/a/x'))).text(), 'A');
        assert.strictEqual(await (await fetch(url(srv, '/plugin/b/x'))).text(), 'B');
        assert.strictEqual((await fetch(url(srv, '/plugin/c/x'))).status, 404);
    } finally {
        routes.unregisterPlugin('a');
        routes.unregisterPlugin('b');
        srv.close();
    }
});

test('routes: :param работает', async () => {
    const srv = await startApp();
    try {
        routes.registerRoute('p', '/user/:id', (req, res) => res.send('id=' + req.params.id));
        assert.strictEqual(await (await fetch(url(srv, '/plugin/p/user/42'))).text(), 'id=42');
    } finally {
        routes.unregisterPlugin('p');
        srv.close();
    }
});

test('routes: method POST — только POST', async () => {
    const srv = await startApp();
    try {
        routes.registerRoute('p', '/x', (req, res) => res.send('posted'), {method: 'POST'});
        assert.strictEqual((await fetch(url(srv, '/plugin/p/x'))).status, 404);
        assert.strictEqual(await (await fetch(url(srv, '/plugin/p/x'), {method: 'POST'})).text(), 'posted');
    } finally {
        routes.unregisterPlugin('p');
        srv.close();
    }
});

test('routes: unregisterPlugin → 404', async () => {
    const srv = await startApp();
    try {
        routes.registerRoute('p', '/x', (req, res) => res.send('ok'));
        assert.strictEqual((await fetch(url(srv, '/plugin/p/x'))).status, 200);
        routes.unregisterPlugin('p');
        assert.strictEqual((await fetch(url(srv, '/plugin/p/x'))).status, 404);
    } finally {
        routes.unregisterPlugin('p');
        srv.close();
    }
});

test('routes: async rejection → 500, не падает', async () => {
    const srv = await startApp();
    try {
        routes.registerRoute('p', '/boom', async () => { throw new Error('boom'); });
        const r = await fetch(url(srv, '/plugin/p/boom'));
        assert.strictEqual(r.status, 500);
        assert.ok((await r.text()).includes('boom'));
    } finally {
        routes.unregisterPlugin('p');
        srv.close();
    }
});

test('routes: method ALL — любой метод', async () => {
    const srv = await startApp();
    try {
        routes.registerRoute('p', '/any', (req, res) => res.send('any:' + req.method), {method: 'ALL'});
        assert.strictEqual(await (await fetch(url(srv, '/plugin/p/any'))).text(), 'any:GET');
        assert.strictEqual(await (await fetch(url(srv, '/plugin/p/any'), {method: 'POST'})).text(), 'any:POST');
    } finally {
        routes.unregisterPlugin('p');
        srv.close();
    }
});

test('routes: registerRoute — валидация (path без /, method, handler)', () => {
    assert.throws(() => routes.registerRoute('p', 'no-slash', () => {}), /must start with/);
    assert.throws(() => routes.registerRoute('p', '/x', null), /handler must be a function/);
    assert.throws(() => routes.registerRoute('p', '/x', () => {}, {method: 'FOO'}), /unsupported method/);
});

test('routes: snapshot показывает зарегистрированные', () => {
    routes.registerRoute('p', '/a', () => {});
    routes.registerRoute('p', '/b', () => {}, {method: 'POST'});
    try {
        const s = routes.snapshot();
        assert.deepStrictEqual(s.p, [
            {method: 'GET', path: '/a'},
            {method: 'POST', path: '/b'},
        ]);
    } finally {
        routes.unregisterPlugin('p');
    }
});