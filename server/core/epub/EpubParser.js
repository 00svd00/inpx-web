const XmlParser = require('../xml/XmlParser');
const he = require('he');
const { sanitizeHtml } = require('../sanitize');
const { buildInfoList, buildDesc } = require('../book/bookInfoMapping');

// epub: OPF (package/metadata) → bookInfo-структура (как Fb2Parser.bookInfo())
// bookInfoList — общий (buildInfoList), getDesc — общий (buildDesc).
class EpubParser extends XmlParser {
    // bookInfo-структура (совместима с Fb2Parser.bookInfo): titleInfo/publishInfo/documentInfo
    bookInfo() {
        const result = {};

        // OPF: <package><metadata>...
        const meta = this.$$('package/metadata/');
        if (!meta || !meta.count)
            return result;

        const text = (sel) => {
            const v = meta.text(sel);
            return (v === null || v === '' ? null : v);
        };
        const arr = (sel) => {
            const res = [];
            for (const n of meta.$$array(sel)) {
                const v = n.text('');
                if (v !== null && v !== '')
                    res.push(v);
            }
            return res;
        };

        // titleInfo
        const titleInfo = {};

        titleInfo.bookTitle = text('dc:title');
        titleInfo.author = arr('dc:creator');
        titleInfo.genre = arr('dc:subject');
        titleInfo.lang = text('dc:language');
        titleInfo.date = text('dc:date');

        // annotation (dc:description) — как html (как есть; toHtml — fb2-специфика)
        const description = text('dc:description');
        titleInfo.annotation = description;
        titleInfo.annotationXml = null;
        titleInfo.annotationHtml = sanitizeHtml(he.decode(description || ''));

        // series: calibre → epub3
        let seqName = null;
        let seqNum = null;
        for (const n of meta.$$array('meta')) {
            const a = n.attrs();
            if (!a) continue;
            if (a.name === 'calibre:series' && a.content)
                seqName = a.content;
            if (a.name === 'calibre:series_index' && a.content)
                seqNum = a.content;
        }
        if (!seqName) {
            for (const n of meta.$$array('meta')) {
                const a = n.attrs();
                if (a && a.property === 'belongs-to-collection') {
                    const v = n.text('');
                    if (v) { seqName = v; break; }
                }
            }
            if (seqName && !seqNum) {
                for (const n of meta.$$array('meta')) {
                    const a = n.attrs();
                    if (a && a.property === 'group-position') {
                        const v = n.text('');
                        if (v) { seqNum = v; break; }
                    }
                }
            }
        }
        titleInfo.sequence = (seqName ? [{name: seqName, num: seqNum, lang: null}] : []);

        result.titleInfo = titleInfo;

        // publishInfo (dc:publisher, dc:date?) — по возможности
        const publisher = text('dc:publisher');
        if (publisher)
            result.publishInfo = {publisher};

        // documentInfo (dc:identifier, dc:date)
        const identifier = text('dc:identifier');
        if (identifier)
            result.documentInfo = {id: identifier};

        return result;
    }

    bookInfoList(bookInfo, options = {}) {
        return buildInfoList(bookInfo, options);
    }

    getDesc() {
        return buildDesc(this.bookInfo());
    }
}

module.exports = EpubParser;