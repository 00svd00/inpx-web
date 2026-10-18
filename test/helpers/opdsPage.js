const XmlParser = require('../../server/core/xml/XmlParser');
const { makeFakeWebWorker } = require('./fakeWebWorker');

// Создаёт «страницу» OPDS без конструктора BasePage
// (конструктор делает new WebWorker(config) — singleton + фоновые циклы).
// Прототип даёт реальные makeBody/escape/makeEntry/makeLink/navLink/downLink/
// imgLink/acqLink/baseLinks/addPlainNavLinks; XmlParser — реальный.
function makePage(PageClass, opts = {}) {
    const config = Object.assign({
        opdsRoot: '/opds',
        rootPathStatic: '',
        reviewsEnabled: true,
        authorsBioEnabled: true,
        opdsBookAddonsInCard: true,
        external: {},
    }, opts.config || {});

    const page = Object.assign(Object.create(PageClass.prototype), {
        config,
        webWorker: opts.webWorker || makeFakeWebWorker(),
        rootTag: 'feed',
        opdsRoot: config.opdsRoot,
        showDeleted: false,
    });

    page.id = opts.id || 'test';
    page.title = opts.title || 'Test';

    return page;
}

// Разбор XML-ответа body() обратно в дерево (для проверок при необходимости)
function parseBody(xml) {
    const parser = new XmlParser();
    parser.fromString(xml);
    return parser;
}

module.exports = { makePage, parseBody };