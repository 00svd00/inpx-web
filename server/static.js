const fs = require('fs-extra');
const path = require('path');
const yazl = require('yazl');

const express = require('express');
const utils = require('./core/utils');
const WebWorker = require('./core/WebWorker');//singleton
const Favorites = require('./core/Favorites');
const webAppDir = require('../build/appdir');
const {exec, execSync} = require('child_process');

const log = new (require('./core/AppLogger'))().log;//singleton

function generateZip(zipFile, dataFile, dataFileInZip) {
    return new Promise((resolve, reject) => {
        const zip = new yazl.ZipFile();
        zip.addFile(dataFile, dataFileInZip);
        zip.outputStream
            .pipe(fs.createWriteStream(zipFile)).on('error', reject)
            .on('finish', (err) => {
                if (err) reject(err);
                else resolve();
            }
        );
        zip.end();
    });
}

//Content-Type книги по ее расширению: на диске файл назван хешем, и express
//отдает application/octet-stream - клиент не понимает, что именно скачал.
//Типы те же, что сервер объявляет в OPDS (см. core/opds/BookPage.js)
function bookContentType(downFileName) {
    const isZip = (path.extname(downFileName).toLowerCase() === '.zip');
    const name = (isZip ? path.basename(downFileName, path.extname(downFileName)) : downFileName);
    const ext = path.extname(name).substring(1).toLowerCase();

    if (!ext)
        return (isZip ? 'application/zip' : '');

    if (ext === 'mobi')
        return 'application/x-mobipocket-ebook';

    if (ext === 'epub')
        return 'application/epub+zip';

    return `application/${ext}${isZip ? '+zip' : ''}`;
}

//книга отдана клиенту — кладем ее на полку «Избранное»
async function addToFavorites(config, desc, hash, descFile) {
    try {
        const favConfig = config.favorites || {};
        if (!favConfig.enabled || !favConfig.autoAdd || !desc)
            return;

        const webWorker = new WebWorker(config);

        let bookUid = desc.bookUid;
        if (!bookUid && hash) {
            bookUid = await webWorker.getBookUidByHash(hash);
            if (bookUid) {
                desc.bookUid = bookUid;
                await fs.writeFile(descFile, JSON.stringify(desc));
            }
        }

        if (!bookUid)
            return;
        const book = await webWorker.getBookRecord(bookUid);
        await (new Favorites(config)).add(bookUid, book || {});
    } catch (e) {
        log(LM_ERR, `favorites add error: ${e.message}`);
    }
}

module.exports = (app, config) => {
    /*
    config.bookPathStatic = `${config.rootPathStatic}/book`;
    config.bookDir = `${config.publicFilesDir}/book`;
    */
    //tolino качает книги методом POST: для отдачи файла это тот же GET, иначе express отвечает 404
    app.use(config.bookPathStatic, (req, res, next) => {
        if (req.method === 'POST')
            req.method = 'GET';

        return next();
    });

    //загрузка или восстановление файлов в /public-files, при необходимости
    app.use([`${config.bookPathStatic}/:fileName/:fileType`, `${config.bookPathStatic}/:fileName`], async(req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            return next();
        }

        try {
            const fileName = req.params.fileName;
            const fileType = req.params.fileType;

            if (path.extname(fileName) === '') {//восстановление файлов {hash}.raw, {hash}.zip
                let bookFile = path.resolve(`${config.bookDir}/${fileName}`);
                const bookFileDesc = `${bookFile}.d.json`;

                //восстановим из json-файла описания
                if (await fs.pathExists(bookFile) && await fs.pathExists(bookFileDesc)) {
                    await utils.touchFile(bookFile);
                    await utils.touchFile(bookFileDesc);

                    const desc = JSON.parse(await fs.readFile(bookFileDesc, 'utf8'));
                    let downFileName = desc.downFileName;

                    // epub в кеше — zip как есть (restoreBook не гзипит epub); остальное — gzip
                    const bookExt = path.extname(desc.libFile || desc.downFileName || '').toLowerCase();
                    const isGzipStored = (bookExt !== '.epub');

                    let gzipped = isGzipStored;

                    if (!req.acceptsEncodings('gzip') || fileType) {
                        const rawFile = `${bookFile}.raw`;

                        // источник «сырого» файла: для gzip — распакованный raw, для epub — сам <hash> (zip)
                        let rawSrc = bookFile;
                        if (isGzipStored) {
                            if (!await fs.pathExists(rawFile))
                                await utils.gunzipFile(bookFile, rawFile);
                            rawSrc = rawFile;
                        }
                        gzipped = false;

                        if (fileType === undefined || fileType === 'raw') {
                            bookFile = rawSrc;
                        } else if (fileType === 'zip') {
                            bookFile += '.zip';
                            if (!await fs.pathExists(bookFile))
                                await generateZip(bookFile, rawSrc, downFileName);
                            downFileName += '.zip';
                        } else {
                            let extType = fileType.match(/^ext-([0-9a-z]+)$/i);
                            if (extType && config.external[extType[1]]) {
                                // external tools: BOOKFILE = <hash> (как раньше, для gzip это <hash>, не raw)
                                let ext = config.external[extType[1]];
                                ext.ext = ext.ext || extType[1];

                                if (!ext.active || !ext.cmd) {
                                    throw new Error(`File type '${extType[0]}' is not active or has empty cmd`);
                                }

                                if (req.method === 'HEAD')
                                    return res.end();

                                let extVar = {
                                    BOOKFILE: bookFile,
                                    HASHFILE: path.basename(bookFile),
                                    RESULTFILE: `${bookFile}.${ext.ext}`,
                                    FILENAME: downFileName.replace(/\.fb2$/, `.${ext.ext}`),
                                    EXTDIR: path.dirname(config.externalToolsConfig),
                                    LIBFOLDER: desc.libFolder,
                                    LIBFILE: desc.libFile,
                                };

                                let re = new RegExp("\\$\\{(.*?)\\}","gi");
                                let cmd_line = ext.cmd.replace(re, function(matched){
                                    return extVar[matched.replace(/[${}]/g, "")] || matched;
                                });

                                if (ext.debug)
                                    log(`CMD_EXEC: ${cmd_line}`);

                                //можно запускать GUI, например, локальную читалку или какой-то редактор/конвертер с интерфейсом
                                if (ext.type === "gui") {
                                    try {
                                        let cmd = exec(cmd_line, {
                                            cwd: path.dirname(bookFile),
                                            windowsHide: false,
                                        }, (error, stdout, stderr) => {
                                            if (error) {
                                                log(LM_ERR, error);
                                                return res.end();
                                            }
                                            if (ext.debug) {
                                                log(`CMD_stdout: ${stdout}`);
                                                log(`CMD_stderr: ${stderr}`);
                                            }
                                        });
                                    } catch (e) {
                                        log(LM_ERR, e);
                                        log(LM_ERR, e.stderr.toString());
                                    }
                                    return res.end();
                                }

                                //запуск cmd конвертера
                                try {
                                    let cmd = execSync(cmd_line, {
                                        cwd: path.dirname(bookFile),
                                        windowsHide: ext.debug ? false : true,
                                        timeout: 60000,
                                    });
                                    if (ext.debug)
                                        log("CMD_stdout: " + cmd.toString());
                                } catch (e) {
                                    log(LM_ERR, e);
                                    log(LM_ERR, e.stderr.toString());
                                    return res.end();
                                }

                                //если есть cmdExport и есть результат работы конвертера(RESULTFILE), то запускается cmdExport
                                if (ext.cmdExport && await fs.pathExists(extVar.RESULTFILE)) {
                                    cmd_line = ext.cmdExport.replace(re, function(matched){
                                        return extVar[matched.replace(/[${}]/g, "")] || matched;
                                    });
                                    if (ext.debug)
                                        log(`CMD_EXPORT: ${cmd_line}`);
                                    try {
                                        let cmd = execSync(cmd_line, {
                                            cwd: path.dirname(bookFile),
                                            windowsHide: ext.debug ? false : true,
                                            timeout: 60000,
                                        });
                                        if (ext.debug)
                                            log("CMD_stdout: " + cmd.toString());
                                    } catch (e) {
                                        log(LM_ERR, e);
                                        log(LM_ERR, e.stderr.toString());
                                        return res.end();
                                    }
                                }

                                if (ext.type === "download") {
                                    if (!await fs.pathExists(extVar.RESULTFILE))
                                        throw new Error(`File not exists: '${extVar.RESULTFILE}'`);
                                    //тут нужно посмотреть, что лучше inline или attachment. на inline может браузер со своими действиями влезть
                                    //res.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(extVar.FILENAME)}`);
                                    //res.set('Content-Type', 'application/octet-stream');
                                    res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(extVar.FILENAME)}`);
                                    res.set('Content-Length', fs.statSync(extVar.RESULTFILE).size);
                                    res.set('Cache-Control', 'private');
                                    return res.sendFile(extVar.RESULTFILE);
                                }
                                return res.end();
                            }
                            throw new Error(`Unsupported file type: ${fileType}`);
                        }
                    }

                    //отдача файла
                    if (gzipped)
                        res.set('Content-Encoding', 'gzip');
                    res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(downFileName)}`);

                    const contentType = bookContentType(downFileName);
                    if (contentType)
                        res.type(contentType);

                    res.sendFile(bookFile);

                    if (req.method === 'GET')
                        addToFavorites(config, desc, fileName, bookFileDesc);

                    return;
                } else {
                    await fs.remove(bookFile);
                    await fs.remove(bookFileDesc);
                }
            }
        } catch(e) {
            log(LM_ERR, e.message);
        }

        return next();
    });

    //иначе просто отдаем запрошенный файл из /public-files
    app.use(config.bookPathStatic, express.static(config.bookDir, {
        setHeaders(res, filePath) {
            const name = path.basename(filePath);
            if (name.endsWith('.review')) {
                res.set('Content-Type', 'application/json; charset=utf-8');
                res.set('Content-Encoding', 'gzip');
                res.set('Cache-Control', 'no-cache');
            }
        },
    }));
    
    // статика авторов: <hash>.bio (gzip HTML), <hash>.<ext> (фото), <hash>.nophoto (0 байт)
    const authorPathStatic = `${config.rootPathStatic}/author`;
    app.use(authorPathStatic, express.static(config.authorDir, {
        setHeaders(res, filePath) {
            const name = path.basename(filePath);
            if (name.endsWith('.bio')) {
                res.set('Content-Type', 'text/html; charset=utf-8');
                res.set('Content-Encoding', 'gzip');
                res.set('Cache-Control', 'no-cache');
            } else if (name.endsWith('.nophoto')) {
                res.set('Content-Type', 'application/octet-stream');
                res.set('Cache-Control', 'no-cache');
            } else if (/\.(jpe?g|png|gif|webp)$/i.test(name)) {
                res.set('Cache-Control', 'public, max-age=604800');
            }
        },
    }));

    if (config.rootPathStatic) {
        //подмена rootPath в файлах статики WebApp при необходимости
        app.use(config.rootPathStatic, async(req, res, next) => {
            if (req.method !== 'GET' && req.method !== 'HEAD') {
                return next();
            }

            try {
                const reqPath = (req.path == '/' ? '/index.html' : req.path);
                const ext = path.extname(reqPath);
                if (ext == '.html' || ext == '.js' || ext == '.css') {
                    const reqFile = `${config.publicDir}${reqPath}`;
                    const flagFile = `${reqFile}.replaced`;

                    let replaced = false;
                    try {
                        replaced = (await fs.readFile(flagFile, 'utf8')) === config.rootPathStatic;
                    } catch (e) {
                        replaced = false;
                    }

                    if (!replaced && await fs.pathExists(reqFile)) {
                        const content = await fs.readFile(reqFile, 'utf8');
                        const re = new RegExp(`/${webAppDir}`, 'g');
                        await fs.writeFile(reqFile, content.replace(re, `${config.rootPathStatic}/${webAppDir}`));
                        await fs.writeFile(flagFile, config.rootPathStatic);
                    }
                }
            } catch(e) {
                log(LM_ERR, e.message);
            }

            return next();
        });
    }

    //статика файлов WebApp
    app.use(config.rootPathStatic, express.static(config.publicDir, {
        setHeaders(res, filePath) {
            const name = path.basename(filePath);
            if (name === 'index.html' || name === 'version.txt') {
                res.set('Cache-Control', 'no-cache');
            } else if (/\.(js|css|woff2?|ttf|eot|png|jpe?g|gif|svg)$/.test(name)) {
                res.set('Cache-Control', 'public, max-age=31536000, immutable');
            }
        },
    }));
};