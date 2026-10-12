const path = require('path');
const fs = require('fs');

let cachedPath = undefined; // кэш: undefined = ещё не искали, null = не нашли
let configuredPath = '';    // путь из config.json

/**
 * Устанавливает путь к djxl из конфига.
 * Вызывается один раз при инициализации приложения.
 * Сбрасывает кэш, чтобы при следующем вызове resolveDjxl()
 * поиск начался заново с учётом нового пути.
 */
function setDjxlPath(p) {
    if (p) {
        configuredPath = p;
        cachedPath = undefined; // сброс кэша
    }
}

function checkExecutable(file) {
    try {
        fs.accessSync(file, fs.constants.X_OK);
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Ищет исполняемый файл djxl.
 * Приоритет:
 *   1. Путь из config.json (djxlPath).
 *   2. Рядом с исполняемым файлом приложения (process.execPath).
 *   3. В переменной PATH.
 * Возвращает абсолютный путь или null, если ничего не найдено.
 * Результат кэшируется после первого вызова.
 */
function resolveDjxl() {
    if (cachedPath !== undefined) return cachedPath;

    const exts = process.platform === 'win32'
        ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';')
        : [''];

    // 1. Путь из конфига
    if (configuredPath) {
        for (const ext of exts) {
            const full = configuredPath + (configuredPath.toLowerCase().endsWith(ext.toLowerCase()) ? '' : ext);
            if (checkExecutable(full)) {
                cachedPath = full;
                return cachedPath;
            }
        }
        console.warn(`WARN: djxlPath="${configuredPath}" is not executable, falling back to search`);
    }

    // 2. Рядом с исполняемым файлом приложения
    const exeDir = path.dirname(process.execPath);
    for (const ext of exts) {
        const nearExe = path.join(exeDir, 'djxl' + ext);
        if (checkExecutable(nearExe)) {
            cachedPath = nearExe;
            return cachedPath;
        }
    }

    // 3. Поиск в PATH
    const dirs = (process.env.PATH || '').split(path.delimiter);
    for (const dir of dirs) {
        for (const ext of exts) {
            const full = path.join(dir, 'djxl' + ext);
            if (checkExecutable(full)) {
                cachedPath = full;
                return cachedPath;
            }
        }
    }

    cachedPath = null;
    return cachedPath;
}

module.exports = { resolveDjxl, setDjxlPath };