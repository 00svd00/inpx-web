// Выполняется до тестов через `node --require`.
// AppLogger — singleton; DbCreator/RemoteLib/WebSocketController делают
// `new (require('./AppLogger'))().log` на верхнем уровне модуля и падают,
// если logger не инициализирован. Синхронный аналог init({loggingEnabled:false}).
const AppLogger = require('../../server/core/AppLogger');
const Logger = require('../../server/core/Logger');

const appLogger = new AppLogger();
if (!appLogger.inited) {
    appLogger._logger = new Logger([{ log: 'ConsoleLog' }]);
    appLogger.inited = true;
}