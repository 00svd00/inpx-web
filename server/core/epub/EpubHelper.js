const fs = require('fs-extra');
const XmlParser = require('../xml/XmlParser');
const EpubParser = require('./EpubParser');
const { readArchiveEntry, listArchiveEntries } = require('../book/bookImages');

// epub: <hash> в кеше — zip. OPF (container.xml → full-path) → EpubParser → bookInfo-структура.
class EpubHelper {
    async getBookInfo(bookFile) {
        const opfText = await this.readOpf(bookFile);
        if (!opfText)
            return null;

        const parser = new EpubParser();
        parser.fromString(opfText, {
            lowerCase: true,
            pickNode: route => route.indexOf('package/metadata') === 0 || route === 'package',
        });

        return parser.bookInfo();
    }

    async readOpf(bookFile) {
        const entries = await listArchiveEntries(bookFile);
        if (!entries || !entries.length)
            return null;

        const find = (name) => {
            const key = String(name || '').replace(/^\.?\//, '').toLowerCase();
            return entries.find(e => e.replace(/^\.?\//, '').toLowerCase() === key);
        };

        // container.xml → full-path
        let opfPath = 'content.opf';
        const containerEntry = find('META-INF/container.xml');
        if (containerEntry) {
            const buf = await readArchiveEntry(bookFile, containerEntry);
            if (buf) {
                const m = buf.toString('utf8').match(/full-path\s*=\s*"([^"]+)"/i);
                if (m) opfPath = m[1];
            }
        }
        opfPath = opfPath.replace(/^\.?\//, '');

        const opfEntry = find(opfPath);
        if (!opfEntry)
            return null;

        const opf = await readArchiveEntry(bookFile, opfEntry);
        return (opf ? opf.toString('utf8') : null);
    }
}

module.exports = EpubHelper;