// Реестр точек расширения PluginApi. Singleton-модуль без зависимости от
// PluginManager — чтобы страницы (BasePage/BookPage) и WebSocketController
// могли импортировать реестр напрямую, без циклов.
//
// Три точки расширения с двумя семантиками:
//   - opdsPageMutators  — пост-обработка готового content в BasePage.makeBody
//                         (page-level: tolino-фикс и т.п.). Пуст по умолчанию;
//                         tolino-фикс в 1.6.5 вынесен в плагин opds-tolino.
//   - opdsBookLinks     — ссылки рядом с книгой в OPDS (BookPage.body)
//   - webBookLinks      — ссылки рядом с книгой в вебе (WS get-book-links)
//
// Порядок — по регистрации. Плагины регистрируются при start();
// снимаются при stopAll()/unregisterPlugin(). Ошибки обработчика изолированы:
// логируются, цепочка продолжается.

const log = new (require('./AppLogger'))().log;//singleton

const PLUGIN_CORE = '__core__';

const opdsPageMutators = [];
const opdsBookLinks = [];
const webBookLinks = [];

// ---- регистрация ----
function registerOpdsPageMutator(pluginId, name, fn) {
    if (typeof fn !== 'function')
        throw new Error('registerOpdsPageMutator: fn must be a function');
    opdsPageMutators.push({pluginId, name: name || fn.name || 'anonymous', fn});
}

function registerOpdsBookLinks(pluginId, name, fn) {
    if (typeof fn !== 'function')
        throw new Error('registerOpdsBookLinks: fn must be a function');
    opdsBookLinks.push({pluginId, name: name || fn.name || 'anonymous', fn});
}

function registerWebBookLinks(pluginId, name, fn) {
    if (typeof fn !== 'function')
        throw new Error('registerWebBookLinks: fn must be a function');
    webBookLinks.push({pluginId, name: name || fn.name || 'anonymous', fn});
}

// Снять все хуки плагина. Built-in (__core__) не трогаем.
function unregisterPlugin(pluginId) {
    if (pluginId === PLUGIN_CORE)
        return;
    for (const arr of [opdsPageMutators, opdsBookLinks, webBookLinks]) {
        for (let i = arr.length - 1; i >= 0; i--) {
            if (arr[i].pluginId === pluginId)
                arr.splice(i, 1);
        }
    }
}

// ---- наличие ----
function hasOpdsBookLinks() { return opdsBookLinks.length > 0; }
function hasWebBookLinks()  { return webBookLinks.length > 0; }

// ---- вызов ----
async function runOpdsPageMutators(content, ctx) {
    let cur = content;
    for (const {pluginId, name, fn} of opdsPageMutators) {
        try {
            const out = await fn(cur, ctx);
            if (out && typeof out === 'object')
                cur = out;
        } catch (e) {
            log(LM_ERR, `hook ${pluginId}/${name} (opdsPageMutator) failed: ${e && e.message ? e.message : e}`);
        }
    }
    return cur;
}

async function runOpdsBookLinks(ctx) {
    const result = [];
    for (const {pluginId, name, fn} of opdsBookLinks) {
        try {
            const out = await fn(ctx);
            if (Array.isArray(out))
                for (const l of out)
                    if (l && l.href)
                        result.push(l);
        } catch (e) {
            log(LM_ERR, `hook ${pluginId}/${name} (opdsBookLinks) failed: ${e && e.message ? e.message : e}`);
        }
    }
    return result;
}

async function runWebBookLinks(ctx) {
    const result = [];
    for (const {pluginId, name, fn} of webBookLinks) {
        try {
            const out = await fn(ctx);
            if (Array.isArray(out))
                for (const it of out)
                    if (it && it.key && it.title)
                        result.push(it);
        } catch (e) {
            log(LM_ERR, `hook ${pluginId}/${name} (webBookLinks) failed: ${e && e.message ? e.message : e}`);
        }
    }
    return result;
}

function snapshot() {
    return {
        opdsPageMutators: opdsPageMutators.map(h => ({pluginId: h.pluginId, name: h.name})),
        opdsBookLinks:    opdsBookLinks.map(h => ({pluginId: h.pluginId, name: h.name})),
        webBookLinks:     webBookLinks.map(h => ({pluginId: h.pluginId, name: h.name})),
    };
}

module.exports = {
    PLUGIN_CORE,
    registerOpdsPageMutator,
    registerOpdsBookLinks,
    registerWebBookLinks,
    unregisterPlugin,
    hasOpdsBookLinks,
    hasWebBookLinks,
    runOpdsPageMutators,
    runOpdsBookLinks,
    runWebBookLinks,
    snapshot,
};