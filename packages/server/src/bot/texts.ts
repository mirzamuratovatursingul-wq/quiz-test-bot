/** Botning matnlari (o'zbek tili). Qisqa va kerakligicha. */

export const t = {
  start: (name: string, hasPanelButton: boolean) =>
    [
      `\u{1F44B} Salom, <b>${name}</b>!`,
      ``,
      `Men testlarni guruhda <b>musobaqaga</b> aylantiraman:`,
      ``,
      `<b>1.</b> \u{1F4E4} Menga test yuboring — PDF, Word yoki matn`,
      `<b>2.</b> \u{1F50D} Savollarni ajrataman, siz tekshirib tasdiqlaysiz`,
      `<b>3.</b> \u{1F3C1} Shablonni guruhga yuborasiz — musobaqa boshlanadi`,
      ``,
      hasPanelButton
        ? `\u{1F5A5} Shablonlar, tahrirlash va PDF — pastdagi <b>Panel</b> tugmasida.`
        : `\u{1F447} Hoziroq test faylini yoki matnini yuborishingiz mumkin.`,
    ].join('\n'),

  uploadHint: [
    `\u{1F4E4} <b>Test yuklash</b>`,
    ``,
    `PDF, Word (.docx) fayl yuboring yoki test matnini shu yerga yozing.`,
    ``,
    `Toʻgʻri javob oldiga <b>+</b> qoʻying:`,
    `<code>1. 2+2=?`,
    `A) 3`,
    `+B) 4`,
    `C) 5</code>`,
    ``,
    `\u{1F4A1} Yoki oxirida kalit bering: <code>1-B, 2-A, 3-C</code>`,
  ].join('\n'),

  help: [
    `ℹ️ <b>Qoʻllanma</b>`,
    ``,
    `<b>\u{1F4DD} Test formati</b>`,
    `<code>1. Savol?`,
    `+A) Toʻgʻri javob`,
    `B) Boshqa variant</code>`,
    `• Yoki oxirida kalit: <code>1-A, 2-C</code>`,
    `• Word faylda qalin (bold) variant ham toʻgʻri deb olinadi`,
    `• Skaner qilingan (rasm) PDF ishlamaydi`,
    ``,
    `<b>\u{1F3C1} Guruhda musobaqa</b>`,
    `1) Shablonni ochib <b>Guruhda musobaqa oʻtkazish</b>ni bosing`,
    `2) Guruhni tanlang — u yerda <b>Boshlash</b> tugmasi chiqadi`,
    `3) Savollar soʻrovnoma boʻlib tushadi, yakunda gʻoliblar eʼlon qilinadi`,
    `\u{1F512} Guruhda musobaqani faqat <b>guruh adminlari</b> boshlaydi va toʻxtatadi.`,
    ``,
    `<b>⌨️ Buyruqlar</b>`,
    `/shablonlarim — saqlangan testlar`,
    `/statistika — natijalaringiz`,
    `Guruhda (adminlar uchun): /boshlash · /toxtat · /holat`,
  ].join('\n'),

  fileTooBig: (mb: number) => `⚠️ Fayl juda katta. Chegara — <b>${mb} MB</b>.`,

  analyzing: '⏳ Fayl oʻqilmoqda va savollar ajratilmoqda…',

  noTemplates: [
    `\u{1F4DA} <b>Hali shablon yoʻq</b>`,
    ``,
    `Menga PDF, Word fayl yoki test matnini yuboring — savollarni ajratib, shablon qilib beraman.`,
  ].join('\n'),

  /** Guruhda admin bo'lmagan a'zo musobaqani boshqarmoqchi bo'lganda */
  adminOnly:
    '\u{1F512} Botni guruhda ishga tushirmoqchi boʻlsangiz, sizga admin huquqi berilishi kerak. Savollarga esa hamma javob bera oladi.',

  groupOnly: 'Bu buyruq guruhlarda ishlaydi.',
  privateOnly: 'Bu buyruq shaxsiy chatda ishlaydi.',

  needTemplatesForRace: (botUsername?: string) =>
    [
      `\u{1F4DA} Sizda hali tayyor shablon yoʻq.`,
      botUsername
        ? `Avval @${botUsername} ga shaxsiy chatda test yuboring — keyin shu yerda /boshlash.`
        : 'Avval botga shaxsiy chatda test yuboring — keyin shu yerda /boshlash.',
    ].join('\n'),
};
