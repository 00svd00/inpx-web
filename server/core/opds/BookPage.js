const path = require('path');
const _ = require('lodash');
const dayjs = require('dayjs');
const hooks = require('../hooks');

const BasePage = require('./BasePage');
const { buildInfoList } = require('../book/bookInfoMapping');
const { bookFormats } = require('../book/bookFormats');
const { isAvailable } = require('../externalTools');
const { canonicalGenre } = require('../genres/genreUtils');
const { collectBookLinks, makeNavToRelated } = require('./bookLinks');

class BookPage extends BasePage {
    constructor(config) {
        super(config);

        this.id = 'book';
        this.title = 'Книга';

    }

    formatSize(size) {
        size = size/1024;
        let unit = 'KB';
        if (size > 1024) {
            size = size/1024;
            unit = 'MB';
        }
        return `${size.toFixed(1)} ${unit}`;
    }

    convertGenres(genreArr) {
        let result = [];
        if (genreArr) {
            for (const genre of genreArr) {
                const g = genre.trim();
                const canonical = canonicalGenre(g);
                const name = this.genreMap.get(canonical);
                result.push(name ? name : canonical);
            }
        }
        return result.join(', ');
    }

    // навигационные ссылки «другие книги автора/серии» (первый автор, первая серия)
    navToRelated(book) {
        return makeNavToRelated(book);
    }

    inpxInfo(bookRec) {
        const mapping = [
            {name: 'fileInfo', label: 'Информация о файле', value: [
                {name: 'folder', label: 'Папка'},
                {name: 'file', label: 'Файл'},
                {name: 'size', label: 'Размер'},
                {name: 'date', label: 'Добавлен'},
                {name: 'del', label: 'Удален'},
                {name: 'libid', label: 'LibId'},
                {name: 'insno', label: 'InsideNo'},
            ]},

            {name: 'titleInfo', label: 'Общая информация', value: [
                {name: 'author', label: 'Автор(ы)'},
                {name: 'title', label: 'Название'},
                {name: 'series', label: 'Серия'},
                {name: 'genre', label: 'Жанр'},
                {name: 'librate', label: 'Оценка'},
                {name: 'lang', label: 'Язык книги'},
                {name: 'keywords', label: 'Ключевые слова'},
            ]},
        ];

        const valueToString = (value, nodePath, b) => {//eslint-disable-line no-unused-vars
            if (nodePath == 'fileInfo/file')
                return `${value}.${b.ext}`;

            if (nodePath == 'fileInfo/size')
                return `${this.formatSize(value)} (${value.toString().replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1 ')} Bytes)`;

            if (nodePath == 'fileInfo/date')
                return dayjs(value, 'YYYY-MM-DD').format('DD.MM.YYYY');

            if (nodePath == 'fileInfo/del')
                return (value ? 'Да' : null);

            if (nodePath == 'fileInfo/insno')
                return (value ? value : null);

            if (nodePath == 'titleInfo/author')
                return value.split(',').join(', ');

            if (nodePath == 'titleInfo/genre')
                return this.convertGenres(value.split(','));

            if (nodePath == 'titleInfo/librate' && !value)
                return null;

            if (typeof(value) === 'string') {
                return value;
            }

            return (value.toString ? value.toString() : '');
        };

        let result = [];
        const book = _.cloneDeep(bookRec);
        book.series = [book.series, book.serno].filter(v => v).join(' #');

        for (const item of mapping) {
            const itemOut = {name: item.name, label: item.label, value: []};

            for (const subItem of item.value) {
                const subItemOut = {
                    name: subItem.name,
                    label: subItem.label,
                    value: valueToString(book[subItem.name], `${item.name}/${subItem.name}`, book)
                };
                if (subItemOut.value)
                    itemOut.value.push(subItemOut);
            }

            if (itemOut.value.length)
                result.push(itemOut);
        }

        return result;
    }    

    htmlInfo(title, infoList) {
        let info = '';
        for (const part of infoList) {
            if (part.value.length)
                info += `<h3>${part.label}</h3>`;
            for (const rec of part.value)
                info += `<p>${rec.label}: ${rec.value}</p>`;
        }

        if (info)
            info = `<h2>${title}</h2>${info}`;

        return info;
    }

    async body(req) {
        const result = {};

        this.genreMap = await this.webWorker.getGenreMap();
        result.link = this.baseLinks(req, true);

        const bookUid = req.query.uid;
        const entry = [];
        if (bookUid) {            
            const {bookInfo} = await this.webWorker.getBookInfo(bookUid);

            if (bookInfo) {
                const {genreMap} = await this.getGenres();

                //format
                const ext = bookInfo.book.ext;
                const formats = bookFormats(ext, bookInfo.link);

                //entry
                const e = this.makeEntry({
                    id: bookUid,
                    title: bookInfo.book.title || 'Без названия',
                });

                //author bookInfo
                if (bookInfo.book.author) {
                    e.author = bookInfo.book.author.split(',').map(a => ({name: a}));
                }

                e['dc:language'] = bookInfo.book.lang;
                e['dc:format'] = ext;

                //genre
                const genre = bookInfo.book.genre.split(',');
                for (const g of genre) {
                    const canonical = canonicalGenre(g.trim());
                    const genreName = genreMap.get(canonical);
                    if (genreName) {
                        if (!e.category)
                            e.category = [];
                        e.category.push({
                            '*ATTRS': {term: genreName, label: genreName},
                        });
                    }
                }

                let content = '';
                let ann = '';
                let info = '';
                //book info (fb2/epub — единая структура bookInfo)
                if (bookInfo.bookInfo) {
                    const infoObj = bookInfo.bookInfo;

                    if (infoObj.titleInfo) {
                        //author (если нет в book)
                        if (!e.author && infoObj.titleInfo.author && infoObj.titleInfo.author.length) {
                            e.author = infoObj.titleInfo.author.map(a => ({name: a}));
                        }

                        ann = infoObj.titleInfo.annotationHtml || '';
                        const self = this;
                        const infoList = buildInfoList(infoObj, {
                            valueToString(value, nodePath, origVTS) {//eslint-disable-line no-unused-vars
                                if ((nodePath == 'titleInfo/genre' || nodePath == 'srcTitleInfo/genre') && value) {
                                    return self.convertGenres(value);
                                }

                                return origVTS(value, nodePath);
                            },
                        });

                        const infoTitle = (bookInfo.book.ext === 'epub' ? 'Epub инфо' : 'Fb2 инфо');
                        info += this.htmlInfo(infoTitle, infoList);
                    }
                }

                //content
                info += this.htmlInfo('Inpx инфо', this.inpxInfo(bookInfo.book));

                content = `${ann}${info}`;
                if (content) {
                    e.content = {
                        '*ATTRS': {type: 'text/html'},
                        '*TEXT': this.escape(content),
                    };
                }

                // ссылки: единая точка
                let reviewsCount = null;
                let authorsFound = null;
                if (this.config.opdsBookAddonsInCard) {
                    if (this.config.reviewsEnabled) {
                        try { reviewsCount = await this.webWorker.getBookReviewsCount(bookUid); } catch (e) {}
                    }
                    if (this.config.authorsBioEnabled) {
                        try {
                            const authors = await this.webWorker.getBookAuthors(bookUid);
                            authorsFound = authors.filter(a => a.found);
                        } catch (e) {}
                    }
                }

                const L = await collectBookLinks({
                    uid: bookUid,
                    book: bookInfo.book,
                    bookInfo,
                    config: this.config,
                    webWorker: this.webWorker,
                    reviewsCount,
                    authorsFound,
                });

                e.link = [];
                for (const l of L.acquisition)
                    e.link.push(this.downLink({href: l.href, type: l.type, title: l.title}));
                if (this.config.opdsBookAddonsInCard) {
                    for (const l of L.nav)
                        e.link.push(this.makeLink({href: l.href, rel: l.rel, type: l.type, title: l.title}));
                    for (const l of L.addons)
                        e.link.push(this.makeLink({href: l.href, rel: l.rel, type: l.type, title: l.title}));
                }
                for (const l of L.cover) {
                    e.link.push(this.imgLink({href: l.href, type: l.type}));
                    e.link.push(this.imgLink({href: l.href, type: l.type, thumb: true}));
                }

                entry.push(e);
            }
        }

        result.entry = entry;

        return await this.makeBody(result, req);
    }
}

module.exports = BookPage;