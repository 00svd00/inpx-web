const fs = require('fs-extra');
const path = require('path');

const webApp = require('../dist/public.json');
const ZipReader = require('./core/ZipReader');

const log = new (require('./core/AppLogger'))().log;//singleton

// удалить запись верхнего уровня (файл или каталог рекурсивно)
async function removeEntry(dir, name) {
    try {
        await fs.remove(path.join(dir, name));
    } catch (e) {
        // не критично: файла может уже не быть, или он занят — пропускаем
    }
}

// удалить флаги .replaced (от старой распаковки они невалидны:
// файлы перезаписаны, а rootPathStatic мог измениться).
// Регенерируются при первом запросе статики (static.js).
async function removeReplacedFlags(dir) {
    let names;
    try {
        names = await fs.readdir(dir);
    } catch (e) {
        return;
    }
    for (const name of names) {
        const p = path.join(dir, name);
        let st;
        try {
            st = await fs.stat(p);
        } catch (e) {
            continue;
        }
        if (st.isDirectory())
            await removeReplacedFlags(p);
        else if (name.endsWith('.replaced'))
            try { await fs.remove(p); } catch (e) {}
    }
}

module.exports = async(config) => {
    const markerPath = `${config.publicDir}/.manifest.json`;
    const zipFile = `${config.tempDir}/public.zip`;

    if (!webApp.manifest || !webApp.manifest.hash || !Array.isArray(webApp.manifest.entries))
        throw new Error('public.json: manifest is missing or malformed');

    // version.txt — служебный человекочитаемый маркер, пишем сами после распаковки.
    // В zip его нет, поэтому добавляем в entries здесь.
    const manifest = Object.assign({}, webApp.manifest, {
        entries: webApp.manifest.entries.concat(['version.txt']),
    });

    // читаем прошлый маркер
    let prev = null;
    try {
        prev = JSON.parse(await fs.readFile(markerPath, 'utf8'));
    } catch (e) {
        prev = null;
    }

    const sameHash = prev && prev.hash === manifest.hash;
    const sameRoot = prev && prev.rootPathStatic === config.rootPathStatic;

    if (sameHash && sameRoot)
        return;

    log(`WebApp: updating public (hash ${prev ? String(prev.hash).slice(0, 12) : 'none'} -> ${manifest.hash.slice(0, 12)}, rootPathStatic ${prev ? JSON.stringify(prev.rootPathStatic) : 'none'} -> ${JSON.stringify(config.rootPathStatic)})`);

    // 1. снести осиротевшие записи прошлой сборки (которых нет в текущей)
    if (prev && Array.isArray(prev.entries)) {
        const current = new Set(manifest.entries);
        for (const name of prev.entries) {
            if (!current.has(name))
                await removeEntry(config.publicDir, name);
        }
    }

    // 2. снести записи текущей сборки (перезапишем при распаковке)
    for (const name of manifest.entries)
        await removeEntry(config.publicDir, name);

    // 3. распаковать public.json
    await fs.ensureDir(config.publicDir);
    await fs.writeFile(zipFile, webApp.data, {encoding: 'base64'});
    const zipReader = new ZipReader();
    await zipReader.open(zipFile);
    try {
        await zipReader.extractAllToDir(config.publicDir);
    } finally {
        await zipReader.close();
    }
    await fs.remove(zipFile);

    // 4. флаги .replaced от старой распаковки невалидны: файлы перезаписаны,
    // rootPathStatic мог измениться. Регенерируются static.js при первом запросе.
    await removeReplacedFlags(config.publicDir);

    // 5. version.txt — человекочитаемый маркер (как раньше)
    await fs.writeFile(`${config.publicDir}/version.txt`, config.version + config.rootPathStatic);

    // 6. записать новый маркер
    await fs.writeFile(markerPath, JSON.stringify(Object.assign({}, manifest, {
        rootPathStatic: config.rootPathStatic,
    }), null, 2));
};