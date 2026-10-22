const fs = require('fs-extra');
const path = require('path');
const { exec, execSync } = require('child_process');

const log = new (require('./AppLogger'))().log; // singleton

// external tools: единое место «что за инструмент и как его запускать».
// static.js — отдача/выполнение; opds/BookPage.js — только isAvailable + download-ссылка.
//
// onlyExt — список разрешённых расширений книги (без точки, lower).
// Нормализация — здесь (normExt), static.js/BookPage.js передают book.ext как есть.

function normExt(v) {
    return String(v || '').toLowerCase().replace(/^\./, '');
}
function parseExternalKey(fileType) {
    const m = /^ext-([0-9a-z_]+)$/i.exec(String(fileType || ''));
    return (m ? m[1] : null);
}

const VALID_TYPES = ['download', 'gui', 'cmd', 'link'];

// Нормализация конфига external на старте: невалидные записи → active: false,
// мягкие поля (onlyExt/ext/title/hint/debug) приводятся к ожидаемому виду.
// После этого клиенту не нужна валидация ключа — только фильтр по active/cmd/onlyExt.
function normalizeExternal(external) {
    if (!external || typeof external !== 'object')
        return {};

    for (const [key, item] of Object.entries(external)) {
        if (!/^[0-9a-z_]+$/i.test(key)) {
            if (item && typeof item === 'object')
                item.active = false;
            continue;
        }
        if (!item || typeof item !== 'object') {
            external[key] = { active: false };
            continue;
        }
        if (!VALID_TYPES.includes(item.type)) {
            item.active = false;
            continue;
        }

        // обязательное поле зависит от type: link → link, остальные → cmd
        if (item.type === 'link') {
            if (typeof item.link !== 'string' || item.link.trim() === '') {
                item.active = false;
                continue;
            }
        } else {
            if (typeof item.cmd !== 'string' || item.cmd.trim() === '') {
                item.active = false;
                continue;
            }
        }

        // мягкие нормализации
        if (!Array.isArray(item.onlyExt)) {
            item.onlyExt = [];
        } else {
            item.onlyExt = item.onlyExt.map(normExt).filter(v => v !== '');
        }
        if (typeof item.ext !== 'string')
            item.ext = undefined;
        if (typeof item.title !== 'string')
            item.title = undefined;
        if (typeof item.hint !== 'string')
            item.hint = undefined;
        item.debug = !!item.debug;
    }

    return external;
}

function resolveExternalByFileType(config, fileType, params) {
    const key = parseExternalKey(fileType);
    if (!key)
        return null;
    return resolveExternal(config, key, params);
}

// доступен ли инструмент для данной книги (без выполнения)
// active — включён; cmd — есть; onlyExt — список разрешённых ext (пусто/нет = все)
function isAvailable(config, key, bookExt) {
    const ext = config && config.external && config.external[key];
    if (!ext || !ext.active || !ext.cmd)
        return false;
    if (Array.isArray(ext.onlyExt) && ext.onlyExt.length) {
        const be = normExt(bookExt);
        if (!ext.onlyExt.map(normExt).includes(be))
            return false;
    }
    return true;
}

// нормализованный дескриптор для выполнения; null — недоступен
// params: {bookExt, bookFile, downFileName, desc}
function resolveExternal(config, key, params) {
    const { bookExt, bookFile, downFileName, desc } = params;
    if (!isAvailable(config, key, bookExt))
        return null;

    const ext = config.external[key];
    const resultExt = ext.ext || key; // расширение результата (ext.ext), не путать с onlyExt
    const be = normExt(bookExt);
    const cwd = path.dirname(config.externalToolsConfig || config.configFile || '');

    const extVar = {
        BOOKFILE: bookFile,
        HASHFILE: path.basename(bookFile),
        RESULTFILE: `${bookFile}.${resultExt}`,
        FILENAME: (downFileName || '').replace(/\.[^.]+$/, `.${resultExt}`),
        EXTDIR: cwd,
        LIBFOLDER: desc && desc.libFolder,
        LIBFILE: desc && desc.libFile,
        BOOKEXT: be,
    };

    const re = new RegExp('\\$\\{(.*?)\\}', 'gi');
    const subst = (s) => String(s || '').replace(re, (m, name) => {
        const v = extVar[name];
        return (v === undefined || v === null ? m : v);
    });

    return {
        key,
        type: ext.type,          // строго, без дефолта (undefined → ошибка в static.js)
        debug: !!ext.debug,
        cwd,
        extVar,
        cmdLine: subst(ext.cmd),
        cmdExportLine: ext.cmdExport ? subst(ext.cmdExport) : '',
        resultFile: extVar.RESULTFILE,
        filename: extVar.FILENAME,
        resultExt,
    };
}

function runCmd(t) {
    try {
        const out = execSync(t.cmdLine, {
            cwd: path.dirname(t.extVar.BOOKFILE),
            windowsHide: t.debug ? false : true,
            timeout: 60000,
        });
        if (t.debug)
            log('CMD_stdout: ' + out.toString());
    } catch (e) {
        log(LM_ERR, e);
        if (e && e.stderr)
            log(LM_ERR, e.stderr.toString());
        throw e;
    }
}

function runCmdExport(t) {
    try {
        const out = execSync(t.cmdExportLine, {
            cwd: path.dirname(t.extVar.BOOKFILE),
            windowsHide: t.debug ? false : true,
            timeout: 60000,
        });
        if (t.debug)
            log('CMD_stdout: ' + out.toString());
    } catch (e) {
        log(LM_ERR, e);
        if (e && e.stderr)
            log(LM_ERR, e.stderr.toString());
        throw e;
    }
}

// gui: запускаем и не ждём; страница сразу res.end()
function runGui(t) {
    try {
        exec(t.cmdLine, {
            cwd: path.dirname(t.extVar.BOOKFILE),
            windowsHide: false,
        }, (error, stdout, stderr) => {
            if (error) {
                log(LM_ERR, error);
                return;
            }
            if (t.debug) {
                log('CMD_stdout: ' + stdout);
                log('CMD_stderr: ' + stderr);
            }
        });
    } catch (e) {
        log(LM_ERR, e);
        if (e && e.stderr)
            log(LM_ERR, e.stderr.toString());
    }
}

module.exports = { isAvailable, resolveExternal, resolveExternalByFileType, parseExternalKey, normalizeExternal, runCmd, runCmdExport, runGui, normExt };