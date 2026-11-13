const fs = require('fs-extra');
const path = require('path');

const { PluginApi, API_VERSION } = require('./PluginApi');

// Динамический require по абсолютному пути: плагины лежат вне pkg-снапшота,
// esbuild не должен пытаться их разрешать. Паттерн — как в bookImages.js.
function requireAbsolute(file) {
    // eslint-disable-next-line no-eval
    return eval('require')(file);
}

// Маскирование секретов для логов (в плагин уходит оригинал).
function maskSecrets(cfg) {
    if (!cfg || typeof cfg !== 'object')
        return cfg;
    const out = Object.assign({}, cfg);
    for (const k of ['token', 'accessPassword', 'password', 'secret'])
        if (k in out && out[k])
            out[k] = '***';
    return out;
}

class PluginManager {
    constructor(config, webWorker, logger) {
        this.config = config;
        this.webWorker = webWorker;
        // DI: в проде — singleton AppLogger; в тестах — fake.
        this._logger = logger || new (require('./AppLogger'))();
        this.plugins = new Map(); // id -> {api, config, module}
        this._onUnhandled = null;
    }

    get pluginsDir() {
        return this.config.pluginsDir || path.join(this.config.dataDir, 'plugins');
    }

    _log(levelOrMsg, msg) {
        try {
            if (msg === undefined)
                this._logger.log(String(levelOrMsg));
            else
                this._logger.log(levelOrMsg, String(msg));
        } catch (e) {
            console.log(`[PluginManager] ${msg === undefined ? levelOrMsg : msg}`);
        }
    }

    // Изоляция падений плагинов: unhandledRejection, чей стек указывает на pluginsDir,
    // логируется и поглощается (плагин не роняет ядро). "Чужие" rejection — тоже
    // логируются, но не валят процесс (поведение ядра: явные exit — через asyncExit).
    _installUnhandledGuard() {
        if (this._onUnhandled)
            return;

        const pluginsDirAbs = path.resolve(this.pluginsDir);

        this._onUnhandled = (reason) => {
            const msg = reason && reason.message ? reason.message : String(reason);
            const stack = reason && reason.stack ? String(reason.stack) : '';
            if (stack.includes(pluginsDirAbs)) {
                this._log(LM_ERR, `Plugins: unhandledRejection (swallowed): ${msg}`);
                return;
            }
            // не наш — логируем, но не валим (ядро использует asyncExit для явных exit)
            this._log(LM_ERR, `unhandledRejection (outside plugins): ${msg}`);
        };

        process.on('unhandledRejection', this._onUnhandled);
    }

    _removeUnhandledGuard() {
        if (this._onUnhandled) {
            process.off('unhandledRejection', this._onUnhandled);
            this._onUnhandled = null;
        }
    }

    async start() {
        if (!this.config.pluginsEnabled) {
            this._log('Plugins: disabled');
            return;
        }

        this._installUnhandledGuard();

        const dir = this.pluginsDir;
        await fs.ensureDir(dir);

        let names;
        try {
            names = await fs.readdir(dir);
        } catch (e) {
            this._log(LM_WARN, `Plugins: readdir ${dir}: ${e.message}`);
            return;
        }

        for (const name of names.sort()) {
            const pluginDir = path.join(dir, name);
            try {
                const st = await fs.stat(pluginDir);
                if (!st.isDirectory())
                    continue;
                await this._loadPlugin(name, pluginDir);
            } catch (e) {
                this._log(LM_ERR, `Plugins: ${name}: ${e.message}`);
            }
        }

        this._log(`Plugins: loaded ${this.plugins.size} of ${names.length}`);
    }

    async _loadPlugin(id, dir) {
        const cfgFile = path.join(dir, 'config.json');
        let cfg = {};
        try {
            cfg = JSON.parse(await fs.readFile(cfgFile, 'utf8'));
        } catch (e) {
            this._log(LM_WARN, `Plugins: ${id}: config.json: ${e.message}`);
        }

        if (!cfg.enabled) {
            this._log(`Plugins: ${id}: disabled`);
            return;
        }

        // сверка версии API (major)
        const apiMajor = String(API_VERSION).split('.')[0];
        const plugMajor = String(cfg.apiVersion || API_VERSION).split('.')[0];
        if (plugMajor !== apiMajor) {
            this._log(LM_WARN, `Plugins: ${id}: apiVersion ${cfg.apiVersion} incompatible with ${API_VERSION}, skip`);
            return;
        }

        const entry = path.join(dir, 'index.js');
        if (!await fs.pathExists(entry)) {
            this._log(LM_WARN, `Plugins: ${id}: index.js not found`);
            return;
        }

        let mod;
        try {
            mod = requireAbsolute(entry);
        } catch (e) {
            this._log(LM_ERR, `Plugins: ${id}: require failed: ${e.message}`);
            return;
        }

        if (!mod || typeof mod.start !== 'function') {
            this._log(LM_WARN, `Plugins: ${id}: start() not found`);
            return;
        }

        const api = new PluginApi({
            config: this.config,
            webWorker: this.webWorker,
            pluginId: id,
            logger: this._logger,
        });

        try {
            await mod.start(api, cfg);
            this.plugins.set(id, { api, config: cfg, module: mod });
            this._log(`Plugins: ${id}: started (api ${API_VERSION}, config ${JSON.stringify(maskSecrets(cfg))})`);
        } catch (e) {
            this._log(LM_ERR, `Plugins: ${id}: start failed: ${e.message}`);
        }
    }

    async stopAll() {
        for (const [id, p] of this.plugins) {
            try {
                if (p.module && typeof p.module.stop === 'function')
                    await p.module.stop();
            } catch (e) {
                this._log(LM_WARN, `Plugins: ${id}: stop: ${e.message}`);
            }
        }
        this.plugins.clear();
        this._removeUnhandledGuard();
        this._log('Plugins: stopped');
    }
}

module.exports = PluginManager;