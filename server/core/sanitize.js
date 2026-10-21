const xss = require('xss');

// Явно опасные схемы — режем. mailto:/tel:/ftp: и относительные оставляем
// (легитимные ссылки в био авторов, например http://samlib.ru/...).
const UNSAFE_HREF = /^\s*(javascript|data|vbscript):/i;

// Единый профиль: dc:description (EPUB), рецензии, био авторов.
// Приоритет — читаемый текст без лишних тегов, а не защита от целевой XSS
// (контент из дампа библиотеки, не пользовательский ввод из веба).
const filter = new xss.FilterXSS({
    whiteList: {
        p: [], br: [], b: [], i: [], em: [], strong: [],
        ul: [], ol: [], li: [], blockquote: [], sub: [], sup: [],
        a: ['href', 'title'],
    },
    stripIgnoreTag: true,                    // теги вне whitelist — удалить (не экранировать)
    stripIgnoreTagBody: ['script', 'style'], // содержимое script/style — вырезать целиком
    allowCommentTag: false,
    safeAttrValue: (tag, name, value, cssFilter) => {
        if (tag === 'a' && name === 'href') {
            const v = String(value || '').trim();
            if (UNSAFE_HREF.test(v)) return '';
        }
        return xss.safeAttrValue(tag, name, value, cssFilter);
    },
});

// null/'' → как есть; не-строка → как есть (защита от неожиданных типов).
function sanitizeHtml(html) {
    if (typeof html !== 'string' || html.length === 0)
        return html;
    return filter.process(html);
}

module.exports = { sanitizeHtml };