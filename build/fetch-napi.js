const { execSync } = require('child_process');
const fs = require('fs-extra');
const path = require('path');

const pckg = require('../package.json');
const version = pckg.dependencies['@napi-rs/image']; // "1.16.0"

const target = process.argv[2];
if (!target) {
    console.error('Usage: node fetch-napi.js <target>');
    process.exit(1);
}

// Парсим target
const dashIndex = target.indexOf('-');
const rest = target.substring(dashIndex + 1);
const parts = rest.split('-');
const targetOs = parts[0];                    // linux, win, macos
const targetArch = parts.slice(1).join('-');  // x64, arm64, armv7

// Определяем суффикс пакета @napi-rs/image-*
let napiPkgSuffix;
if (targetOs === 'win') {
    napiPkgSuffix = `win32-${targetArch}-msvc`;
} else if (targetOs === 'macos') {
    napiPkgSuffix = `darwin-${targetArch}`;
} else {
    if (targetArch === 'armv7') {
        napiPkgSuffix = `linux-arm-gnueabihf`;
    } else {
        napiPkgSuffix = `linux-${targetArch}-gnu`;
    }
}

const pkgName = `@napi-rs/image-${napiPkgSuffix}`;
const pkgSpec = `${pkgName}@${version}`;
const nodeFileName = `image.${napiPkgSuffix}.node`;

// Кеш: dist/napi-cache/<suffix>/<version>/<nodeFileName>
const cacheDir = path.join(__dirname, '..', 'dist', 'napi-cache', napiPkgSuffix, version);
const cachedPath = path.join(cacheDir, nodeFileName);

// Целевая директория для pkg.assets
const destDir = path.join(__dirname, '..', 'dist', 'napi-assets');
const destPath = path.join(destDir, nodeFileName);

// Временная директория для распаковки
const tmpDir = path.join(__dirname, '..', 'dist', 'napi-tmp');

async function fetchAndCache() {
    await fs.ensureDir(cacheDir);
    await fs.emptyDir(tmpDir);

    console.log(`Fetching ${pkgSpec} via npm pack...`);
    execSync(`npm pack ${pkgSpec}`, { cwd: tmpDir, stdio: 'inherit' });

    const files = await fs.readdir(tmpDir);
    const tgzFile = files.find(f => f.endsWith('.tgz'));
    if (!tgzFile) {
        throw new Error(`No .tgz file found in ${tmpDir} after npm pack`);
    }

    console.log(`Extracting ${tgzFile}...`);
    execSync(`tar -xzf ${tgzFile}`, { cwd: tmpDir, stdio: 'inherit' });

    // Ищем .node файл (имя может отличаться от ожидаемого)
    const packageDir = path.join(tmpDir, 'package');
    let srcPath = path.join(packageDir, nodeFileName);
    if (!await fs.pathExists(srcPath)) {
        const pkgFiles = await fs.readdir(packageDir);
        const nodeFile = pkgFiles.find(f => f.endsWith('.node'));
        if (!nodeFile) {
            throw new Error(`No .node file found in ${packageDir}`);
        }
        console.log(`Expected ${nodeFileName}, but found ${nodeFile}. Using it.`);
        srcPath = path.join(packageDir, nodeFile);
    }

    await fs.copy(srcPath, cachedPath);
    console.log(`✅ Cached ${nodeFileName} for ${napiPkgSuffix}@${version}`);

    await fs.remove(tmpDir);
}

async function main() {
    // очищаем destDir, чтобы старый .node от другой платформы не попал в pkg
    await fs.emptyDir(destDir);

    if (await fs.pathExists(cachedPath)) {
        console.log(`✅ Using cached ${nodeFileName} for ${napiPkgSuffix}@${version}`);
    } else {
        await fetchAndCache();
    }

    await fs.copy(cachedPath, destPath);
    console.log(`✅ Copied ${nodeFileName} for ${target} to dist/napi-assets/`);
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});