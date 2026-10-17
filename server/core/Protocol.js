// Версия WS-протокола между потребителем и поставщиком.
// Растёт при несовместимых изменениях набора actions или их формата.
// 1 — get-inpx-file, get-book-link
// 2 — + get-config.features/protocolVersion, get-reviews-index, get-authors-index
const PROTOCOL_VERSION = 2;

module.exports = { PROTOCOL_VERSION };