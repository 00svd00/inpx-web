const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');
const yazl = require('yazl');

// npm run build:plugin -- <id>      — один плагин
// npm run release:plugins           — все plugins/*/

const repoDir = path.resolve(__dirname, '..');
const pluginsDir = path.join(repoDir, 'plugins');
const distDir = path.join(repoDir, 'dist', 'plugins');

// в ZIP не попадает: секреты, служебное, кеш
const EXCLUDE_TOP = new Set(['config.json', 'package-lock.json', '.git', '.gitignore', 'node_modules']);
const EXCLUDE_NODE_MODULES = [/^\.cache(\/|$)/]; 

async function collectFiles(dir, base = '', out = []) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
        const rel = base ? `${base}/${e.name}` : e.name;
        const abs = path.join(dir, e.name);

        // верхний уровень: config.json не пакуем
        if (!base && EXCLUDE_TOP.has(e.name))
            continue;

        if (e.isDirectory()) {
            if (e.name === 'node_modules' && base) {
                // внутри node_modules: исключаем .cache
                const nmEntries = await fs.readdir(abs, { withFileTypes: true });
                for (const ne of nmEntries) {
                    if (EXCLUDE_NODE_MODULES.some(re => re.test(ne.name)))
                        continue;
                    const nAbs = path.join(abs, ne.name);
                    if (ne.isDirectory())
                        await collectFiles(nAbs, `${rel}/${ne.name}`, out);
                    else
                        out.push({ abs: nAbs, rel: `${rel}/${ne.name}` });
                }
                continue;
            }
            await collectFiles(abs, rel, out);
        } else {
            out.push({ abs, rel });
        }
    }
    return out;
}

async function buildPlugin(id) {
    const pluginDir = path.join(pluginsDir, id);

    if (!await fs.pathExists(pluginDir))
        throw new Error(`plugin not found: ${pluginDir}`);

    const entry = path.join(pluginDir, 'index.js');
    if (!await fs.pathExists(entry))
        throw new Error(`plugin has no index.js: ${pluginDir}`);

    const pkgFile = path.join(pluginDir, 'package.json');
    if (await fs.pathExists(pkgFile)) {
        const pkg = JSON.parse(await fs.readFile(pkgFile, 'utf8'));
        const deps = Object.keys(pkg.dependencies || {});
        if (deps.length) {
            const nm = path.join(pluginDir, 'node_modules');
            if (!await fs.pathExists(nm)) {
                console.log(`[${id}] npm install --production`);
                execSync('npm install --production --no-audit --no-fund', {
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
    console.log(`✅ ${id}.zip (${files.length} files, ${(stat.size / 1024).toFixed(1)} KB) -> ${path.relative(repoDir, zipFile)}`);
    console.log(`   install: unzip ${path.relative(repoDir, zipFile)} -d <dataDir>/plugins/`);
    console.log(`   then: cp config.example.json config.json && edit config.json (enabled: true)`);
}

async function main() {
    const id = process.argv[2];

    if (id) {
        await buildPlugin(id);
        return;
    }

    // все плагины
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
        await buildPlugin(name);
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});