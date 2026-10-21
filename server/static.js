const fs = require('fs-extra');
const path = require('path');
const yazl = require('yazl');

const express = require('express');
const utils = require('./core/utils');
const WebWorker = require('./core/WebWorker');//singleton
const Favorites = require('./core/Favorites');
const webAppDir = require('../build/appdir');
const { bookContentType } = require('./core/book/bookFormats');
const { resolveExternalByFileType, runCmd, runCmdExport, runGui } = require('./core/externalTools');

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
                            const t = resolveExternalByFileType(config, fileType, {
                                bookExt,
                                bookFile,
                                downFileName,
                                desc,
                            });

                            if (!t)
                                throw new Error(`File type '${fileType}' is not active or has empty cmd`);

                            if (req.method === 'HEAD')
                                return res.end();

                            if (t.type === 'gui') {
                                runGui(t);
                                return res.end();
                            }

                            if (t.type === 'cmd' || t.type === 'download') {
                                try {
                                    runCmd(t);
                                } catch (e) {
                                    return res.end();
                                }

                                if (t.cmdExportLine && await fs.pathExists(t.resultFile)) {
                                    try {
                                        runCmdExport(t);
                                    } catch (e) {
                                        return res.end();
                                    }
                                }

                                if (t.type === 'download') {
                                    if (!await fs.pathExists(t.resultFile))
                                        throw new Error(`File not exists: '${t.resultFile}'`);
                                    res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(t.filename)}`);
                                    res.set('Content-Length', fs.statSync(t.resultFile).size);
                                    res.set('Cache-Control', 'private');
                                    return res.sendFile(t.resultFile);
                                }
                                return res.end();
                            }

                            throw new Error(`External tool '${t.key}': unknown type '${t.type}'`);
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