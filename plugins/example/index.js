// Пример плагина для inpx-web.
// Демонстрирует контракт PluginApi (api.version = '1.0') и типовые сценарии.
// Плагин получает управление через start(api, config) и может остановиться через stop().
//
// Контракт:
//   api.version        — версия API ('1.0'); PluginManager сверяет major, но плагин может сам отказаться.
//   api.config         — безопасная копия конфига ядра (без accessPassword/remoteLib/server/opds/external).
//   api.dataDir        — dataDir ядра (для своих файлов).
//   api.pluginsDir     — каталог плагинов (для своих данных/кеша).
//   api.log(msg) / api.log(LM_WARN, msg) / api.log(LM_ERR, msg) — в общий лог ядра.
//   api.waitReady()    — ждёт готовности БД (server_busy → опрос, DB_NOT_READY → throw).
//   api.search(from, query)    — from: 'author'|'series'|'title'; → {found, totalFound}.
//   api.bookSearch(query)      — поиск по книгам; → {found, totalFound}.
//   api.getBookLink(uid)       — {link, libFolder, libFile, downFileName}; 404 → throw.
//   api.getBookInfo(uid)       — {bookInfo: {book, cover, bookInfo, ...}}; 404 → throw.
//   api.getGenreTree()         — {genreTree, langList, extList, inpxHash}.
//   api.getStats()             — {reviewsEnabled, authorsBioEnabled, inpxHash}.
//   api.getBookReviewsCount(uid) — {declaredCount, sum}; reviews_disabled/404 → throw.
//   api.getBookReviews(uid)      — полный результат (declaredCount, sum, reviews[], months[]); reviews_disabled/404 → throw.
//   api.getReviewLink(uid)       — {link} на <hash>.review; 404 → throw.
//   api.getBookAuthors(uid)      — [{name, hash, found}]; 404 → throw.
//   api.getAuthorBio(hash)       — HTML или null (authors_disabled → throw).
//   api.getAuthorPhoto(hash)     — {path, ext} или null.
//   api.getBioLink(hash)         — {link} (поставщик); 404 → throw.
//   api.getPhotoLink(hash)       — {link} (может быть .nophoto); authors_disabled → throw.
//   api.getAuthorPhotoMime(ext)  — MIME для фото (синхронный).
//   api.getFavorites(...) / getFavoriteUids / addFavorite / removeFavorite — избранное.
//
// Секреты: api.config НЕ содержит accessPassword/remoteLib/token; плагин не должен их ожидать.

module.exports = {
    async start(api, config) {
        // 1) версия контракта: PluginManager уже сверяет major, но плагин
        //    может отказаться стартовать при несовместимости.
        const major = String(api.version).split('.')[0];
        if (major !== '1') {
            api.log(LM_WARN, `[example] unsupported api.version=${api.version}, skip`);
            return;
        }

        // 2) api.config — безопасная копия конфига ядра; api.log — в общий лог ядра.
        api.log(`[example] core: ${api.config.name} v${api.config.version} (${api.config.branch}), dbVersion=${api.config.dbVersion}`);
        api.log(`[example] greeting: ${config.greeting || '(none)'}`);
        api.log(`[example] dataDir: ${api.dataDir}, pluginsDir: ${api.pluginsDir}`);

        // 3) waitReady: ждёт загрузки БД.
        //    В типичном сценарии БД уже готова к первому запросу пользователя;
        //    waitReady нужен, если плагин что-то делает сразу на старте.
        try {
            await api.waitReady({ timeoutMs: 60000 });
        } catch (e) {
            api.log(LM_ERR, `[example] waitReady failed: ${e.message}`);
            return;
        }

        // 4) getStats — сводка по БД.
        const stats = await api.getStats();
        api.log(`[example] stats: reviewsEnabled=${stats.reviewsEnabled}, authorsBioEnabled=${stats.authorsBioEnabled}, inpxHash=${stats.inpxHash.slice(0, 12)}…`);

        if (config.logStatsOnStart) {
            // 5) getGenreTree — дерево жанров + списки языков/расширений.
            const gt = await api.getGenreTree();
            api.log(`[example] genres: ${gt.genreTree.length} sections, langs: ${gt.langList.length}, exts: ${gt.extList.join(',')}`);
        }

        // 6) search — поиск по авторам/сериям/названиям.
        //    from: 'author'|'series'|'title'; query: {author|series|title, limit, offset}.
        try {
            const r = await api.search('author', { author: 'пушкин', limit: 3 });
            api.log(`[example] search author="пушкин": totalFound=${r.totalFound}`);
            for (const a of r.found)
                api.log(`  - ${a.author} (id=${a.id}, bookCount=${a.bookCount})`);
        } catch (e) {
            api.log(LM_ERR, `[example] search failed: ${e.message}`);
        }

        // 7) bookSearch — поиск по книгам.
        //    ВАЖНО: title ищется как подстрока (регистронезависимо).
        let sampleBook = null;
        try {
            const r = await api.bookSearch({ title: 'сказка о царе салтане', limit: 3 });
            api.log(`[example] bookSearch title="сказка о царе салтане": totalFound=${r.totalFound}`);
            for (const b of r.found) {
                api.log(`  - ${b.author} — ${b.title}`);
                if (!sampleBook) sampleBook = b;
            }
        } catch (e) {
            api.log(LM_ERR, `[example] bookSearch failed: ${e.message}`);
        }

        // 8) getBookLink / getBookInfo / рецензии / био — на первой найденной книге.
        //    ВАЖНО: getBookLink/getBookInfo/getAuthorBio материализуют файлы в кеше
        //    (public-files/book/, public-files/author/), periodicCleanDir подчистит.
        //    getBookReviewsCount/getBookReviews могут бросить 'reviews_disabled' в первые
        //    ~300 мс после waitReady (reviews_index открывается чуть позже) — плагин ловит.
        if (sampleBook && sampleBook._uid) {
            const uid = sampleBook._uid;

            try {
                const link = await api.getBookLink(uid);
                api.log(`[example] getBookLink: ${link.link} (${link.downFileName})`);
            } catch (e) {
                api.log(LM_ERR, `[example] getBookLink failed: ${e.message}`);
            }

            try {
                const info = await api.getBookInfo(uid);
                const bi = info.bookInfo || {};
                api.log(`[example] getBookInfo: cover=${!!bi.cover}, bookInfo=${!!bi.bookInfo}, title="${bi.book ? bi.book.title : ''}"`);
            } catch (e) {
                api.log(LM_ERR, `[example] getBookInfo failed: ${e.message}`);
            }

            // рецензии: счётчики — дёшево; полный список — тяжелее (материализация)
            try {
                const rc = await api.getBookReviewsCount(uid);
                api.log(`[example] getBookReviewsCount: declaredCount=${rc.declaredCount}, sum=${rc.sum}`);

                if (config.loadFullReviews) {
                    const rv = await api.getBookReviews(uid);
                    api.log(`[example] getBookReviews: foundCount=${rv.foundCount}, months=${rv.months.length}`);
                }

                const rl = await api.getReviewLink(uid);
                api.log(`[example] getReviewLink: ${rl.link}`);
            } catch (e) {
                // reviews_disabled — нормально в первые ~300 мс, либо рецензии выключены
                api.log(LM_WARN, `[example] reviews skipped: ${e.message}`);
            }

            // био/фото авторов книги: getBookAuthors — дёшево (только authors_info),
            // getAuthorBio — материализует .bio (кеш), getPhotoLink — ссылка на фото/.nophoto.
            try {
                const authors = await api.getBookAuthors(uid);
                api.log(`[example] getBookAuthors: ${authors.length}`);
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
                // authors_disabled — если authorsBioEnabled=false
                api.log(LM_WARN, `[example] getBookAuthors skipped: ${e.message}`);
            }
        } else {
            api.log(LM_WARN, '[example] sample book not found, skip getBook* / reviews / bio');
        }

        api.log('[example] started');
    },

    async stop() {
        // stop() не имеет доступа к api — логируем через console (или сохраняем api в замыкании).
        // Для примера — просто console.log; в реальном плагине можно сохранить api в переменной модуля.
        console.log('[example] stopped');
    },
};