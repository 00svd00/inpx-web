// Минимальный JXL codestream 4x4 (первые байты ff 0a — isJxlBuffer распознает).
// Сгенерирован один раз: cjxl --container=0 4x4.png 4x4.jxl
const MINIMAL_JXL_B64 = '/woYELChuBAATIAoAAwBtZ8gAAAVKqOMG7yc6/nyQ4fFtI3rDG21bWEJY7M9FwoGCQlnaJ3lh4tNNcUUS0yBDt3S6PTr56+/5lPuyd3U8VglCQ==';

// Сигнатуры (для проверок, не для декодирования)
const SIG = {
    jxl: Buffer.from([0xFF, 0x0A]),
    jpeg: Buffer.from([0xFF, 0xD8, 0xFF]),
    png: Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
};

// Размеры PNG из IHDR (без внешних декодеров)
function pngSize(buf) {
    if (!buf || buf.length < 24) return null;
    if (!buf.subarray(0, 8).equals(SIG.png)) return null;
    return {width: buf.readUInt32BE(16), height: buf.readUInt32BE(20)};
}

module.exports = { MINIMAL_JXL_B64, SIG, pngSize };