const { test } = require('node:test');
const assert = require('node:assert');

const { sanitizeHtml } = require('../../server/core/sanitize');

// Тесты покрывают НАШУ конфигурацию sanitizeHtml (whitelist, stripIgnoreTag,
// stripIgnoreTagBody, safeAttrValue/UNSAFE_HREF), а не поведение xss как таковое.
// Проверки на нормализацию <br/> → <br /> и прочие дефолты xss сознательно
// не включены: это ответственность библиотеки, а не наша логика.

test('sanitizeHtml: script вырезан вместе с содержимым (stripIgnoreTagBody)', () => {
    assert.equal(
        sanitizeHtml('<p>ok</p><script>alert(1)</script>'),
        '<p>ok</p>'
    );
});

test('sanitizeHtml: теги вне whitelist удалены, текст сохранён (stripIgnoreTag)', () => {
    assert.equal(sanitizeHtml('<div>текст</div>'), 'текст');
});

test('sanitizeHtml: атрибуты вне whitelist удалены, тег сохранён', () => {
    assert.equal(sanitizeHtml('<p onclick="x">t</p>'), '<p>t</p>');
});

test('sanitizeHtml: безопасная http-ссылка сохранена (safeAttrValue)', () => {
    assert.equal(
        sanitizeHtml('<a href="http://samlib.ru/l/lumi_j/">http://samlib.ru/l/lumi_j/</a>'),
        '<a href="http://samlib.ru/l/lumi_j/">http://samlib.ru/l/lumi_j/</a>'
    );
});

test('sanitizeHtml: javascript: href вырезан (UNSAFE_HREF)', () => {
    assert.equal(sanitizeHtml('<a href="javascript:alert(1)">x</a>'), '<a href>x</a>');
});

test('sanitizeHtml: пустая строка и не-строка возвращаются как есть', () => {
    assert.equal(sanitizeHtml(''), '');
    assert.equal(sanitizeHtml(null), null);
    assert.equal(sanitizeHtml(undefined), undefined);
});