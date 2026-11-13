const { Bot } = require('node-telegram-bot-api');

const { SessionStore } = require('./SessionStore');
const { makeAccess } = require('./access');
const { makeTg } = require('./tg');
const { makeRenders } = require('./renders');
const { makeHandlers } = require('./handlers');
const { registerRouter } = require('./router');

class TelegramBotPlugin {
    constructor(api, config) {
        this.api = api;
        this.config = config;
        this.bot = null;
        this.sessions = new SessionStore();
        this.access = makeAccess(config);
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

        try {
            await this.bot.api.setMyCommands({
                commands: [
                    { command: 'start', description: 'Меню' },
                    { command: 'author', description: 'Поиск по автору' },
                    { command: 'series', description: 'Поиск по серии' },
                    { command: 'title', description: 'Поиск по названию книги' },
                    { command: 'help', description: 'Справка' },
                ],
            });
        } catch (e) {
            api.log(LM_WARN, `[telegram-bot] setMyCommands failed: ${e.message}`);
        }

        const tg = makeTg(this.bot);
        const renders = makeRenders(api, tg);
        const ctx = { api, config, bot: this.bot, sessions: this.sessions, access: this.access, tg, renders, limit: this.limit };
        const handlers = makeHandlers(ctx);
        ctx.handlers = handlers;

        this.bot.catch((err, botCtx) => {
            const chatId = botCtx && botCtx.chat ? botCtx.chat.id : '-';
            api.log(LM_ERR, `[telegram-bot][${chatId}] handler error: ${err && err.message ? err.message : err}`);
        });

        registerRouter(this.bot, ctx);

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