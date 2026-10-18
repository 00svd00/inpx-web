const fs = require('fs-extra');
const path = require('path');

// Готовит tmp-каталог под AuthorBioReader: etc/authors/pictures/<id>.zip (пустой).
// Возвращает { libDir, picturesDir, archivePath }.
async function preparePictures(dir, archiveId = 3) {
    const picturesDir = path.join(dir, 'etc', 'authors', 'pictures');
    await fs.ensureDir(picturesDir);
    const archivePath = path.join(picturesDir, `${archiveId}.zip`);
    await fs.writeFile(archivePath, '');
    return { libDir: dir, picturesDir, archivePath };
}

module.exports = { preparePictures };