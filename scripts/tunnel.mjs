/**
 * Mini App uchun HTTPS tunnel ochadi (Cloudflare quick tunnel — akkaunt kerak emas)
 * va olingan manzilni .env dagi WEBAPP_URL ga avtomatik yozib qo'yadi.
 *
 *   npm run tunnel
 *
 * Oyna ochiq turgan vaqtdagina manzil ishlaydi. Yopilsa, qayta ishga tushiring
 * (manzil o'zgaradi va .env yangilanadi).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');

const port = process.argv[2] ?? readEnv('PORT') ?? '3000';

function readEnv(key) {
  if (!fs.existsSync(envPath)) return null;
  const m = fs.readFileSync(envPath, 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'));
  return m ? m[1].trim() : null;
}

function writeWebappUrl(url) {
  if (!fs.existsSync(envPath)) {
    console.error('\n.env fayli topilmadi. Avval: cp .env.example .env');
    return false;
  }
  const content = fs.readFileSync(envPath, 'utf8');
  const line = `WEBAPP_URL=${url}`;
  const updated = /^WEBAPP_URL=.*$/m.test(content)
    ? content.replace(/^WEBAPP_URL=.*$/m, line)
    : `${content.trimEnd()}\n${line}\n`;
  fs.writeFileSync(envPath, updated);
  return true;
}

/**
 * cloudflared ni topish. Yangi o'rnatilgan bo'lsa, ochiq turgan terminalning PATH i
 * hali yangilanmagan bo'lishi mumkin — shuning uchun odatiy joylar ham tekshiriladi.
 */
function findCloudflared() {
  const candidates =
    process.platform === 'win32'
      ? [
          'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe',
          'C:\\Program Files\\cloudflared\\cloudflared.exe',
          path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft\\WinGet\\Links\\cloudflared.exe'),
        ]
      : ['/usr/local/bin/cloudflared', '/opt/homebrew/bin/cloudflared', '/usr/bin/cloudflared'];

  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return 'cloudflared'; // PATH ga umid qilamiz
}

const bin = findCloudflared();

console.log(`\u{1F310} Tunnel ochilmoqda: http://localhost:${port} ...\n`);

const child = spawn(bin, ['tunnel', '--url', `http://localhost:${port}`]);

let found = false;
let errorTail = '';
const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

function handle(chunk) {
  const text = chunk.toString();
  errorTail = (errorTail + text).slice(-1500);
  if (!found) {
    const m = text.match(URL_RE);
    if (m) {
      found = true;
      const url = m[0];
      const ok = writeWebappUrl(url);
      console.log('\n' + '─'.repeat(64));
      console.log(`✅ Mini App manzili tayyor:\n\n   ${url}\n`);
      if (ok) console.log('\u{1F4DD} .env dagi WEBAPP_URL avtomatik yangilandi.');
      console.log('\n\u{1F449} Endi bitta ish qoldi:');
      console.log('   Serverni qayta ishga tushiring (npm run dev oynasida Ctrl+C → npm run dev)');
      console.log('\n\u{1F4A1} Ixtiyoriy: @BotFather → /setmenubutton → botni tanlang →');
      console.log(`   "Web App" → ${url}  (chat ichida doimiy tugma paydo boʻladi)`);
      console.log('\n⚠️  Bu oynani yopmang — tunnel shu jarayon bilan ishlaydi.');
      console.log('─'.repeat(64) + '\n');
    }
  }
  if (process.env.TUNNEL_VERBOSE === '1') process.stdout.write(text);
}

child.stdout.on('data', handle);
child.stderr.on('data', handle);

child.on('error', (err) => {
  if (err.code === 'ENOENT') {
    console.error(
      [
        '❌ cloudflared topilmadi.',
        '',
        'Windows: winget install --id Cloudflare.cloudflared',
        'macOS:   brew install cloudflared',
        'Linux:   https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/',
      ].join('\n'),
    );
  } else {
    console.error('Tunnel xatosi:', err.message);
  }
  process.exit(1);
});

child.on('close', (code) => {
  if (!found) {
    console.error(
      `\n❌ Tunnel ochilmadi (kod: ${code}). cloudflared xabari:\n\n${errorTail.trim() || '(boʻsh)'}\n`,
    );
    process.exit(code ?? 1);
  }
  console.log(`\n\u{1F50C} Tunnel yopildi (kod: ${code ?? 0}).`);
  process.exit(code ?? 0);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => child.kill());
}
