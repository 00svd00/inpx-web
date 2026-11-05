const path = require('path');
const JXL_JPEG_QUALITY = 69;

// Определяет, запущены ли мы в собранном pkg-бинарнике.
// process.pkg определён только в pkg.
function isPkg() {
    return typeof process.pkg !== 'undefined';
}

function loadNativeBinding() {
    // dev/тесты: штатный загрузчик @napi-rs/image найдёт .node в node_modules.
    // module.require — динамический, pkg не включает @napi-rs/image в снапшот.
    if (!isPkg()) {
        return module.require('@napi-rs/image');
    }

    // pkg: статические require на dist/napi-assets/, чтобы pkg включил
    // нужный .node в снапшот (по require-цепочке + pkg.assets).
    const { platform, arch } = process;

    try {
        if (platform === 'win32' && arch === 'x64') {
            return require('../../dist/napi-assets/image.win32-x64-msvc.node');
        }
        if (platform === 'darwin') {
            if (arch === 'arm64') return require('../../dist/napi-assets/image.darwin-arm64.node');
            if (arch === 'x64') return require('../../dist/napi-assets/image.darwin-x64.node');
        }
        if (platform === 'linux') {
            if (arch === 'arm') return require('../../dist/napi-assets/image.linux-arm-gnueabihf.node');
            if (arch === 'arm64') return require('../../dist/napi-assets/image.linux-arm64-gnu.node');
            if (arch === 'x64') return require('../../dist/napi-assets/image.linux-x64-gnu.node');
        }
    } catch (err) {
        console.error(`[jxlConvert] Не удалось загрузить нативный модуль для ${platform}-${arch}:`, err.message);
    }

    throw new Error(`Нативная библиотека для платформы ${platform}-${arch} отсутствует или не может быть загружена.`);
}

// Инициализируем бинарник. 
// При сборке под конкретную ОС pkg возьмет из папки dist/napi-assets/ ровно один файл,
// который туда положил fetch-napi.js, запечет внутрь, а остальные пустые пути проигнорирует.
const nativeBinding = loadNativeBinding();

const ZipReader = require('../ZipReader');

function isJxlBuffer(buffer) {
    return buffer.length > 2 && buffer[0] === 0xFF && buffer[1] === 0x0A;
}

function isPngBuffer(buffer) {
    return buffer.length > 2 && buffer[0] === 0x89 && buffer[1] === 0x50;
}

function isJpgBuffer(buffer) {
    return buffer.length > 2 && buffer[0] === 0xFF && buffer[1] === 0xD8;
}

async function jxlConvert(imageBuff) {
    if (!imageBuff || !imageBuff.length) {
        return { outputImg: Buffer.alloc(0), ext: 'png' };
    }

    if (isJxlBuffer(imageBuff)) {
        const transformer = new nativeBinding.Transformer(imageBuff);
        const meta = await transformer.metadata();

        if (meta.colorType !== 3) {
            return { outputImg: await transformer.jpeg(JXL_JPEG_QUALITY), ext: 'jpeg' };
        }

        // с альфой — rawPixels + JS-цикл (замена прозрачных на белый)
        const raw = await transformer.rawPixels(); // RGBA
        const len = raw.length;
        for (let i = 0; i < len; i += 4) {
            const a = raw[i + 3];
            if (a === 255) continue;          // непрозрачный — пропускаем
            if (a === 0) {                    // полностью прозрачный — белый
                raw[i] = 255;
                raw[i + 1] = 255;
                raw[i + 2] = 255;
                raw[i + 3] = 255;
                continue;
            }
            const inv = 255 - a;
            raw[i]     = (raw[i]     * a + 255 * inv) / 255 | 0;
            raw[i + 1] = (raw[i + 1] * a + 255 * inv) / 255 | 0;
            raw[i + 2] = (raw[i + 2] * a + 255 * inv) / 255 | 0;
            raw[i + 3] = 255;
        }
        const t2 = nativeBinding.Transformer.fromRgbaPixels(raw, meta.width, meta.height);
        return {
            outputImg: await t2.jpeg(JXL_JPEG_QUALITY),
            ext: 'jpeg',
        };
    }

    if (isJpgBuffer(imageBuff)) {
        return { outputImg: imageBuff, ext: 'jpeg' };
    }
    return { outputImg: imageBuff, ext: 'png' };
}

async function readArchiveEntry(archivePath, entryName) {
    const zipReader = new ZipReader();
    try {
        await zipReader.open(archivePath);
        if (!(entryName in zipReader.zipEntries))
            return null;
        return await zipReader.extractToBuf(entryName);
    } catch (e) {
        return null;
    } finally {
        try { await zipReader.close(); } catch (e) {}
    }
}

async function readArchiveEntries(archivePath, filterFn) {
    const zipReader = new ZipReader();
    try {
        await zipReader.open(archivePath);
        const result = [];
        for (const name of Object.keys(zipReader.zipEntries)) {
            if (filterFn && !filterFn(name))
                continue;
            try {
                const buf = await zipReader.extractToBuf(name);
                if (buf)
                    result.push({name, buf});
            } catch (e) {
                // один битый entry не должен ломать остальные
            }
        }
        return result;
    } catch (e) {
        return [];
    } finally {
        try { await zipReader.close(); } catch (e) {}
    }
}

async function listArchiveEntries(archivePath) {
    const zipReader = new ZipReader();
    try {
        await zipReader.open(archivePath);
        return Object.keys(zipReader.zipEntries);
    } catch (e) {
        return [];
    } finally {
        try { await zipReader.close(); } catch (e) {}
    }
}

module.exports = {
    isJxlBuffer, isPngBuffer, isJpgBuffer,
    jxlConvert,
    readArchiveEntry, readArchiveEntries, listArchiveEntries,
    JXL_JPEG_QUALITY,
};
