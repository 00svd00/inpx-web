const path = require('path');
const { spawn } = require('child_process');

const ZipReader = require('./ZipReader');

class SevenZipHelper {
    _get7zPath() {
        const bin = ZipReader.getSevenZipPath();
        if (!bin)
            throw new Error('7z not found. Install 7-Zip or set sevenZipPath in config.');
        return bin;
    }

    _spawn7z(args) {
        return new Promise((resolve, reject) => {
            let bin;
            try {
                bin = this._get7zPath();
            } catch (e) {
                reject(e);
                return;
            }

            const proc = spawn(bin, args);

            const outChunks = [];
            const errChunks = [];

            proc.stdout.on('data', c => outChunks.push(c));
            proc.stderr.on('data', c => errChunks.push(c));
            proc.on('error', reject);
            proc.on('close', code => {
                if (code !== 0) {
                    reject(new Error(`7z exited with ${code}: ${Buffer.concat(errChunks).toString()}`));
                } else {
                    resolve(Buffer.concat(outChunks));
                }
            });
        });
    }

    /**
     * Список файлов в архиве.
     * Имена нормализованы: '/' на всех платформах (в т.ч. Windows).
     */
    async list(archivePath) {
        const out = await this._spawn7z(['l', '-ba', archivePath]);
        const text = out.toString('utf8');
        const result = [];
        const baseName = path.basename(archivePath);

        for (const line of text.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed)
                continue;

            const parts = trimmed.split(/\s+/);
            let name = parts[parts.length - 1];

            if (!name || name === baseName)
                continue;

            // 7z на Windows выводит пути с '\', нормализуем в '/'
            name = name.replace(/\\/g, '/');

            result.push(name);
        }

        return result;
    }

    /**
     * Извлечь файл из архива в буфер.
     * entryName — с '/' (как возвращает list()).
     */
    async extract(archivePath, entryName) {
        try {
            const out = await this._spawn7z(['e', '-so', '-y', archivePath, `-i!${entryName}`]);
            return out;
        } catch (e) {
            // fallback для Windows: если имя с '/', попробуем '\'
            if (entryName.includes('/')) {
                const winName = entryName.replace(/\//g, '\\');
                return await this._spawn7z(['e', '-so', '-y', archivePath, `-i!${winName}`]);
            }
            throw e;
        }
    }
}

module.exports = SevenZipHelper;
