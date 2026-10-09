const path = require('path');
const fs = require('fs');

let cachedPath = undefined; // кэш: undefined = ещё не искали, null = не нашли

/**
 * Ищет исполняемый файл djxl.
 * Приоритет:
 *   1. Рядом с исполняемым файлом приложения (process.execPath).
 *   2. В переменной PATH.
 * Возвращает абсолютный путь или null, если ничего не найдено.
 * Результат кэшируется после первого вызова.
 */
function resolveDjxl() {
    if (cachedPath !== undefined) return cachedPath;

    const exts = process.platform === 'win32'
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';')
    : [''];

    // 1. Рядом с исполняемым файлом приложения
    const exeDir = path.dirname(process.execPath);
    for (const ext of exts) {
    const nearExe = path.join(exeDir, 'djxl' + ext);
    try {
        fs.accessSync(nearExe, fs.constants.X_OK);
        cachedPath = nearExe;
        return cachedPath;
    } catch (e) { /* continue */ }
}

    // 2. Поиск в PATH
    const dirs = (process.env.PATH || '').split(path.delimiter);
    for (const dir of dirs) {
        for (const ext of exts) {
            const full = path.join(dir, 'djxl' + ext);
            try {
                fs.accessSync(full, fs.constants.X_OK);
                cachedPath = full;
                return cachedPath;
            } catch (e) { /* continue */ }
        }
    }

    cachedPath = null;
    return cachedPath;
}

module.exports = { resolveDjxl };