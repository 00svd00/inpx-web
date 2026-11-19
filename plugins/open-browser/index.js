const { spawn } = require('child_process');
const path = require('path');

const NAME = 'open-browser';

// Определяем семейство браузера по имени исполняемого файла / пути
function detectBrowserKind(browserPath) {
    if (!browserPath) return 'default';
    const base = path.basename(browserPath).toLowerCase();
    if (base.includes('firefox') || base.includes('librewolf') || base.includes('waterfox')) {
        return 'firefox';
    }
    if (base.includes('safari')) {
        return 'safari';
    }
    if (
        base.includes('chrome') ||
        base.includes('chromium') ||
        base.includes('edge') ||
        base.includes('msedge') ||
        base.includes('brave') ||
        base.includes('vivaldi') ||
        base.includes('opera') ||
        base.includes('yandex')
    ) {
        return 'chromium';
    }
    return 'unknown';
}

// Формируем команду и аргументы для открытия URL в НОВОМ ОКНЕ на каждой ОС
function buildLaunchSpec(url, browserPath, extraArgs = []) {
    const platform = process.platform;
    const kind = detectBrowserKind(browserPath);
    const args = Array.isArray(extraArgs) ? [...extraArgs] : [];

    // 1. Указан конкретный браузер в конфиге
    if (browserPath) {
        if (platform === 'darwin') {
            if (kind === 'safari') {
                const escapedUrl = url.replace(/"/g, '\\"');
                return {
                    cmd: 'osascript',
                    args: [
                        '-e', 'tell application "Safari"',
                        '-e', 'make new document',
                        '-e', `set URL of document 1 to "${escapedUrl}"`,
                        '-e', 'activate',
                        '-e', 'end tell',
                    ],
                };
            }
            const browserArgs = kind === 'chromium' || kind === 'firefox'
                ? ['--new-window', ...args, url]
                : [...args, url];

            return {
                cmd: 'open',
                args: ['-na', browserPath, '--args', ...browserArgs],
            };
        }

        if (kind === 'chromium' || kind === 'firefox') {
            return {
                cmd: browserPath,
                args: ['--new-window', ...args, url],
            };
        }

        return {
            cmd: browserPath,
            args: [...args, url],
        };
    }

    // 2. Браузер не задан — используем системный браузер по умолчанию
    if (platform === 'win32') {
        return {
            cmd: 'cmd.exe',
            args: ['/c', 'start', '""', url],
        };
    }

    if (platform === 'darwin') {
        return {
            cmd: 'open',
            args: ['-n', url],
        };
    }

    return {
        cmd: 'xdg-open',
        args: [url],
    };
}

function launchBrowser(spec) {
    return new Promise((resolve, reject) => {
        const child = spawn(spec.cmd, spec.args, {
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
        });

        child.once('error', reject);
        child.once('spawn', () => {
            child.unref();
            resolve();
        });
    });
}

function resolveTargetUrl(api, config) {
    const explicitUrl = (config.url || '').trim();
    const srv = (api.config && api.config.server) || {};
    const rawHost = String(srv.host || '').trim();
    const host = (!rawHost || rawHost === '0.0.0.0' || rawHost === '::' || rawHost === '[::]')
        ? '127.0.0.1'
        : rawHost;
    const port = srv.port || '12380';

    let url = explicitUrl || `http://${host}:${port}`;

    // Добавляем root (приоритет у server.root, фолбэк на rootPathStatic)
    const rootPath = String(srv.root || (api.config && api.config.rootPathStatic) || '').trim();
    if (rootPath && rootPath !== '/') {
        const cleanBase = url.replace(/\/+$/, '');
        const cleanRoot = rootPath.startsWith('/') ? rootPath : `/${rootPath}`;
        if (!cleanBase.endsWith(cleanRoot)) {
            url = `${cleanBase}${cleanRoot}`;
        }
    }

    return url;
}

module.exports = {
    async start(api, config) {
        const major = String(api.version).split('.')[0];
        if (major !== '1') {
            api.log(LM_WARN, `[${NAME}] unsupported api.version=${api.version}, skip`);
            return;
        }

        const url = resolveTargetUrl(api, config);
        const rootPath = (api.config && api.config.rootPathStatic) || '';
        if (rootPath && rootPath !== '/' && !url.endsWith(rootPath)) {
            const cleanBase = url.replace(/\/+$/, '');
            const cleanRoot = rootPath.startsWith('/') ? rootPath : `/${rootPath}`;
            url = `${cleanBase}${cleanRoot}`;
        }

        const browserPath = (config.browserPath || '').trim();
        const delayMs = Number.isFinite(config.delayMs) ? Math.max(0, config.delayMs) : 300;
        const readyTimeoutMs = Number.isFinite(config.readyTimeoutMs) ? config.readyTimeoutMs : 90000;

        const run = api.guard('open-on-start', async () => {
            try {
                await api.waitReady({ timeoutMs: readyTimeoutMs, intervalMs: 500 });
            } catch (e) {
                api.log(LM_WARN, `[${NAME}] waitReady failed: ${e.message}`);
                return;
            }

            if (delayMs > 0) {
                await new Promise((r) => setTimeout(r, delayMs));
            }

            const spec = buildLaunchSpec(url, browserPath, config.browserArgs);

            try {
                await launchBrowser(spec);
                api.log(`[${NAME}] opened ${url} (${browserPath || 'default browser'})`);
            } catch (err) {
                if (!browserPath && process.platform === 'linux' && err.code === 'ENOENT') {
                    const fallbacks = ['google-chrome', 'chromium', 'chromium-browser', 'firefox'];
                    for (const bin of fallbacks) {
                        try {
                            await launchBrowser(buildLaunchSpec(url, bin, config.browserArgs));
                            api.log(`[${NAME}] opened ${url} via fallback (${bin})`);
                            return;
                        } catch (_) {
                            // пробуем следующий
                        }
                    }
                }
                throw err;
            }
        });

        run();
        api.log(`[${NAME}] started`);
    },

    async stop() {
        // Браузер запущен как detached-процесс, при остановке сервера действий не требуется
    },
};
