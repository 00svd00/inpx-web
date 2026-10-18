const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');

const showdown = require('showdown');

const platform = process.argv[2];
const noReadme = process.argv.includes('--no-readme') || process.env.INPX_PREPKG_NO_README === '1';

// distDir можно переопределить (тесты); по умолчанию — <repo>/dist
const distDir = process.env.INPX_DIST_DIR
    ? path.resolve(process.env.INPX_DIST_DIR)
    : path.resolve(__dirname, '../dist');
const tmpDir = `${distDir}/tmp`;
const publicDir = `${tmpDir}/public`;
const outDir = `${distDir}/${platform}`;

async function build() {
    if (!platform)
        throw new Error(`Please set platform`);

    await fs.emptyDir(outDir);

    // readme в релиз (в тестах отключается --no-readme, чтобы не зависеть от showdown/README.md)
    if (!noReadme) {
        let readme = await fs.readFile(path.resolve(__dirname, '../README.md'), 'utf-8');
        const converter = new showdown.Converter();
        readme = converter.makeHtml(readme);
        await fs.writeFile(`${outDir}/readme.html`, readme);
    }

    // перемещаем public на место
    if (await fs.pathExists(publicDir)) {

        const zipFile = `${tmpDir}/public.zip`;
        const jsonFile = `${distDir}/public.json`;//distDir !!!

        await fs.remove(zipFile);
        execSync(`zip -r ${zipFile} .`, {cwd: publicDir, stdio: 'inherit'});

        const data = (await fs.readFile(zipFile)).toString('base64');

        // хеш содержимого zip: другая сборка -> другой хеш -> пересоздаём public
        const hash = crypto.createHash('sha256').update(data).digest('hex');

        // верхнеуровневые элементы сборки (файлы и каталоги).
        // version.txt пишется в рантайме (см. createWebApp.js) — в zip его нет,
        // .manifest.json — служебный маркер, тоже исключаем.
        const entries = (await fs.readdir(publicDir))
            .filter(n => n !== 'version.txt' && n !== '.manifest.json')
            .sort();

        const manifest = {
            version: require('../package.json').version,
            hash,
            entries,
        };

        await fs.writeFile(jsonFile, JSON.stringify({data, manifest}));
    } else {
        throw new Error(`publicDir: ${publicDir} does not exist`);
    }
}

async function main() {
    try {
        await build();
    } catch(e) {
        console.error(e);
        process.exit(1);
    }
}

main();