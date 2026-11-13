const { Bot } = require('node-telegram-bot-api');

const { SessionStore } = require('./SessionStore');
const { makeAccess } = require('./access');
const { registerAll } = require('./handlers');

class TelegramBotPlugin {
    constructor(api, config) {
        this.api = api;
        this.config = config;
        this.bot = null;
        this.sessions = new SessionStore();
        this.access = makeAccess(config);
        // Telegram: inline_keyboard <= 100 кнопок; запас на «Без серии» + nav + «Меню»
        this.limit = Math.min(parseInt(config.maxResults, 10) || 10, 90);
    }

    async start() {
        const { api, config } = this;

        const major = String(api.version).split('.')[0];
        if (major !== '1') {
            api.log(LM_WARN, `[telegram-bot] unsupported api.version=${api.version}, skip`);
            return;
        }
        if (!config.token) {
            api.log(LM_WARN, '[telegram-bot] token is empty, skip');
            return;
        }
        if (!this.access.password && !this.access.allowedUsers.length) {
            api.log(LM_WARN, '[telegram-bot] accessPassword/allowedUsers empty — refusing to start public bot, skip');
            return;
        }

        try {
            await api.waitReady({ timeoutMs: 60000 });
        } catch (e) {
            api.log(LM_ERR, `[telegram-bot] waitReady failed: ${e.message}`);
            return;
        }

        this.bot = new Bot(config.token);

        // централизованная обработка ошибок (замена polling_error)
        this.bot.catch((err, ctx) => {
            const chatId = ctx && ctx.chat ? ctx.chat.id : '-';
            api.log(LM_ERR, `[telegram-bot][${chatId}] handler error: ${err && err.message ? err.message : err}`);
        });

        const ctx = {
            api,
            config,
            bot: this.bot,
            sessions: this.sessions,
            access: this.access,
            limit: this.limit,
        };

        registerAll(this.bot, ctx);

        this.sessions.startCleanup();
        this.bot.startPolling();

        api.log('[telegram-bot] started');
    }

    async stop() {
        this.sessions.stopCleanup();
        if (this.bot) {
            try { await this.bot.stop(); } catch (e) {}
            this.bot = null;
        }
    }
}

module.exports = { TelegramBotPlugin };