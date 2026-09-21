import { createCanvas, loadImage, GlobalFonts, type SKRSContext2D } from '@napi-rs/canvas';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { logger } from '../logger.js';

let fontsReady = false;
let family = 'sans-serif';
let familyBold = 'sans-serif';

function ensureFonts() {
  if (fontsReady) return;
  const regular = path.join(config.fontsDir, 'DejaVuSans.ttf');
  const bold = path.join(config.fontsDir, 'DejaVuSans-Bold.ttf');
  try {
    if (fs.existsSync(regular)) {
      GlobalFonts.registerFromPath(regular, 'TestRace');
      family = 'TestRace';
      familyBold = 'TestRace';
    }
    if (fs.existsSync(bold)) {
      GlobalFonts.registerFromPath(bold, 'TestRaceBold');
      familyBold = 'TestRaceBold';
    }
  } catch (err) {
    logger.warn('Shrift yuklanmadi, tizim shrifti ishlatiladi', err);
  }
  fontsReady = true;
}

function font(size: number, bold = false): string {
  return `${size}px "${bold ? familyBold : family}"`;
}

export interface PodiumEntry {
  place: 1 | 2 | 3;
  name: string;
  username?: string;
  score: number;
  correct: number;
  total: number;
  avatar?: Buffer | null;
}

const W = 1200;
const H = 620;

const ACCENT: Record<number, string> = {
  1: '#F5C451', // oltin
  2: '#C7CDD6', // kumush
  3: '#D08A5A', // bronza
};

const FALLBACK_TINTS = ['#6C5CE7', '#00B894', '#E17055', '#0984E3', '#E84393', '#00A8A8'];

/** Bir xil musobaqa uchun har doim bir xil "konfetti" chiqishi uchun */
function seededRandom(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fitText(ctx: SKRSContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) out = out.slice(0, -1);
  return `${out}…`;
}

/** Yupqa, ozgina burilgan konfetti bo'laklari — yagona "creative" bezak */
function drawConfetti(ctx: SKRSContext2D, seed: number) {
  const rand = seededRandom(seed);
  const colors = [ACCENT[1]!, ACCENT[2]!, ACCENT[3]!, '#7C6CF0', '#4CC38A'];

  for (let i = 0; i < 46; i++) {
    const x = rand() * W;
    const y = rand() * (H * 0.62);
    const w = 3 + rand() * 4;
    const h = 9 + rand() * 14;
    const angle = (rand() - 0.5) * 1.6;
    const color = colors[Math.floor(rand() * colors.length)]!;
    const alpha = 0.10 + rand() * 0.22;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    const r = w / 2;
    ctx.moveTo(-w / 2 + r, -h / 2);
    ctx.lineTo(w / 2 - r, -h / 2);
    ctx.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
    ctx.lineTo(w / 2, h / 2 - r);
    ctx.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
    ctx.lineTo(-w / 2 + r, h / 2);
    ctx.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
    ctx.lineTo(-w / 2, -h / 2 + r);
    ctx.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

async function drawAvatar(
  ctx: SKRSContext2D,
  entry: PodiumEntry,
  cx: number,
  cy: number,
  radius: number,
) {
  const accent = ACCENT[entry.place]!;

  // Halqa
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 9, 0, Math.PI * 2);
  ctx.strokeStyle = accent;
  ctx.lineWidth = entry.place === 1 ? 5 : 3.5;
  ctx.stroke();
  ctx.restore();

  // Rasm
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.clip();

  let drawn = false;
  if (entry.avatar) {
    try {
      const img = await loadImage(entry.avatar);
      ctx.drawImage(img, cx - radius, cy - radius, radius * 2, radius * 2);
      drawn = true;
    } catch (err) {
      logger.debug('Avatar chizilmadi', err);
    }
  }
  if (!drawn) {
    const tint = FALLBACK_TINTS[(entry.name.charCodeAt(0) + entry.place) % FALLBACK_TINTS.length]!;
    ctx.fillStyle = tint;
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = font(Math.round(radius * 0.9), true);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((entry.name.trim()[0] ?? '?').toUpperCase(), cx, cy + 2);
  }
  ctx.restore();

  // O'rin nishoni
  const bx = cx;
  const by = cy + radius + 9;
  ctx.beginPath();
  ctx.arc(bx, by, 22, 0, Math.PI * 2);
  ctx.fillStyle = accent;
  ctx.fill();
  ctx.fillStyle = '#12141A';
  ctx.font = font(22, true);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(entry.place), bx, by + 1);
}

/** G'oliblar uchun sodda, toza rasm */
export async function renderPodium(
  entries: PodiumEntry[],
  meta: { title: string; subtitle?: string },
): Promise<Buffer> {
  ensureFonts();
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Fon
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#111319');
  bg.addColorStop(1, '#0B0C10');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // G'olib ustidagi yumshoq nur
  const glow = ctx.createRadialGradient(W / 2, 300, 0, W / 2, 300, 380);
  glow.addColorStop(0, 'rgba(245,196,81,0.16)');
  glow.addColorStop(1, 'rgba(245,196,81,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  drawConfetti(ctx, meta.title.length * 7919 + entries.reduce((s, e) => s + e.score, 0));

  // Sarlavha
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = font(34, true);
  ctx.fillText(fitText(ctx, meta.title, W - 200), W / 2, 82);

  if (meta.subtitle) {
    ctx.fillStyle = 'rgba(255,255,255,0.40)';
    ctx.font = font(19);
    ctx.fillText(fitText(ctx, meta.subtitle, W - 240), W / 2, 114);
  }

  const byPlace = new Map(entries.map((e) => [e.place, e]));
  const slots: { place: 1 | 2 | 3; cx: number; cy: number; r: number }[] = [
    { place: 2, cx: 268, cy: 330, r: 78 },
    { place: 1, cx: 600, cy: 300, r: 104 },
    { place: 3, cx: 932, cy: 330, r: 78 },
  ];

  for (const slot of slots) {
    const entry = byPlace.get(slot.place);
    if (!entry) continue;
    const accent = ACCENT[slot.place]!;
    const colWidth = slot.place === 1 ? 340 : 280;

    await drawAvatar(ctx, entry, slot.cx, slot.cy, slot.r);

    const baseY = slot.cy + slot.r + 76;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#FFFFFF';
    ctx.font = font(slot.place === 1 ? 30 : 26, true);
    ctx.fillText(fitText(ctx, entry.name, colWidth), slot.cx, baseY);

    ctx.fillStyle = accent;
    ctx.font = font(slot.place === 1 ? 40 : 34, true);
    ctx.fillText(String(entry.score), slot.cx, baseY + (slot.place === 1 ? 50 : 44));

    ctx.fillStyle = 'rgba(255,255,255,0.38)';
    ctx.font = font(17);
    ctx.fillText(
      `${entry.correct}/${entry.total} toʻgʻri`,
      slot.cx,
      baseY + (slot.place === 1 ? 78 : 70),
    );
  }

  return canvas.encode('png');
}
