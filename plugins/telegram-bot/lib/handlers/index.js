function registerAll(bot, ctx) {
    require('./start').register(bot, ctx);
    require('./search').register(bot, ctx);
    require('./navigation').register(bot, ctx);
    require('./books').register(bot, ctx);
}

module.exports = { registerAll };