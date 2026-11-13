const { TelegramBotPlugin } = require('./lib/TelegramBotPlugin');

module.exports = {
    async start(api, config) {
        const plugin = new TelegramBotPlugin(api, config);
        await plugin.start();
        module.exports._plugin = plugin;
    },
    async stop() {
        if (module.exports._plugin) {
            await module.exports._plugin.stop();
            module.exports._plugin = null;
        }
        console.log('[telegram-bot] stopped');
    },
};