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

/** Pastki menyu tugmalari matni — handlerlar ham shu qiymatlar bilan solishtiradi */
export const MENU = {
  templates: '\u{1F4DA} Shablonlarim',
  upload: '\u{1F4E4} Test yuklash',
  stats: '\u{1F4CA} Statistikam',
  help: 'ℹ️ Yordam',
} as const;

/** Shaxsiy chatdagi asosiy menyu */
export function mainMenuKeyboard(): Keyboard {
  return new Keyboard()
    .text(MENU.templates)
    .text(MENU.upload)
    .row()
    .text(MENU.stats)
    .text(MENU.help)
    .resized()
    .persistent()
    .placeholder('Test matni yoki PDF/Word fayl yuboring…');
}

/** Shaxsiy chat: Mini App ni ochish tugmasi */
export function openAppKeyboard(path = '/', text = '\u{1F5A5} Panelni ochish'): InlineKeyboard {
  return miniAppButton(new InlineKeyboard(), text, path);
}

/** Tahlil natijasi ostidagi tugmalar */
export function draftKeyboard(draftId: string, ready: number, total: number): InlineKeyboard {
  const kb = new InlineKeyboard();
  miniAppButton(kb, '\u{1F50D} Koʻrib chiqish va tasdiqlash', `/draft/${draftId}`).row();
  if (ready > 0) {
    kb.text(
      ready === total ? '✅ Darhol saqlash' : `✅ Tayyorlarini saqlash (${ready}/${total})`,
      `draft:save:${draftId}`,
    );
  }
  kb.text('\u{1F5D1} Oʻchirish', `draft:del:${draftId}`);
  return kb;
}

/** Qoralamani o'chirishdan oldin tasdiqlash */
export function draftDeleteConfirmKeyboard(draftId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('\u{1F5D1} Ha, oʻchirilsin', `draft:delok:${draftId}`)
    .text('↩️ Yoʻq, qoldirish', `draft:keep:${draftId}`);
}

/** Shablonni guruhga yuborish havolasi (Telegram guruh tanlash oynasini ochadi) */
export function startGroupUrl(templateId: string): string | null {
  if (!config.BOT_USERNAME) return null;
  return `https://t.me/${config.BOT_USERNAME}?startgroup=tpl_${templateId}`;
}

/**
 * Shablon kartochkasi tugmalari.
 * `backPage` berilsa — ro'yxatga qaytish tugmasi qo'shiladi (xabar joyida tahrirlanadi).
 */
export function templateKeyboard(templateId: string, backPage?: number): InlineKeyboard {
  const kb = new InlineKeyboard();
  const groupUrl = startGroupUrl(templateId);
  if (groupUrl) kb.url('\u{1F3C1} Guruhda musobaqa oʻtkazish', groupUrl).row();
  else kb.text('\u{1F3C1} Guruhda musobaqa oʻtkazish', `tpl:share:${templateId}`).row();

  kb.text('\u{1F4C4} Savollar', `tpl:pdf:${templateId}:plain`)
    .text('\u{1F511} Kalit', `tpl:pdf:${templateId}:key`)
    .text('\u{1F469}‍\u{1F3EB} Oʻqituvchi', `tpl:pdf:${templateId}:teacher`)
    .row();
  miniAppButton(kb, '✏️ Panelda tahrirlash', `/template/${templateId}`);
  if (backPage !== undefined) kb.row().text('⬅️ Roʻyxatga qaytish', `tpl:list:${backPage}`);
  return kb;
}

/** Shablonlar ro'yxati: sahifalab, har sahifada `perPage` ta */
export function templatesListKeyboard(
  items: { id: string; title: string; questions: number }[],
  page: number,
  pages: number,
  offset: number,
): InlineKeyboard {
  const kb = new InlineKeyboard();
  items.forEach((tpl, i) => {
    const title = tpl.title.length > 30 ? `${tpl.title.slice(0, 29)}…` : tpl.title;
    kb.text(`${offset + i + 1}. ${title} · ${tpl.questions} savol`, `tpl:open:${tpl.id}:${page}`).row();
  });
  if (pages > 1) {
    kb.text(page > 0 ? '⬅️' : '·', page > 0 ? `tpl:list:${page - 1}` : 'noop')
      .text(`${page + 1} / ${pages}`, 'noop')
      .text(page < pages - 1 ? '➡️' : '·', page < pages - 1 ? `tpl:list:${page + 1}` : 'noop')
      .row();
  }
  miniAppButton(kb, '\u{1F5A5} Panelda ochish', '/');
  return kb;
}

/** Guruhdagi musobaqa kartochkasi */
export function raceIntroKeyboard(raceId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('▶️ Boshlash', `race:start:${raceId}`)
    .text('✕ Bekor qilish', `race:cancel:${raceId}`);
}
