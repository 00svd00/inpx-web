const Favorites = require('../../server/core/Favorites');
const SevenZipHelper = require('../../server/core/SevenZipHelper');

function resetSingletons() {
    Favorites.instance = null;
    SevenZipHelper._sevenZipCmd = undefined;
    SevenZipHelper._configuredPath = '';
}

module.exports = { resetSingletons };