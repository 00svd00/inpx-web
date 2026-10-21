const test = require('node:test');
const assert = require('node:assert');
const { buildInfoList, buildDesc, defaultValueToString } = require('../../server/core/book/bookInfoMapping');

// минимальная bookInfo-структура (как Fb2Parser.bookInfo)
function bookInfo(overrides = {}) {
    return Object.assign({
        titleInfo: {
            author: ['Иванов Иван'],
            bookTitle: 'Название',
            sequence: [{name: 'Серия', num: '2', lang: null}],
            genre: ['sf', 'detective'],
            date: '2020-01-01',
            lang: 'ru',
            annotationHtml: '<p>Аннотация</p>',
        },
        publishInfo: {
            publisher: 'Издательство',
            city: 'Город',
            year: '2020',
            isbn: 'ISBN',
        },
        documentInfo: {
            id: 'id-1',
            programUsed: 'FB Tools',
        },
    }, overrides);
}

test('buildInfoList: titleInfo/publishInfo/documentInfo', () => {
    const info = buildInfoList(bookInfo());
    assert.ok(info.length);

    const titleInfo = info.find(i => i.name === 'titleInfo');
    assert.ok(titleInfo);
    assert.strictEqual(titleInfo.label, 'Общая информация');
    const names = titleInfo.value.map(v => v.name);
    assert.ok(names.includes('author'));
    assert.ok(names.includes('bookTitle'));
    assert.ok(names.includes('sequence'));
    assert.ok(names.includes('genre'));

    assert.ok(info.find(i => i.name === 'publishInfo'));
    assert.ok(info.find(i => i.name === 'documentInfo'));
});

test('buildInfoList: sequence → "name #num"', () => {
    const info = buildInfoList(bookInfo());
    const titleInfo = info.find(i => i.name === 'titleInfo');
    const seq = titleInfo.value.find(v => v.name === 'sequence');
    assert.strictEqual(seq.value, 'Серия #2');
});

test('buildInfoList: пустая bookInfo → []', () => {
    assert.deepStrictEqual(buildInfoList({}), []);
    assert.deepStrictEqual(buildInfoList(null), []);
    assert.deepStrictEqual(buildInfoList(undefined), []);
});

test('buildInfoList: valueToString опция', () => {
    const info = buildInfoList(bookInfo(), {
        valueToString: (value) => `X:${value}`,
    });
    const titleInfo = info.find(i => i.name === 'titleInfo');
    const author = titleInfo.value.find(v => v.name === 'author');
    assert.strictEqual(author.value, 'X:Иванов Иван');
});

test('buildInfoList: correctMapping опция', () => {
    const info = buildInfoList(bookInfo(), {
        correctMapping: (m) => m.filter(item => item.name === 'titleInfo'),
    });
    assert.strictEqual(info.length, 1);
    assert.strictEqual(info[0].name, 'titleInfo');
});

test('buildDesc: titleInfo → desc', () => {
    const desc = buildDesc(bookInfo());
    assert.strictEqual(desc.title, 'Название');
    assert.deepStrictEqual(desc.author, ['Иванов Иван']);
    assert.strictEqual(desc.series, 'Серия');
    assert.strictEqual(desc.seriesIndex, 2);
    assert.deepStrictEqual(desc.genre, ['sf', 'detective']);
    assert.strictEqual(desc.lang, 'ru');
    assert.strictEqual(desc.date, '2020-01-01');
    assert.strictEqual(desc.description, '<p>Аннотация</p>');
    assert.strictEqual(desc.identifier, 'id-1');
});

test('buildDesc: пустая/без titleInfo', () => {
    const desc = buildDesc({});
    assert.strictEqual(desc.title, '');
    assert.deepStrictEqual(desc.author, []);
    assert.strictEqual(desc.series, '');
    assert.strictEqual(desc.seriesIndex, null);
    assert.deepStrictEqual(desc.genre, []);
    assert.strictEqual(desc.lang, '');
    assert.strictEqual(desc.date, '');
    assert.strictEqual(desc.description, '');
    assert.strictEqual(desc.identifier, '');
});

test('buildDesc: без sequence → series/seriesIndex пусто', () => {
    const bi = bookInfo();
    delete bi.titleInfo.sequence;
    const desc = buildDesc(bi);
    assert.strictEqual(desc.series, '');
    assert.strictEqual(desc.seriesIndex, null);
});

test('defaultValueToString: строка/массив/объект', () => {
    assert.strictEqual(defaultValueToString('x'), 'x');
    assert.strictEqual(defaultValueToString(['a', 'b']), 'a, b');
    assert.strictEqual(defaultValueToString({a: 1}), '{"a":1}');
});