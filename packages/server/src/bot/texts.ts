/** Botning matnlari (o'zbek tili). Qisqa va kerakligicha. */

export const t = {
  start: (name: string) =>
    [
      `Salom, <b>${name}</b>!`,
      ``,
      `Menga test yuboring — PDF, Word yoki matn.`,
      `Savollarni ajratib beraman, siz tasdiqlaysiz.`,
      `Soʻng shablonni guruhga yuborib, musobaqa oʻtkazasiz.`,
    ].join('\n'),

  help: [
    `<b>Test formati</b>`,
    `<code>1. Savol?`,
    `+A) Toʻgʻri javob`,
    `B) Boshqa</code>`,
    ``,
    `Yoki oxirida kalit: <code>1-A, 2-C</code>`,
    ``,
    `<b>Buyruqlar</b>`,
    `/shablonlarim · /statistika`,
    `Guruhda: /boshlash · /toxtat · /holat`,
  ].join('\n'),

  fileTooBig: (mb: number) => `Fayl katta. Chegara: ${mb} MB.`,

  analyzing: 'Tahlil qilinmoqda…',

  noTemplates: 'Shablon yoʻq. Menga PDF, Word yoki test matnini yuboring.',

  groupOnly: 'Bu buyruq guruhlarda ishlaydi.',
  privateOnly: 'Bu buyruq shaxsiy chatda ishlaydi.',

  needTemplatesForRace: (botUsername?: string) =>
    botUsername
      ? `Tayyor shablon yoʻq. @${botUsername} ga test yuboring.`
      : 'Tayyor shablon yoʻq. Botga test yuboring.',
};
