const fs = require('fs-extra');
const path = require('path');
const utils = require('./utils');
const crypto = require('crypto');

const FileDownloader = require('./FileDownloader');
const WebSocketConnection = require('./WebSocketConnection');
const InpxHashCreator = require('./InpxHashCreator');
const { PROTOCOL_VERSION } = require('./Protocol');
const log = new (require('./AppLogger'))().log;//singleton

//singleton
let instance = null;

class RemoteLib {
    constructor(config) {
        if (!instance) {
            this.config = config;

            this.wsc = new WebSocketConnection(config.remoteLib.url, 10, 30, {rejectUnauthorized: false});

            // url может содержать путь (например, ws://host/flibusta за nginx).
            // WebSocket подключается по url целиком, а для HTTP-скачивания книг
            // берём origin + basePath и склеиваем с link от поставщика:
            // link уже содержит rootPathStatic (bookPathStatic = rootPathStatic + '/book'),
            // поэтому basePath добавляем только если link его не содержит.
            const u = new URL(config.remoteLib.url.replace(/^ws:\/\//, 'http://').replace(/^wss:\/\//, 'https://'));
            this.remoteHost = u.origin;
            this.remoteBasePath = u.pathname.replace(/\/$/, ''); // '/flibusta' или ''

            this.down = new FileDownloader(config.maxPayloadSize*1024*1024);
            this.inpxHashCreator = new InpxHashCreator(config);
            this.inpxFileHash = '';

            this.handshakeDone = false;
            this.providerProtocolVersion = 0;
            this.providerFeatures = {};

            instance = this;
        }

        return instance;
    }

    async wsRequest(query, recurse = false) {
        if (this.accessToken)
            query.accessToken = this.accessToken;

        const response = await this.wsc.message(
            await this.wsc.send(query),
            120
        );

        if (!recurse && response && response.error == 'need_access_token' && this.config.remoteLib.accessPassword) {
            this.accessToken = utils.getBufHash(this.config.remoteLib.accessPassword + response.salt, 'sha256', 'hex');
            return await this.wsRequest(query, true);
        }

        if (response.error)
            throw new Error(response.error);

        return response;
    }

    // проверка совместимости с поставщиком (один раз)
    async handshake() {
        if (this.handshakeDone)
            return;

        const cfg = await this.wsRequest({action: 'get-config'});
        if (!cfg.protocolVersion)
            throw new Error('provider_too_old: protocolVersion missing. Update provider.');

        if (cfg.protocolVersion !== PROTOCOL_VERSION)
            throw new Error(`protocol_mismatch: provider=${cfg.protocolVersion}, consumer=${PROTOCOL_VERSION}. Update provider or consumer.`);

        this.providerProtocolVersion = cfg.protocolVersion;
        this.providerFeatures = cfg.features || {};
        this.handshakeDone = true;
    }

    async downloadInpxFile() {
        await this.handshake();

        if (!this.inpxFileHash)
            this.inpxFileHash = await this.inpxHashCreator.getInpxFileHash();

        const response = await this.wsRequest({action: 'get-inpx-file', inpxFileHash: this.inpxFileHash});

        if (response.data) {
            await fs.writeFile(this.config.inpxFile, response.data, 'base64');
            this.inpxFileHash = '';
        }
    }

    // скачивание дампов reviews_index / authors_info у поставщика.
    // Возвращает {reviews_index: path|null, authors_info: path|null}.
    async downloadIndexes(config) {
        await this.handshake();

        const result = {reviews_index: null, authors_info: null};

        const items = [
            ['reviews_index', 'reviewsEnabled', 'reviews_index.json.gz'],
            ['authors_info', 'authorsBioEnabled', 'authors_info.json.gz'],
        ];

        for (const [table, featureKey, localFile] of items) {
            if (!config[featureKey]) {
                // у потребителя фича выключена — не качаем
                continue;
            }

            if (!this.providerFeatures.indexes || !this.providerFeatures.indexes.includes(table)) {
                log(LM_WARN, `${table}: unavailable on provider (no index built), will be disabled`);
                continue;
            }

            const filePath = path.join(config.dataDir, localFile);
            const hashFile = `${filePath}.hash`;

            let localHash = '';
            try { localHash = (await fs.readFile(hashFile, 'utf8')).trim(); } catch (e) {}

            const res = await this.wsRequest({action: 'get-index', table, hash: localHash || undefined});

            if (!res.data && localHash && res.hash === localHash) {
                // не изменилось — используем локальный дамп
                result[table] = filePath;
                continue;
            }

            if (!res.data) {
                // поставщик не отдал (фича выключена на поставщике) — деградация
                // почистим локальный дамп, чтобы не путаться
                try { await fs.remove(filePath); await fs.remove(hashFile); } catch (e) {}
                result[table] = null;
                continue;
            }

            const buf = Buffer.from(res.data, 'base64');
            await fs.writeFile(filePath, buf);
            await fs.writeFile(hashFile, res.hash);
            result[table] = filePath;
        }

        return result;

    }
    
    // проверка целостности локального дампа: sha256(файл) === .hash
    async isDumpValid(config, localFile) {
        const filePath = path.join(config.dataDir, localFile);
        const hashFile = `${filePath}.hash`;

        try {
            if (!await fs.pathExists(filePath) || !await fs.pathExists(hashFile))
                return false;

            const expected = (await fs.readFile(hashFile, 'utf8')).trim();
            if (!expected)
                return false;

            const buf = await fs.readFile(filePath);
            const actual = crypto.createHash('sha256').update(buf).digest('hex');

            return actual === expected;
        } catch (e) {
            log(LM_WARN, `isDumpValid(${localFile}): ${e.message}`);
            return false;
        }
    }

    // Скачивает файл с поставщика по прямой ссылке link (из wsRequest).
    // Без try/catch — ошибки летят в обёртку (downloadBook/downloadReview/...).
    async downloadRemote(link, localPath) {
        if (!link)
            throw new Error('no link');

        // basePath: за nginx с proxy_pass .../ (link без префикса)
        let linkPath = link;
        if (this.remoteBasePath
            && linkPath !== this.remoteBasePath
            && !linkPath.startsWith(this.remoteBasePath + '/')) {
            linkPath = this.remoteBasePath + (linkPath.startsWith('/') ? linkPath : '/' + linkPath);
        }

        const url = `${this.remoteHost}${linkPath}`;
        const buf = await this.down.load(url, {decompress: false});

        await fs.ensureDir(path.dirname(localPath));
        await fs.writeFile(localPath, buf);

        return localPath;
    }

    async downloadBook(bookUid) {
        try {
            const response = await this.wsRequest({action: 'get-book-link', bookUid});
            const link = response.link;
            const hash = path.basename(link);
            await this.downloadRemote(link, `${this.config.bookDir}/${hash}`);
            return hash;
        } catch (e) {
            log(LM_ERR, `RemoteLib.downloadBook: ${e.message}`);
            throw new Error('502 Bad Gateway');
        }
    }

    async downloadReview(bookUid) {
        try {
            const response = await this.wsRequest({action: 'get-review-link', bookUid});
            const link = response.link;
            const hash = path.basename(link, '.review');
            await this.downloadRemote(link, `${this.config.bookDir}/${hash}.review`);
            return hash;
        } catch (e) {
            log(LM_ERR, `RemoteLib.downloadReview: ${e.message}`);
            throw new Error('502 Bad Gateway');
        }
    }

    async downloadBio(hash) {
        try {
            const response = await this.wsRequest({action: 'get-bio-link', hash});
            const link = response.link;
            const fileName = path.basename(link);
            await this.downloadRemote(link, `${this.config.authorDir}/${fileName}`);
            return hash;
        } catch (e) {
            log(LM_ERR, `RemoteLib.downloadBio: ${e.message}`);
            throw new Error('502 Bad Gateway');
        }
    }

    async downloadPhoto(hash) {
        try {
            const response = await this.wsRequest({action: 'get-photo-link', hash});
            const link = response.link;
            const fileName = path.basename(link);   // <hash>.<ext> или <hash>.nophoto
            await this.downloadRemote(link, `${this.config.authorDir}/${fileName}`);

            // при появлении фото маркер «фото нет» больше не актуален
            if (!fileName.endsWith('.nophoto')) {
                try { await fs.remove(`${this.config.authorDir}/${hash}.nophoto`); } catch (e) {}
            }
            return hash;
        } catch (e) {
            log(LM_ERR, `RemoteLib.downloadPhoto: ${e.message}`);
            throw new Error('502 Bad Gateway');
        }
    }
}

module.exports = RemoteLib;