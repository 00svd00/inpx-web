const path = require('path');

// Функция определяет, какой нативный модуль подгрузить.
// Мы используем жестко прописанные строки require(), чтобы статический анализатор pkg 
// жестко связал их с файлами, объявленными в pkg.assets в package.json.
function loadNativeBinding() {
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
const JXL_JPEG_QUALITY = 69;

function isJxlBuffer(buffer) {
    return buffer.length > 2 && buffer[0] === 0xFF && buffer[1] === 0x0A;
}

function isPngBuffer(buffer) {
    return buffer.length > 2 && buffer[0] === 0x89 && buffer[1] === 0x50;
}

function isJpgBuffer(buffer) {
    return buffer.length > 2 && buffer[0] === 0xFF && buffer[1] === 0xD8;
}

// JXL -> JPEG с альфа-блендингом на белый фон средствами Rust
async function jxlConvert(imageBuff) {
    if (!imageBuff || !imageBuff.length) {
        return { outputImg: Buffer.alloc(0), ext: 'png' };
    }

    if (isJxlBuffer(imageBuff)) {
        // 1. Декодируем JXL в трансформер
        const transformer = new nativeBinding.Transformer(imageBuff);
        
        // Получаем метаданные (ширину и высоту), чтобы создать подложку точного размера
        const { width, height } = await transformer.metadata();

        // 2. Создаем чистый белый холст (Background) в формате PNG средствами napi-rs
        // Для этого создаем пустой прозрачный холст и заливаем его белым цветом
        const whiteBackground = await nativeBinding.Transformer.fromRgbaPixels(
            new Uint8Array(width * height * 4).fill(255), // Заполняем 255 (белый цвет + непрозрачный альфа)
            width,
            height
        ).png(); // Конвертируем в буфер, так как .overlay принимает закодированные байты

        // 3. Накладываем наш исходный JXL поверх белого холста.
        // Метод .overlay автоматически производит альфа-блендинг прозрачных пикселей в слое Rust
        const blendedTransformer = new nativeBinding.Transformer(whiteBackground);
        const jpegBuffer = await blendedTransformer
            .overlay(imageBuff, 0, 0) // Накладываем JXL с левого верхнего угла (0, 0)
            .jpeg(JXL_JPEG_QUALITY);

        return {
            outputImg: jpegBuffer,
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
