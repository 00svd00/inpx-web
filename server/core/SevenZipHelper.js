const fs = require('fs-extra');
const path = require('path');
const { execFile, execFileSync } = require('child_process');

// Архивы многих inpx-коллекций (в частности, Флибусты) сжаты PPMd (метод 98).
// node-stream-zip умеет только deflate, поэтому такие записи достаём внешним 7z.
const SEVEN_ZIP_CANDIDATES = ['7z', '7zz', '7za'];
const MAX_BUF = 512*1024*1024;

class SevenZipHelper {
    // ---- статическое состояние (поиск 7z) ------------------------------

    static _sevenZipCmd = undefined;//undefined - еще не искали, '' - не нашли
    static _configuredPath = '';//путь из config.json

    //вызывается один раз при инициализации приложения
    static setSevenZipPath(p) {
        if (p)
            SevenZipHelper._configuredPath = p;
    }

    static _checkExecutable(cmd) {
        try {
            execFileSync(cmd, ['i'], {stdio: 'ignore'});
            return true;
        } catch (e) {
            return false;
        }
    }

    static getSevenZipPath() {
        if (SevenZipHelper._sevenZipCmd !== undefined)
            return SevenZipHelper._sevenZipCmd;

        // 1. Путь из конфига
        if (SevenZipHelper._configuredPath) {
            if (SevenZipHelper._checkExecutable(SevenZipHelper._configuredPath)) {
                SevenZipHelper._sevenZipCmd = SevenZipHelper._configuredPath;
                return SevenZipHelper._sevenZipCmd;
            }
            console.warn(`WARN: sevenZipPath="${SevenZipHelper._configuredPath}" is not executable, falling back to PATH`);
        }

        // 2. Рядом с исполняемым файлом приложения
        const exeDir = path.dirname(process.execPath);
        for (const name of SEVEN_ZIP_CANDIDATES) {
            const nearExe = path.join(exeDir, process.platform === 'win32' ? `${name}.exe` : name);
            if (fs.existsSync(nearExe) && SevenZipHelper._checkExecutable(nearExe)) {
                SevenZipHelper._sevenZipCmd = nearExe;
                return SevenZipHelper._sevenZipCmd;
            }
        }

        // 3. Поиск в PATH
        SevenZipHelper._sevenZipCmd = '';
        for (const cmd of SEVEN_ZIP_CANDIDATES) {
            if (SevenZipHelper._checkExecutable(cmd)) {
                SevenZipHelper._sevenZipCmd = cmd;
                break;
            }
        }

        return SevenZipHelper._sevenZipCmd;
    }

    // ---- экземплярные методы (операции над архивами) -------------------

    _exec(args, opts = {}) {
        return new Promise((resolve, reject) => {
            const bin = SevenZipHelper.getSevenZipPath();
            if (!bin) {
                reject(new Error('7z not found. Install 7-Zip or set sevenZipPath in config.'));
                return;
            }

            execFile(bin, args, Object.assign({maxBuffer: MAX_BUF, encoding: 'buffer'}, opts),
                (err, stdout) => err ? reject(err) : resolve(stdout)
            );
        });
    }

    /**
     * Список файлов в архиве.
     * Имена нормализованы: '/' на всех платформах (в т.ч. Windows).
     */
    async list(archivePath) {
        const out = await this._exec(['l', '-slt', archivePath], {encoding: 'utf8'});
        const result = [];
        const baseName = path.basename(archivePath);
        let inEntries = false;

        for (const line of out.split('\n')) {
            const trimmed = line.trim();
            if (trimmed === '----------') {
                inEntries = true;
                continue;
            }
            if (!inEntries)
                continue;
            if (trimmed.startsWith('Path = ')) {
                let name = trimmed.slice('Path = '.length).trim();
                if (!name || name === baseName)
                    continue;
                name = name.replace(/\\/g, '/');
                result.push(name);
            }
        }

        return result;
    }

    /**
     * Извлечь файл из архива в буфер.
     * entryName — с '/' (как возвращает list()).
     */
    async extract(archivePath, entryName) {
        const stdout = await this._exec(['x', '-so', '-bd', '-bso0', '-bse0', archivePath, entryName]);
        if (!stdout || !stdout.length)
            throw new Error(`7z: empty output for ${entryName}`);
        return stdout;
    }

    /**
     * Извлечь весь архив в директорию.
     */
    async extractAll(archivePath, outDir) {
        await this._exec(['x', '-y', '-bd', '-bso0', '-bse0', `-o${outDir}`, archivePath]);
    }
}

module.exports = SevenZipHelper;