const fs = require('fs-extra');
const path = require('path');

const targetArch = process.argv[2];
const distDir = path.join(__dirname, '..', '..', 'dist');

const releaseDir = targetArch === 'amd64' ? 'alpine-amd64' : 'alpine-arm64';
const srcBinary = path.join(distDir, releaseDir, 'inpx-web');
const src7z = path.join(distDir, 'docker-binaries', targetArch, '7z');
const outDir = path.join(distDir, 'docker-context', targetArch);

async function main() {
    await fs.emptyDir(outDir);

    await fs.copy(srcBinary, path.join(outDir, 'inpx-web'));
    await fs.chmod(path.join(outDir, 'inpx-web'), 0o755);

    await fs.copy(src7z, path.join(outDir, '7z'));
    await fs.chmod(path.join(outDir, '7z'), 0o755);

    // каталог для кэша pkg (нативные аддоны), 0777 — чтобы любой UID мог писать
    const pkgCacheDir = path.join(outDir, 'pkg-cache');
    await fs.ensureDir(pkgCacheDir);
    await fs.chmod(pkgCacheDir, 0o777);

    console.log(`✅ Binaries for ${targetArch} in ${outDir}`);
}

main().catch(e => { console.error(e); process.exit(1); });