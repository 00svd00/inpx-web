const test = require('node:test');
const assert = require('node:assert');
const BasePage = require('../../server/core/opds/BasePage');

// Без конструктора (new WebWorker(config) не нужен для чистых методов).
function makePage(opts = {}) {
    const page = Object.assign(Object.create(BasePage.prototype), {
        config: opts.config || {},
        webWorker: opts.webWorker || {},
        rootTag: 'feed',
        opdsRoot: opts.opdsRoot || '/opds',
        showDeleted: !!opts.showDeleted,
    });
    page.id = opts.id || 'test';
    page.title = opts.title || 'Test';
    return page;
}

// --- escape ---------------------------------------------------------------

test('escape: &#x27; → &#39;, &#x60; → &#96; (koreader)', () => {
    const page = makePage();
    assert.strictEqual(page.escape("a'b`c"), 'a&#39;b&#96;c');
});

// --- makeEntry / makeLink -------------------------------------------------

test('makeEntry: id/title обязательны, updated есть', () => {
    const page = makePage();
    assert.throws(() => page.makeEntry({title: 'x'}), /no id/);
    assert.throws(() => page.makeEntry({id: 'x'}), /no title/);
    const e = page.makeEntry({id: 'x', title: 'T'});
    assert.strictEqual(e.id, 'x');
    assert.strictEqual(e.title, 'T');
    assert.match(e.updated, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
});

test('makeLink/navLink/acqLink: hrefAsIs vs opdsRoot', () => {
    const page = makePage({opdsRoot: '/opds'});

    const nav = page.navLink({href: '/root'});
    assert.strictEqual(nav['*ATTRS'].href, '/opds/root');
    assert.strictEqual(nav['*ATTRS'].rel, 'subsection');
    assert.match(nav['*ATTRS'].type, /atom\+xml/);

    const navAsIs = page.navLink({href: '/x', hrefAsIs: true});
    assert.strictEqual(navAsIs['*ATTRS'].href, '/x');

    const acq = page.acqLink({href: '/y', hrefAsIs: true});
    assert.strictEqual(acq['*ATTRS'].href, '/y');
    assert.match(acq['*ATTRS'].type, /atom\+xml/);
});

test('downLink: href/type обязательны, title опционален', () => {
    const page = makePage();
    assert.throws(() => page.downLink({type: 'application/fb2'}), /no href/);
    assert.throws(() => page.downLink({href: '/x'}), /no type/);
    const l = page.downLink({href: '/x', type: 'application/fb2', title: 'T'});
    assert.strictEqual(l['*ATTRS'].href, '/x');
    assert.strictEqual(l['*ATTRS'].rel, 'http://opds-spec.org/acquisition');
    assert.strictEqual(l['*ATTRS'].title, 'T');
});

test('imgLink: href обязателен, rel image/thumbnail', () => {
    const page = makePage();
    assert.throws(() => page.imgLink({}), /no href/);
    const img = page.imgLink({href: '/i.jpg', type: 'image/jpeg'});
    assert.strictEqual(img['*ATTRS'].rel, 'http://opds-spec.org/image');
    const thumb = page.imgLink({href: '/i.jpg', thumb: true});
    assert.strictEqual(thumb['*ATTRS'].rel, 'http://opds-spec.org/image/thumbnail');
});

// --- bookAuthor -----------------------------------------------------------

test('bookAuthor: 1–3 автора, >3 → «и др.»', () => {
    const page = makePage();
    assert.strictEqual(page.bookAuthor(''), '');
    assert.strictEqual(page.bookAuthor('A'), 'A');
    assert.strictEqual(page.bookAuthor('A,B'), 'A, B');
    assert.strictEqual(page.bookAuthor('A,B,C'), 'A, B, C');
    assert.strictEqual(page.bookAuthor('A,B,C,D,E'), 'A, B, C и др.');
});

// --- addPlainNavLinks -----------------------------------------------------

test('addPlainNavLinks: дублирует subsection без rel', () => {
    const page = makePage();
    const content = {
        entry: [{
            id: 'x', title: 'X',
            link: [
                {'*ATTRS': {href: '/x', rel: 'subsection', type: 'application/atom+xml;profile=opds-catalog'}},
                {'*ATTRS': {href: '/d', rel: 'http://opds-spec.org/acquisition', type: 'application/fb2'}},
            ],
        }],
    };
    page.addPlainNavLinks(content);
    const links = content.entry[0].link;
    assert.strictEqual(links.length, 3);
    const plain = links[2]['*ATTRS'];
    assert.strictEqual(plain.href, '/x');
    assert.strictEqual(plain.rel, undefined);
});

test('addPlainNavLinks: не дублирует, если уже есть ссылка без rel', () => {
    const page = makePage();
    const content = {
        entry: [{
            id: 'x', title: 'X',
            link: [
                {'*ATTRS': {href: '/x', rel: 'subsection'}},
                {'*ATTRS': {href: '/x'}},
            ],
        }],
    };
    page.addPlainNavLinks(content);
    assert.strictEqual(content.entry[0].link.length, 2);
});

// --- filterBooks ----------------------------------------------------------

function book(over = {}) {
    return Object.assign({
        author: 'Иванов Иван',
        title: 'Книга',
        series: '',
        genre: 'sf',
        lang: 'ru',
        date: '2024-01-01',
        librate: 0,
        del: 0,
    }, over);
}

test('filterBooks: обычный (равенство через localeCompare-диапазон)', () => {
    const page = makePage();
    const books = [book(), book({title: 'Другая'})];
    assert.strictEqual(page.filterBooks(books, {title: 'Книга'}).length, 1);
});

test('filterBooks: = (точное совпадение)', () => {
    const page = makePage();
    const books = [book({title: 'Книга'}), book({title: 'Книга 2'})];
    assert.strictEqual(page.filterBooks(books, {title: '=Книга'}).length, 1);
    assert.strictEqual(page.filterBooks(books, {title: '=Книга 2'}).length, 1);
});

test('filterBooks: % (группа подстрок через пробел, любая совпала)', () => {
    const page = makePage();
    const books = [
        book({title: 'Война и мир'}),
        book({title: 'Мир и война'}),
        book({title: 'Тихий дон'}),
    ];
    assert.strictEqual(page.filterBooks(books, {title: '%война мир'}).length, 2);
    assert.strictEqual(page.filterBooks(books, {title: '%дон'}).length, 1);
    assert.strictEqual(page.filterBooks(books, {title: '%zzz'}).length, 0);
});

test('filterBooks: * (подстрока)', () => {
    const page = makePage();
    const books = [book({title: 'Книга про войну'}), book({title: 'Мир'})];
    assert.strictEqual(page.filterBooks(books, {title: '*войн'}).length, 1);
});

test('filterBooks: # (подстрока, не начиная с латиницы/кириллицы)', () => {
    const page = makePage();
    const books = [book({title: '123abc'}), book({title: 'abc123'})];
    assert.strictEqual(page.filterBooks(books, {title: '#abc'}).length, 1);
});

test('filterBooks: ~ (regexp)', () => {
    const page = makePage();
    const books = [book({title: 'Книга 1'}), book({title: 'Книга 2'})];
    assert.strictEqual(page.filterBooks(books, {title: '~^Книга \\d$'}).length, 2);
    assert.strictEqual(page.filterBooks(books, {title: '~^Книга 1$'}).length, 1);
});

test('filterBooks: удалённые скрыты, showDeleted показывает', () => {
    const books = [book({del: 0}), book({del: 1, title: 'Удалённая'})];
    const page = makePage();
    assert.strictEqual(page.filterBooks(books, {}).length, 1);
    const pageDel = makePage({showDeleted: true});
    assert.strictEqual(pageDel.filterBooks(books, {}).length, 2);
});