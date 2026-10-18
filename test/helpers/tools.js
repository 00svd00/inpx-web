const SevenZipHelper = require('../../server/core/SevenZipHelper');
const { resolveDjxl } = require('../../server/core/DjxlResolver');

function has7z() { return !!SevenZipHelper.getSevenZipPath(); }
function hasDjxl() { return !!resolveDjxl(); }

module.exports = { has7z, hasDjxl };