const fs = require('fs-extra');
const path = require('path');
const { execFileSync } = require('child_process');
const SevenZipHelper = require('../../server/core/SevenZipHelper');

function has7z() {
    return !!SevenZipHelper.getSevenZipPath();
}

// make7z(dir, name, files) — создать 7z из {relPath: Buffer|string}; вложенные пути сохраняются.
function make7z(dir, name, files) {
    const srcDir = path.join(dir, `_7z_src_${name}_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    fs.ensureDirSync(srcDir);
    for (const [rel, buf] of Object.entries(files)) {
        const p = path.join(srcDir, rel);
        fs.ensureDirSync(path.dirname(p));
        fs.writeFileSync(p, Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf), 'utf8'));
    }
    const archive = path.join(dir, name);
    execFileSync(SevenZipHelper.getSevenZipPath(), ['a', '-t7z', archive, `${srcDir}/*`], {stdio: 'ignore'});
    fs.removeSync(srcDir);
    return archive;
}

module.exports = { has7z, make7z };