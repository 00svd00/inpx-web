// Единый источник истины «bookInfo (fb2/epub-структура) → info-массив / desc».
// Используется Fb2Parser.bookInfoList, EpubParser.bookInfoList, клиентом (buildInfoList)
// и OPDS/BookPage (buildInfoList / buildDesc).

// mapping — какие поля показывать (label/value). Структура — как Fb2Parser.bookInfo().
const mapping = [
    {name: 'titleInfo', label: 'Общая информация', value: [
        {name: 'author', label: 'Автор(ы)'},
        {name: 'bookTitle', label: 'Название'},
        {name: 'sequence', label: 'Серия'},
        {name: 'genre', label: 'Жанр'},
        {name: 'date', label: 'Дата'},
        {name: 'lang', label: 'Язык книги'},
        {name: 'srcLang', label: 'Язык оригинала'},
        {name: 'translator', label: 'Переводчик(и)'},
        {name: 'keywords', label: 'Ключевые слова'},
    ]},
    {name: 'srcTitleInfo', label: 'Информация о произведении на языке оригинала', value: [
        {name: 'author', label: 'Автор(ы)'},
        {name: 'bookTitle', label: 'Название'},
        {name: 'sequence', label: 'Серия'},
        {name: 'genre', label: 'Жанр'},
        {name: 'date', label: 'Дата'},
        {name: 'lang', label: 'Язык книги'},
        {name: 'srcLang', label: 'Язык оригинала'},
        {name: 'translator', label: 'Переводчик(и)'},
        {name: 'keywords', label: 'Ключевые слова'},
    ]},
    {name: 'publishInfo', label: 'Издательская информация', value: [
        {name: 'bookName', label: 'Название'},
        {name: 'publisher', label: 'Издательство'},
        {name: 'city', label: 'Город'},
        {name: 'year', label: 'Год'},
        {name: 'isbn', label: 'ISBN'},
        {name: 'sequence', label: 'Серия'},
    ]},
    {name: 'documentInfo', label: 'Информация о документе (OCR)', value: [
        {name: 'author', label: 'Автор(ы)'},
        {name: 'programUsed', label: 'Программа'},
        {name: 'date', label: 'Дата'},
        {name: 'id', label: 'ID'},
        {name: 'version', label: 'Версия'},
        {name: 'srcOcr', label: 'Автор источника'},
        {name: 'historyHtml', label: 'История'},
        {name: 'publisher', label: 'Правообладатели'},
    ]},
];

// значение → строка (sequence → "name #num", массив → join, объект → JSON)
function defaultValueToString(value) {
    if (typeof(value) === 'string')
        return value;
    if (Array.isArray(value))
        return value.join(', ');
    if (value && typeof(value) === 'object')
        return JSON.stringify(value);
    return value;
}

// valueToString с sequence-спецификой (как Fb2Parser.myValueToString)
function myValueToString(value, nodePath, origVTS) {//eslint-disable-line no-unused-vars
    if (nodePath == 'titleInfo/sequence'
        || nodePath == 'srcTitleInfo/sequence'
        || nodePath == 'publishInfo/sequence')
        return value.map(v => [v.name, v.num].filter(s => s).join(' #')).join(', ');
    return defaultValueToString(value);
}

// bookInfo (структура) → info-массив (label/value)
// opts: {correctMapping, valueToString}
function buildInfoList(bookInfo, options = {}) {
    let {correctMapping = false, valueToString = false} = options;

    if (!correctMapping)
        correctMapping = m => m;
    if (!valueToString)
        valueToString = myValueToString;

    const map = correctMapping(mapping);

    let result = [];
    for (const item of map) {
        const itemOut = {name: item.name, label: item.label, value: []};
        const info = bookInfo && bookInfo[item.name];
        if (!info)
            continue;

        for (const subItem of item.value) {
            if (info[subItem.name] !== null && info[subItem.name] !== undefined) {
                const subItemOut = {
                    name: subItem.name,
                    label: subItem.label,
                    value: valueToString(info[subItem.name], `${item.name}/${subItem.name}`, myValueToString),
                };
                if (subItemOut.value)
                    itemOut.value.push(subItemOut);
            }
        }

        if (itemOut.value.length)
            result.push(itemOut);
    }

    return result;
}

// bookInfo (структура) → desc (общая схема)
function buildDesc(bookInfo) {
    const ti = (bookInfo && bookInfo.titleInfo) || {};
    const seq = (ti.sequence && ti.sequence[0]) || null;

    return {
        title: ti.bookTitle || '',
        author: ti.author || [],
        series: seq ? (seq.name || '') : '',
        seriesIndex: seq ? (parseInt(seq.num, 10) || null) : null,
        genre: ti.genre || [],
        lang: ti.lang || '',
        date: ti.date || '',
        description: ti.annotationHtml || '',
        identifier: (bookInfo && bookInfo.documentInfo && bookInfo.documentInfo.id) || '',
    };
}

module.exports = {
    mapping,
    valueToString: myValueToString,
    defaultValueToString,
    buildInfoList,
    buildDesc,
};