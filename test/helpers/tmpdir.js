const fs = require('fs-extra');
const os = require('os');
const path = require('path');

async function makeTmpDir(prefix = 'inpx-test-') {
    return await fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function cleanup(dir) {
    if (dir) await fs.remove(dir).catch(() => {});
}

module.exports = { makeTmpDir, cleanup };