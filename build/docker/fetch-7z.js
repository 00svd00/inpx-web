const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');
const https = require('https');

const targetArch = process.argv[2];
if (!targetArch) { console.error('Usage: node fetch-7z.js <amd64|arm64>'); process.exit(1); }

const distDir = path.join(__dirname, '..', '..', 'dist');

// GitHub API для latest релиза
function getLatestRelease() {
    return new Promise((resolve, reject) => {
        https.get('https://api.github.com/repos/ip7z/7zip/releases/latest', {
            headers: { 'User-Agent': 'inpx-web-build' }
        }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
}

async function main() {
    const release = await getLatestRelease();
    const tag = release.tag_name;
    const ver = tag.replace(/\./g, '');
    const archMap = { amd64: 'x64', arm64: 'arm64' };
    const linuxArch = archMap[targetArch];
    if (!linuxArch) throw new Error(`Unsupported arch: ${targetArch}`);

    const assetName = `7z${ver}-linux-${linuxArch}.tar.xz`;
    const url = `https://github.com/ip7z/7zip/releases/download/${tag}/${assetName}`;

    const cacheDir = path.join(distDir, 'docker-cache', '7z', tag);
    const cachedTar = path.join(cacheDir, assetName);
    const outDir = path.join(distDir, 'docker-binaries', targetArch);

    await fs.ensureDir(cacheDir);
    await fs.ensureDir(outDir);

    if (!await fs.pathExists(cachedTar)) {
        console.log(`Downloading ${url}`);
        execSync(`curl -sL -o "${cachedTar}" "${url}"`, { stdio: 'inherit' });
    }

    const tmpDir = path.join(cacheDir, 'tmp');
    await fs.emptyDir(tmpDir);
    execSync(`tar -xJf "${cachedTar}" -C "${tmpDir}" 7zzs`, { stdio: 'inherit' });
    await fs.move(path.join(tmpDir, '7zzs'), path.join(outDir, '7z'), { overwrite: true });
    await fs.remove(tmpDir);

    console.log(`✅ 7z for ${targetArch} in ${outDir}`);
}
main().catch(e => { console.error(e); process.exit(1); });