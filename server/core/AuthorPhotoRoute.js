const log = new (require('./AppLogger'))().log;//singleton
const WebWorker = require('./WebWorker');//singleton

module.exports = function(app, config, options = {}) {
    if (!config.authorsBioEnabled)
        return;

    const path = `${config.rootPathStatic}/author/photo`;

    app.get(path, async (req, res) => {
        try {
            const hash = req.query.hash;
            if (!hash || !/^[a-f0-9]{32}$/i.test(hash))
                return res.status(400).send('bad hash');

            const webWorker = options.webWorker || new WebWorker(config);

            // 404 при authors_disabled / отсутствии фото — не ломаем UI
            const photo = await webWorker.getAuthorPhoto(hash).catch(() => null);
            if (!photo) {
                res.set('Cache-Control', 'no-cache');
                return res.status(404).send('not found');
            }
            res.set('Content-Type', webWorker.getAuthorPhotoMime(photo.ext));
            res.set('Cache-Control', 'public, max-age=604800');
            res.sendFile(photo.path);
        } catch (e) {
            log(LM_ERR, `Author photo: ${e.message}`);
            res.status(500).send('error');
        }
    });
};