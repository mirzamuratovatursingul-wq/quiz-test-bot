import { InlineKeyboard, Keyboard } from 'grammy';
import { config } from '../config.js';

/** Telegram web_app tugmalari faqat HTTPS bilan ishlaydi (dev rejimida oddiy havola) */
export function isHttps(url: string): boolean {
  return url.startsWith('https://');
}

export function webAppUrl(path = '/'): string {
  const base = config.WEBAPP_URL.replace(/\/$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

/** Mini App ni ochadigan inline tugma (dev da oddiy url tugma) */
export function miniAppButton(keyboard: InlineKeyboard, text: string, path = '/'): InlineKeyboard {
  const url = webAppUrl(path);
  return isHttps(url) ? keyboard.webApp(text, url) : keyboard.url(text, url);
}

/** Shaxsiy chatdagi asosiy menyu */
export function mainMenuKeyboard(): Keyboard {
  const kb = new Keyboard()
    .text('\u{1F4DA} Shablonlarim')
    .text('\u{1F4E4} Test yuklash')
    .row()
    .text('\u{1F4CA} Statistikam')
    .text('ℹ️ Yordam')
    .resized();
  return kb;
}

/** Shaxsiy chat: Mini App ni ochish tugmasi */
export function openAppKeyboard(path = '/'): InlineKeyboard {
  return miniAppButton(new InlineKeyboard(), '\u{1F5A5} Mini App’ni ochish', path);
}

export function draftKeyboard(draftId: string): InlineKeyboard {
  const kb = new InlineKeyboard();
  miniAppButton(kb, '\u{1F50D} Koʻrib chiqish va tasdiqlash', `/draft/${draftId}`);
  kb.row().text('✅ Tezkor saqlash', `draft:save:${draftId}`);
  kb.text('\u{1F5D1} Oʻchirish', `draft:del:${draftId}`);
  return kb;
}

/** Shablonni guruhga yuborish havolasi (Telegram guruh tanlash oynasini ochadi) */
export function startGroupUrl(templateId: string): string | null {
  if (!config.BOT_USERNAME) return null;
  return `https://t.me/${config.BOT_USERNAME}?startgroup=tpl_${templateId}`;
}

export function templateKeyboard(templateId: string): InlineKeyboard {
  const kb = new InlineKeyboard();
  const groupUrl = startGroupUrl(templateId);
  if (groupUrl) kb.url('\u{1F3C1} Guruhga yuborish', groupUrl).row();
  else kb.text('\u{1F3C1} Guruhda musobaqa', `tpl:share:${templateId}`).row();

  kb.text('\u{1F4C4} PDF', `tpl:pdf:${templateId}:plain`)
    .text('\u{1F511} Kalit bilan', `tpl:pdf:${templateId}:key`)
    .row();
  miniAppButton(kb, '✏️ Tahrirlash', `/template/${templateId}`);
  return kb;
}
