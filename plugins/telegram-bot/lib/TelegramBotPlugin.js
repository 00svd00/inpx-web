const TelegramBot = require('node-telegram-bot-api');

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
        this.limit = Math.min(parseInt(config.maxResults, 10) || 10, 90); // Telegram: inline_keyboard ≤ 100 кнопок; запас на «Без серии» + nav + «Меню»
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

        this.bot = new TelegramBot(config.token, { polling: true });

        const ctx = {
            api,
            config,
            bot: this.bot,
            sessions: this.sessions,
            access: this.access,
            limit: this.limit,
        };

        registerAll(this.bot, ctx);

        this.bot.on('polling_error', (err) => {
            api.log(LM_ERR, `[telegram-bot] polling_error: ${err.message}`);
        });

        api.log('[telegram-bot] started');
    }

    async stop() {
        if (this.bot) {
            try { await this.bot.stopPolling(); } catch (e) {}
            this.bot = null;
        }
    }
}

module.exports = { TelegramBotPlugin };