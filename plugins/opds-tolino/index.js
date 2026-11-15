// inpx-web plugin: opds-tolino
//
// Tolino (и некоторые другие читалки) ходят по записи только через ссылку без rel.
// С 1.6.5 этот фикс вынесен из ядра в плагин: без него OPDS-каталог отдаёт
// только rel="subsection", и Tolino не сможет открыть запись.
//
// Если пользуетесь Tolino — включите плагин. Остальным он не нужен.
//
// Идемпотентен (no-op, если plain-ссылка уже есть) — защита от двойной
// регистрации, например при hot-reload.

const NAME = 'opds-tolino';

module.exports = {
    async start(api, config) {
        const major = String(api.version).split('.')[0];
        if (major !== '1') {
            api.log(LM_WARN, `[${NAME}] unsupported api.version=${api.version}, skip`);
            return;
        }

        if (typeof api.registerOpdsPageMutator !== 'function') {
            api.log(LM_WARN, `[${NAME}] api.registerOpdsPageMutator not available (need core 1.6.5+), skip`);
            return;
        }

        api.registerOpdsPageMutator(applyTolinoPlainNavLinks, NAME);
        api.log(`[${NAME}] registered opds-page-mutator`);
    },

    async stop() {
        // PluginManager снимает хуки по pluginId автоматически
        console.log(`[${NAME}] stopped`);
    },

    applyTolinoPlainNavLinks,
};

// Идемпотентен: если plain-ссылка уже есть — no-op.
function applyTolinoPlainNavLinks(content) {
    const entries = (Array.isArray(content.entry) ? content.entry : (content.entry ? [content.entry] : []));

    for (const entry of entries) {
        if (!entry.link)
            continue;

        const links = (Array.isArray(entry.link) ? entry.link : [entry.link]);
        const nav = links.find(l => l['*ATTRS'] && l['*ATTRS'].rel === 'subsection');

        if (!nav || links.some(l => l['*ATTRS'] && !l['*ATTRS'].rel))
            continue;

        const attrs = Object.assign({}, nav['*ATTRS']);
        delete attrs.rel;
        entry.link = links.concat([{'*ATTRS': attrs}]);
    }
}