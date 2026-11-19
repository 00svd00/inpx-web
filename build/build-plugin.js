const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');
const yazl = require('yazl');

// npm run build:plugin -- <id>      — один плагин -> dist/plugins/<id>.zip
// npm run build:plugin              — все plugins/*/ -> общий dist/plugins/plugins.zip
//
// ZIP: верхний уровень — каталог <id>/ (например, example/index.js),
// поэтому установка: unzip dist/plugins/<id>.zip -d <dataDir>/plugins/
// или для всех сразу: unzip dist/plugins/plugins.zip -d <dataDir>/plugins/
//
// node_modules плагина ПОПАДАЕТ в ZIP (самодостаточный, без npm install у пользователя).
// Исключаются: config.json (секреты), package-lock.json, .git, .gitignore, node_modules/.cache.

const repoDir = path.resolve(__dirname, '..');
const pluginsDir = path.join(repoDir, 'plugins');
const distDir = path.join(repoDir, 'dist', 'plugins');

const EXCLUDE_TOP = new Set(['config.json', 'package-lock.json', '.git', '.gitignore']);
const EXCLUDE_NODE_MODULES = [/^\.cache(\/|$)/];

async function collectFiles(dir, base = '', out = [], inNodeModules = false) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
        const rel = base ? `${base}/${e.name}` : e.name;
        const abs = path.join(dir, e.name);

        // верхний уровень: секреты/служебное не пакуем
        if (!base && EXCLUDE_TOP.has(e.name))
            continue;

        // внутри node_modules: исключаем .cache
        if (inNodeModules && EXCLUDE_NODE_MODULES.some(re => re.test(e.name)))
            continue;

        const nowInNodeModules = inNodeModules || (!base && e.name === 'node_modules');

        if (e.isDirectory()) {
            await collectFiles(abs, rel, out, nowInNodeModules);
        } else {
            out.push({ abs, rel });
        }
    }
    return out;
}

// Подготовка зависимостей и сбор списка файлов одного плагина
async function preparePlugin(id, opts = {}) {
    const pluginDir = path.join(pluginsDir, id);

    if (!await fs.pathExists(pluginDir))
        throw new Error(`plugin not found: ${pluginDir}`);

    const entry = path.join(pluginDir, 'index.js');
    if (!await fs.pathExists(entry))
        throw new Error(`plugin has no index.js: ${pluginDir}`);

    const nm = path.join(pluginDir, 'node_modules');
    const lock = path.join(pluginDir, 'package-lock.json');

    // --clean: удалить node_modules и package-lock.json перед установкой
    if (opts.clean) {
        if (await fs.pathExists(nm)) {
            console.log(`[${id}] clean: rm -rf node_modules`);
            await fs.remove(nm);
        }
        if (await fs.pathExists(lock)) {
            console.log(`[${id}] clean: rm package-lock.json`);
            await fs.remove(lock);
        }
    }

    const pkgFile = path.join(pluginDir, 'package.json');
    if (await fs.pathExists(pkgFile)) {
        const pkg = JSON.parse(await fs.readFile(pkgFile, 'utf8'));
        const deps = Object.keys(pkg.dependencies || {});
        if (deps.length) {
            if (opts.clean || opts.forceInstall || !await fs.pathExists(nm)) {
                console.log(`[${id}] npm install --omit=dev`);
                execSync('npm install --omit=dev --no-audit --no-fund', {
                    cwd: pluginDir,
                    stdio: 'inherit',
                });
            } else {
                console.log(`[${id}] node_modules exists, skip install`);
            }
        } else {
            console.log(`[${id}] no dependencies, skip install`);
        }
    }

    const files = await collectFiles(pluginDir);
    if (!files.length)
        throw new Error(`no files to pack: ${pluginDir}`);

    return files;
}

// Упаковка набора плагинов [{ id, files }] в указанный zip-файл
async function packPluginsToZip(zipName, entries) {
    await fs.ensureDir(distDir);
    const zipFile = path.join(distDir, zipName);
    await fs.remove(zipFile);

    let totalFiles = 0;

    await new Promise((resolve, reject) => {
        const zip = new yazl.ZipFile();
        for (const { id, files } of entries) {
            for (const f of files) {
                zip.addFile(f.abs, `${id}/${f.rel}`);
                totalFiles++;
            }
        }
        zip.outputStream
            .pipe(fs.createWriteStream(zipFile))
            .on('error', reject)
            .on('finish', resolve);
        zip.end();
    });

    const stat = await fs.stat(zipFile);
    const relZip = path.relative(repoDir, zipFile);
    console.log(`✅ ${zipName} (${entries.length} plugin(s), ${totalFiles} files, ${(stat.size / 1024 / 1024).toFixed(2)} MB) -> ${relZip}`);
    console.log(`   install: unzip ${relZip} -d <dataDir>/plugins/`);
    if (entries.length === 1) {
        const id = entries[0].id;
        console.log(`   then: cp <dataDir>/plugins/${id}/config.example.json <dataDir>/plugins/${id}/config.json && edit config.json (enabled: true)`);
    }
}

async function main() {
    const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
    const flags = process.argv.slice(2).filter(a => a.startsWith('--'));
    const id = args[0];
    const opts = {
        clean: flags.includes('--clean'),
        forceInstall: flags.includes('--force-install'),
    };

    // Сборка одного плагина в <id>.zip
    if (id) {
        const files = await preparePlugin(id, opts);
        await packPluginsToZip(`${id}.zip`, [{ id, files }]);
        return;
    }

    // Сборка всех плагинов в общий plugins.zip
    if (!await fs.pathExists(pluginsDir))
        throw new Error(`plugins dir not found: ${pluginsDir}`);

    const names = (await fs.readdir(pluginsDir, { withFileTypes: true }))
        .filter(e => e.isDirectory())
        .map(e => e.name)
        .sort();

    if (!names.length) {
        console.log('no plugins found');
        return;
    }

    const entries = [];
    for (const name of names) {
        const files = await preparePlugin(name, opts);
        entries.push({ id: name, files });
    }

    await packPluginsToZip('plugins.zip', entries);
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
