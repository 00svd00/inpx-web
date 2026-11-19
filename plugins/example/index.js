// Пример плагина для inpx-web.
// Демонстрирует контракт PluginApi (api.version = '1.0') и все точки расширения:
//   - registerRoute(path, handler, opts)          — HTTP-роуты под /plugin/<id>/
//   - registerOpdsPageMutator(fn, name?)          — пост-обработка OPDS-feed (page-level)
//   - registerOpdsBookLinks(fn, name?)            — ссылки рядом с книгой в OPDS
//   - registerWebBookLinks(fn, name?)             — ссылки рядом с книгой в вебе
//
// apiVersion читается из package.json (PluginManager сверяет major).
// Секреты: api.config НЕ содержит accessPassword/remoteLib/token.

const NAME = 'example';

module.exports = {
    async start(api, config) {
        // 1) версия контракта
        const major = String(api.version).split('.')[0];
        if (major !== '1') {
            api.log(LM_WARN, `[${NAME}] unsupported api.version=${api.version}, skip`);
            return;
        }

        api.log(`[${NAME}] core: ${api.config.name} v${api.config.version} (${api.config.branch}), dbVersion=${api.config.dbVersion}`);
        api.log(`[${NAME}] greeting: ${config.greeting || '(none)'}`);
        api.log(`[${NAME}] dataDir: ${api.dataDir}, pluginsDir: ${api.pluginsDir}`);

        // 2) точки расширения — до waitReady (не зависят от БД)

        // 2a) HTTP-роуты: /plugin/example/hello (HTML) и /plugin/example/api/info (JSON)
        if (typeof api.registerRoute === 'function') {
            api.registerRoute('/hello', helloHandler(config), {method: 'GET'});
            api.registerRoute('/api/info', infoHandler(api), {method: 'GET'});
            api.registerRoute('/book', bookPageHandler(api), {method: 'GET'});
            api.registerRoute('/download', downloadHandler(api), {method: 'GET'});
            api.log(`[${NAME}] routes registered: /plugin/${NAME}/hello, /plugin/${NAME}/api/info`);
        } else {
            api.log(LM_WARN, `[${NAME}] api.registerRoute not available (need core 1.6.5+), skip`);
        }

        // 2b) OPDS page-мутатор: добавляет entry "About example" на страницу книги.
        //     Для ссылок рядом с книгой есть registerOpdsBookLinks (см. 2c) —
        //     не дублируем.
        if (typeof api.registerOpdsPageMutator === 'function') {
            api.registerOpdsPageMutator(addAboutEntry, `${NAME}-about`);
            api.log(`[${NAME}] opds-page-mutator registered`);
        } else {
            api.log(LM_WARN, `[${NAME}] api.registerOpdsPageMutator not available, skip`);
        }

        // 2c) ссылки рядом с книгой в OPDS
        if (typeof api.registerOpdsBookLinks === 'function') {
            api.registerOpdsBookLinks(async ({uid, bookInfo}) => {
                if (!uid)
                    return [];
                const title = (bookInfo && bookInfo.book && bookInfo.book.title) || uid;
                return [
                    {
                        // acquisition — работает во всех OPDS-ридерах
                        href: `/plugin/${NAME}/download?uid=${encodeURIComponent(uid)}`,
                        rel: 'http://opds-spec.org/acquisition',
                        type: 'application/fb2+zip',
                        title: `example: скачать fb2 (${title})`,
                    },
                    {
                        // alternate + text/html — «открыть в браузере» (KOReader и др.)
                        href: `/plugin/${NAME}/book?uid=${encodeURIComponent(uid)}`,
                        rel: 'alternate',
                        type: 'text/html',
                        title: 'example: о книге',
                    },
                ];
            }, `${NAME}-book-links`);
        }

        // 2d) ссылки рядом с книгой в вебе
        if (typeof api.registerWebBookLinks === 'function') {
            api.registerWebBookLinks(async (items) => {
                const result = {};
                for (const {uid, book} of items) {
                    if (!book)
                        continue;
                    const title = book.title || uid;
                    result[uid] = [{
                        key: 'example-reader',
                        title: 'example-reader',
                        hint: `Открыть «${title}» во внешнем ридере`,
                        href: `https://example.com/reader?uid=${encodeURIComponent(uid)}`,
                    }];
                }
                return result;
            }, `${NAME}-web-reader`);
            api.log(`[${NAME}] webBookLinks registered`);
        }
        // 3) waitReady — ждёт загрузки БД (для демо API ниже)
        try {
            await api.waitReady({ timeoutMs: 60000 });
        } catch (e) {
            api.log(LM_ERR, `[${NAME}] waitReady failed: ${e.message}`);
            return;
        }

        // 4) getStats
        const stats = await api.getStats();
        api.log(`[${NAME}] stats: reviewsEnabled=${stats.reviewsEnabled}, authorsBioEnabled=${stats.authorsBioEnabled}, inpxHash=${stats.inpxHash.slice(0, 12)}…`);

        if (config.logStatsOnStart) {
            const gt = await api.getGenreTree();
            api.log(`[${NAME}] genres: ${gt.genreTree.length} sections, langs: ${gt.langList.length}, exts: ${gt.extList.join(',')}`);
        }

        // 5) search
        try {
            const r = await api.search('author', { author: 'пушкин', limit: 3 });
            api.log(`[${NAME}] search author="пушкин": totalFound=${r.totalFound}`);
            for (const a of r.found)
                api.log(`  - ${a.author} (id=${a.id}, bookCount=${a.bookCount})`);
        } catch (e) {
            api.log(LM_ERR, `[${NAME}] search failed: ${e.message}`);
        }

        // 6) bookSearch
        let sampleBook = null;
        try {
            const r = await api.bookSearch({ title: 'сказка о царе салтане', limit: 3 });
            api.log(`[${NAME}] bookSearch title="сказка о царе салтане": totalFound=${r.totalFound}`);
            for (const b of r.found) {
                api.log(`  - ${b.author} — ${b.title}`);
                if (!sampleBook) sampleBook = b;
            }
        } catch (e) {
            api.log(LM_ERR, `[${NAME}] bookSearch failed: ${e.message}`);
        }

        // 7) на первой найденной книге
        if (sampleBook && sampleBook._uid) {
            const uid = sampleBook._uid;
            try {
                const link = await api.getBookLink(uid);
                api.log(`[${NAME}] getBookLink: ${link.link} (${link.downFileName})`);
            } catch (e) {
                api.log(LM_ERR, `[${NAME}] getBookLink failed: ${e.message}`);
            }
            try {
                const info = await api.getBookInfo(uid);
                const bi = info.bookInfo || {};
                api.log(`[${NAME}] getBookInfo: cover=${!!bi.cover}, bookInfo=${!!bi.bookInfo}, title="${bi.book ? bi.book.title : ''}"`);
            } catch (e) {
                api.log(LM_ERR, `[${NAME}] getBookInfo failed: ${e.message}`);
            }
            try {
                const rc = await api.getBookReviewsCount(uid);
                api.log(`[${NAME}] getBookReviewsCount: declaredCount=${rc.declaredCount}, sum=${rc.sum}`);
                if (config.loadFullReviews) {
                    const rv = await api.getBookReviews(uid);
                    api.log(`[${NAME}] getBookReviews: foundCount=${rv.foundCount}, months=${rv.months.length}`);
                }
                const rl = await api.getReviewLink(uid);
                api.log(`[${NAME}] getReviewLink: ${rl.link}`);
            } catch (e) {
                api.log(LM_WARN, `[${NAME}] reviews skipped: ${e.message}`);
            }
            try {
                const authors = await api.getBookAuthors(uid);
                api.log(`[${NAME}] getBookAuthors: ${authors.length}`);
                for (const a of authors) {
                    api.log(`  - ${a.name} (hash=${a.hash.slice(0, 12)}…, found=${a.found})`);
                    if (!a.found) continue;
                    try {
                        const bio = await api.getAuthorBio(a.hash);
                        const bioText = bio ? bio.replace(/<[^>]*>/g, '').slice(0, 80) : '';
                        api.log(`    bio: ${bio ? `${bioText}…` : '(none)'}`);
                    } catch (e) {
                        api.log(LM_WARN, `    bio failed: ${e.message}`);
                    }
                    try {
                        const pl = await api.getPhotoLink(a.hash);
                        api.log(`    photo: ${pl.link}`);
                    } catch (e) {
                        api.log(LM_WARN, `    photo failed: ${e.message}`);
                    }
                }
            } catch (e) {
                api.log(LM_WARN, `[${NAME}] getBookAuthors skipped: ${e.message}`);
            }
        } else {
            api.log(LM_WARN, `[${NAME}] sample book not found, skip getBook* / reviews / bio`);
        }

        api.log(`[${NAME}] started`);
    },

    async stop() {
        // PluginManager снимает хуки/роуты по pluginId автоматически
        console.log(`[${NAME}] stopped`);
    },
};

// ---- handlers ----

function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
        {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]
    ));
}

// GET /plugin/example/hello — HTML-страница
function helloHandler(config) {
    return async (req, res) => {
        const greeting = config.greeting || 'Hello from example plugin';
        const coreName = 'inpx-web';
        const now = new Date().toISOString();
        const html = `<!DOCTYPE html>
<html lang="ru">
<head><meta charset="utf-8"><title>example plugin</title></head>
<body>
    <h1>${escapeHtml(greeting)}</h1>
    <p>Это страница плагина <code>example</code> из ${escapeHtml(coreName)}.</p>
    <p>Серверное время: <code>${escapeHtml(now)}</code></p>
    <p>Пример API: <a href="api/info">api/info</a></p>
</body>
</html>`;
        res.type('text/html; charset=utf-8').send(html);
    };
}

// GET /plugin/example/api/info — JSON со сводкой из api ядра
function infoHandler(api) {
    return async (req, res) => {
        const stats = await api.getStats();
        res.type('application/json; charset=utf-8').send({
            plugin: NAME,
            apiVersion: api.version,
            core: {
                name: api.config.name,
                version: api.config.version,
                branch: api.config.branch,
                dbVersion: api.config.dbVersion,
            },
            stats,
            dataDir: api.dataDir,
        });
    };
}

// OPDS page-мутатор: добавляет entry "About example" на страницу книги.
// ctx — {req, page, id, title}; id === 'book' — это BookPage.
async function addAboutEntry(content, ctx) {
    if (!ctx || ctx.id !== 'book')
        return content;
    if (!Array.isArray(content.entry) || !content.entry.length)
        return content;

    const about = {
        id: 'example-about',
        title: 'About example plugin',
        link: [{'*ATTRS': {
            href: `/plugin/${NAME}/hello`,
            rel: 'related',
            type: 'text/html',
            title: 'example plugin page',
        }}],
        content: {'*ATTRS': {type: 'text'}, '*TEXT': 'Эта запись добавлена page-мутатором плагина example'},
    };

    content.entry = content.entry.concat([about]);
    return content;
}

// GET /plugin/example/book?uid=... — HTML-страница с инфой о книге
function bookPageHandler(api) {
    return async (req, res) => {
        const uid = req.query.uid;
        if (!uid)
            return res.status(400).type('text/plain').send('uid is required');

        let info;
        try {
            info = await api.getBookInfo(uid);
        } catch (e) {
            return res.status(404).type('text/plain').send(`book not found: ${e.message}`);
        }

        const bi = (info && info.bookInfo) || null;
        if (!bi || !bi.book)
            return res.status(404).type('text/plain').send('book not found');

        const book = bi.book;
        const title = book.title || '(без названия)';
        const author = book.author || '(автор неизвестен)';

        const html = `<!DOCTYPE html>
<html lang="ru">
<head><meta charset="utf-8"><title>${escapeHtml(title)} — example</title></head>
<body>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(author)}</p>
    <p>uid: <code>${escapeHtml(uid)}</code></p>
    <p><a href="download?uid=${encodeURIComponent(uid)}">Скачать fb2 (zip)</a></p>
    <p><a href="hello">← hello</a></p>
</body>
</html>`;
        res.type('text/html; charset=utf-8').send(html);
    };
}

// GET /plugin/example/download?uid=... — отдаёт файл книги (fb2 zip)
function downloadHandler(api) {
    return async (req, res) => {
        const uid = req.query.uid;
        if (!uid)
            return res.status(400).type('text/plain').send('uid is required');

        let file;
        try {
            file = await api.getBookFile(uid, {format: 'zip'});
        } catch (e) {
            return res.status(404).type('text/plain').send(`file not found: ${e.message}`);
        }

        res.type(file.mime || 'application/zip');
        res.set('Content-Disposition',
            `inline; filename*=UTF-8''${encodeURIComponent(file.filename || 'book.fb2.zip')}`);
        res.sendFile(file.path);
    };
}