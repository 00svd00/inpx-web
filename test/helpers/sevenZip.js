const SevenZipHelper = require('../../server/core/SevenZipHelper');

function has7z() {
    return !!SevenZipHelper.getSevenZipPath();
}

module.exports = { has7z };