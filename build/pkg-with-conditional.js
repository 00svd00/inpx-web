const { execSync } = require('child_process');

// Аргументы: node pkg-with-conditional.js <target> <output> <entry>
const [, , target, output, entry] = process.argv;

if (!target || !output || !entry) {
    console.error('Usage: node pkg-with-conditional.js <target> <output> <entry>');
    console.error('Received:', { target, output, entry });
    process.exit(1);
}

console.log('argv:', process.argv);
console.log('target:', target, '| output:', output, '| entry:', entry);

// target имеет вид node22-linux-x64, node22-linux-armv7, node22-win-x64 и т.д.
// Разбираем: первая часть — nodeXX, вторая — OS, третья — ARCH
const dashIndex = target.indexOf('-');
const rest = target.substring(dashIndex + 1);
const parts = rest.split('-');
const targetOs = parts[0];                    // linux, win, macos
const targetArch = parts.slice(1).join('-');  // x64, arm64, armv7

// Нормализуем OS хоста под словарь pkg
const osMap = { win32: 'win', darwin: 'macos', linux: 'linux' };
const hostOs = osMap[process.platform] || process.platform;

// Нормализуем архитектуру хоста под словарь pkg
// process.arch для ARM возвращает 'arm', но pkg использует 'armv7'
let hostArch = process.arch;
if (hostArch === 'arm') {
    hostArch = 'armv7';
}

const isNative = (hostOs === targetOs && hostArch === targetArch);

const flags = ['-t', target, '-C', 'GZip',
    '--options', 'max-old-space-size=4096,expose-gc',
    '-o', output];

if (!isNative) {
    console.log(`[pkg-conditional] Cross-compiling ${hostOs}-${hostArch} -> ${targetOs}-${targetArch}: adding --no-bytecode`);
    flags.push('--no-bytecode', '--public-packages', '"*"', '--public');
} else {
    console.log(`[pkg-conditional] Native build for ${targetOs}-${targetArch}: keeping bytecode`);
}

const cmd = `pkg ${flags.join(' ')} ${entry}`;
console.log(`[pkg-conditional] Running: ${cmd}`);
execSync(cmd, { stdio: 'inherit' });