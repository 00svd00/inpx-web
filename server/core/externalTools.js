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
// правило ключа синхронизировано с client/share/externalItems.js (KEY_RE)
function parseExternalKey(fileType) {
    const m = /^ext-([0-9a-z_]+)$/i.exec(String(fileType || ''));
    return (m ? m[1] : null);
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

module.exports = { isAvailable, resolveExternal, resolveExternalByFileType, parseExternalKey, runCmd, runCmdExport, runGui, normExt };