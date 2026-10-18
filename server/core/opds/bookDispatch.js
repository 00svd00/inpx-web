// Диспетчер для /book: при opdsBookAddonsInCard=false и наличии доп. материалов
// отдаём промежуточный каталог, иначе — обычную карточку книги.
// direct=1 жёстко форсирует карточку (используется из BookAddonsPage).
module.exports = function makeBookDispatch(config, {book, bookAddons}) {
    return {
        async body(req, res) {
            if (config.opdsBookAddonsInCard || req.query.direct)
                return book.body(req, res);

            const hasAddons = await bookAddons.hasAddons(req.query.uid);
            if (!hasAddons)
                return book.body(req, res);

            return bookAddons.body(req, res);
        },
    };
};