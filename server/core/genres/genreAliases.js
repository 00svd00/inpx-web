// Группы эквивалентных кодов жанров.
//
// Ключ — канонический код (он есть в genresText.js).
// Значение — канон + нестандартные написания / артефакты слияния дампов
// (Librusec + Flibusta). Порядок в массиве не важен: при построении индекса
// группа сортируется, чтобы кэш-ключи были стабильны.
//
// ВАЖНО:
//  - Независимые жанры Flibusta (dark_fantasy, sf_realrpg, ...) сюда НЕ попадают —
//    они идут в genresText.js.
//  - Код не может быть в двух группах (валидируется при загрузке и в тестах).
//  - Алиасы НЕ добавляются в genresText.js, иначе будет дубль в меню.

module.exports = {
    // смысловые алиасы
    adv_indian:       ['adv_indian', 'adv_western'],
    story:            ['story', 'short_story'],
    popadancy:        ['popadancy', 'popadanec'],
    det_lady:         ['det_lady', 'det_cozy'],
    religion:         ['religion', 'religion_rel', 'religion_all'],
    military_special: ['military_special', 'military', 'military_all'],
    home_sport:       ['home_sport', 'military_arts'],

    // артефакты слияния (*_all → общий код)
    adventure:        ['adventure', 'adv_all'],
    antique:          ['antique', 'antique_all'],
    children:         ['children', 'child_all'],
    computers:        ['computers', 'comp_all'],
    detective:        ['detective', 'det_all'],
    dramaturgy:       ['dramaturgy', 'dramaturgy_all'],
    folklore:         ['folklore', 'folklore_all'],
    home:             ['home', 'home_all'],
    humor:            ['humor', 'humor_all'],
    love:             ['love', 'love_all'],
    nonfiction:       ['nonfiction', 'nonf_all'],
    other:            ['other', 'other_all'],
    poetry:           ['poetry', 'poetry_all'],
    prose:            ['prose', 'prose_all'],
    reference:        ['reference', 'ref_all'],
    sci_tech:         ['sci_tech', 'tech_all'],
    sf_etc:           ['sf_etc', 'sf_all'],
};