// Реестр HTTP-роутов плагинов. Singleton-модуль (как hooks.js).
//
// Namespace: /plugin/<pluginId>/<path>. Плагин не может зарегистрировать
// что-то вне своего namespace. Внутри — что угодно, плагин отвечает за path.
//
// Express 4 не умеет снимать routes (app._router.stack — внутренности).
// Решение: один dispatcher через app.use('/plugin'), плагин-роутеры
// лежат в Map. unregisterPlugin пересоздаёт router (старый уйдёт в GC).
//
// Auth — снаружи (server/index.js), симметрично /opds: если opds.password
// задан, basic-auth на /plugin.

const express = require('express');

const log = new (require('./AppLogger'))().log;//singleton

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'ALL']);

const registry = new Map(); // pluginId -> { router, routes: [{method, path}] }

function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wrapAsync(handler) {
    return async (req, res, next) => {
        try {
            await handler(req, res, next);
        } catch (e) {
            next(e);
        }
    };
}

function getOrCreate(pluginId) {
    let e = registry.get(pluginId);
    if (!e) {
        e = { router: express.Router(), routes: [] };
        registry.set(pluginId, e);
    }
    return e;
}

function registerRoute(pluginId, path, handler, opts = {}) {
    if (!pluginId || typeof pluginId !== 'string')
        throw new Error('registerRoute: pluginId is empty');
    if (typeof path !== 'string' || !path.startsWith('/'))
        throw new Error(`registerRoute: path must start with '/', got '${path}'`);
    if (typeof handler !== 'function')
        throw new Error('registerRoute: handler must be a function');

    const method = String(opts.method || 'GET').toUpperCase();
    if (!ALLOWED_METHODS.has(method))
        throw new Error(`registerRoute: unsupported method '${method}'`);

    const e = getOrCreate(pluginId);
    const wrapped = wrapAsync(handler);

    if (method === 'ALL')
        e.router.all(path, wrapped);
    else
        e.router[method.toLowerCase()](path, wrapped);

    e.routes.push({ method, path });
}

// Снять все роуты плагина. Пересоздаём router — Express не даёт clear().
// Старый router доработает in-flight запросы, новые — не увидят его.
function unregisterPlugin(pluginId) {
    const e = registry.get(pluginId);
    if (!e)
        return;
    e.router = express.Router();
    e.routes = [];
}

function hasRoutes(pluginId) {
    const e = registry.get(pluginId);
    return !!(e && e.routes.length);
}

function snapshot() {
    const out = {};
    for (const [id, e] of registry)
        if (e.routes.length)
            out[id] = e.routes.map(r => ({ method: r.method, path: r.path }));
    return out;
}

// Dispatcher. Использует req.originalUrl (полный путь + query),
// потому что app.use(basePath, ...) срезает basePath из req.path/req.url.
// req.url для plugin-роутера выставляется в plugin-относительный вид (/x?y),
// после чего восстанавливается в next().
function makeDispatcher(basePath) {
    const base = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
    const re = new RegExp(`^${escapeRegExp(base)}/([^/]+)(/.*)?(\\?.*)?$`);

    return (req, res, next) => {
        const url = req.originalUrl || req.url;
        const m = re.exec(url);
        if (!m)
            return next();

        let pluginId;
        try {
            pluginId = decodeURIComponent(m[1]);
        } catch (e) {
            return next(); // битый URL-encode
        }

        const e = registry.get(pluginId);
        if (!e)
            return next();

        const origUrl = req.url;
        req.url = (m[2] || '/') + (m[3] || '');

        e.router(req, res, (err) => {
            req.url = origUrl;
            next(err);
        });
    };
}

function mount(app, basePath = '/plugin') {
    app.use(basePath, makeDispatcher(basePath));
    log(`Plugin routes mounted at ${basePath}`);
}

module.exports = {
    registerRoute,
    unregisterPlugin,
    hasRoutes,
    snapshot,
    makeDispatcher,
    mount,
};