const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');
const yazl = require('yazl');

// npm run build:plugin -- <id>      — один плагин
// npm run release:plugins           — все plugins/*/
//
// ZIP: верхний уровень — каталог <id>/ (например, example/index.js),
// поэтому установка: unzip dist/plugins/<id>.zip -d <dataDir>/plugins/
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

async function buildPlugin(id, opts = {}) {
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

    await fs.ensureDir(distDir);
    const zipFile = path.join(distDir, `${id}.zip`);
    await fs.remove(zipFile);

    const files = await collectFiles(pluginDir);
    if (!files.length)
        throw new Error(`no files to pack: ${pluginDir}`);

    await new Promise((resolve, reject) => {
        const zip = new yazl.ZipFile();
        for (const f of files)
            zip.addFile(f.abs, `${id}/${f.rel}`);
        zip.outputStream
            .pipe(fs.createWriteStream(zipFile))
            .on('error', reject)
            .on('finish', resolve);
        zip.end();
    });

    const stat = await fs.stat(zipFile);
    console.log(`✅ ${id}.zip (${files.length} files, ${(stat.size / 1024 / 1024).toFixed(2)} MB) -> ${path.relative(repoDir, zipFile)}`);
    console.log(`   install: unzip ${path.relative(repoDir, zipFile)} -d <dataDir>/plugins/`);
    console.log(`   then: cp <dataDir>/plugins/${id}/config.example.json <dataDir>/plugins/${id}/config.json && edit config.json (enabled: true)`);
}

async function main() {
    const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
    const flags = process.argv.slice(2).filter(a => a.startsWith('--'));
    const id = args[0];
    const opts = {
        clean: flags.includes('--clean'),
        forceInstall: flags.includes('--force-install'),
    };

    if (id) {
        await buildPlugin(id, opts);
        return;
    }

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

    for (const name of names)
        await buildPlugin(name, opts);
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});