# TestRace — Telegram test musobaqasi boti

PDF / Word / matndan test savollarini avtomatik ajratib oladi, siz tasdiqlaganingizdan keyin
shablon sifatida profilingizda saqlaydi, PDF qilib beradi va **guruhlarda musobaqa rejimida**
test o‘tkazadi.

Backend va frontend — bitta loyiha (monorepo), bitta joydan boshqariladi.

---

## Qanday ishlaydi

### Mini App — faqat test tayyorlash uchun
1. Botga PDF, `.docx` yoki test matnini yuborasiz (yoki Mini App’dan yuklaysiz).
2. Bot savol, variant va to‘g‘ri javobni ajratib oladi.
3. Mini App’da ko‘rib chiqasiz: javobi topilmagan savollar sariq belgilanadi, bir bosishda
   to‘g‘ri variantni tanlaysiz. Har savolga ixtiyoriy **izoh** yozsangiz, musobaqada xato javob
   berganga o‘sha izoh chiqadi. Savollar 10 tadan yuklanadi (cheksiz skroll).
4. **Tasdiqlash** → shablon profilingizda saqlanadi.
5. PDF: *faqat savollar*, *javoblar kaliti bilan*, *o‘qituvchi nusxasi* — bot orqali keladi.

### Guruhdagi musobaqa — Telegram’ning o‘zida
1. Shablon sahifasida **“Guruhga yuborish”** → guruhni tanlaysiz.
2. Guruhda shablon kartochkasi va bitta **“Boshlash”** tugmasi chiqadi (ro‘yxatdan o‘tish yo‘q).
3. `3️⃣ 2️⃣ 1️⃣` — savollar **Telegram quiz so‘rovnomasi** ko‘rinishida ketma-ket tushadi:
   - sarlavha **[3/20]-savol**, ostida bo‘sh qator va savol matni; variantlar qalin **𝗔) 𝗕) 𝗖)** harflari bilan,
   - jonli **sekund sanoq** (Telegram o‘zi ko‘rsatadi),
   - **progress bar** va kim qaysi variantni tanlagani real vaqtda ko‘rinadi,
   - har kim **bir marta** javob beradi, javobni **o‘zgartirib bo‘lmaydi**,
   - xato javob berganga darhol **eslatma** chiqadi: ✅ **Javob:** C) Oy va (yozilgan bo‘lsa) 💡 izoh,
   - istalgan a’zo istalgan savoldan qo‘shilib ketaveradi.
4. Vaqt tugashi bilan keyingi savol tushadi. Har **5 savolda** oraliq reyting chiqadi.
5. Yakunda: 3 → 2 → 1 tartibida g‘oliblar, profil rasmlari bilan **podium rasmi**, so‘ng
   guruhlarga ajratilgan yakuniy xabar: 🏆 reyting · 📈 umumiy ko‘rsatkichlar · 🔍 e’tiborga loyiq.
   Natijalar shablon egasining profilida saqlanadi.

**Ball:** to‘g‘ri javob = 100 + tezlik bonusi (100 gacha). Sozlamalardan o‘chirsa bo‘ladi.

---

## Texnologiyalar

| Qism | Texnologiya |
|---|---|
| Bot | Node.js 20+, TypeScript, [grammY](https://grammy.dev) (long polling) |
| API | Fastify 5 |
| Baza | MongoDB + Mongoose |
| Mini App | React 18 + Vite + **Tailwind CSS + shadcn/ui** + lucide-react + Manrope shrifti |
| PDF | PDFKit (DejaVu shrifti — kirill va `oʻ`, `gʻ` uchun) |
| Rasm | @napi-rs/canvas (podium) |
| Fayl tahlili | pdf-parse (PDF), mammoth (DOCX) |

```
packages/
  shared/   umumiy tiplar, test tahlilchisi (parser), ball hisoblash
  server/   bot + API + baza + PDF/rasm
  web/      Mini App (yaratuvchi paneli)
```

---

## Ishga tushirish

### 1. Talablar
- Node.js 20+ (24 da sinalgan)
- MongoDB (lokal, Atlas yoki `docker compose up -d mongo`)
- [@BotFather](https://t.me/BotFather) dan bot tokeni

### 2. O‘rnatish
```bash
npm install
npm run fonts          # PDF shriftlari (bir marta)
cp .env.example .env
```

### 3. `.env`
```env
BOT_TOKEN=123456:ABC...
BOT_USERNAME=mening_botim
WEBAPP_URL=https://xxxx.trycloudflare.com
MONGODB_URI=mongodb://127.0.0.1:27017/testrace
PORT=3000
```

> **Mini App HTTPS talab qiladi.**
> ```bash
> npm run tunnel        # cloudflared: HTTPS manzil ochadi va .env ni yangilaydi
> ```
> Tunnel oynasi ochiq tursin. **Manzil o‘zgarsa server buni o‘zi payqaydi** — qayta ishga tushirish shart emas
> (`.env` kuzatilib turadi; `/api/health` javobida `webappUrl` maydonidan tekshirsa bo‘ladi).
> Hot reload bilan ishlash uchun: `npm run tunnel -- 5173`.
> cloudflared yo‘q bo‘lsa: `winget install --id Cloudflare.cloudflared` yoki `brew install cloudflared`.

### 4. Ishlab chiqish
```bash
npm run dev     # server (3000) + Mini App (5173)
```

### 5. BotFather (ixtiyoriy)
- `/setmenubutton` → Web App → `WEBAPP_URL`
- `/setdomain` faqat Login Widget uchun kerak, Mini App tugmalariga shart emas.

---

## Joylashtirish (production)

> ⚠️ **Bot Vercel’da ishlamaydi.** Vercel serversiz (serverless): funksiya so‘rov kelganda
> uyg‘onadi va tugagach o‘chadi. Bizning botga esa doimiy ishlaydigan jarayon kerak:
> Telegram’ni uzluksiz tinglash (long polling), musobaqa holatini xotirada saqlash va har bir
> savol uchun 15–30 soniyalik taymerni ushlab turish. Bular serversiz muhitda uzilib qoladi.
>
> **To‘g‘ri taqsimot:**
> - **Mini App (frontend)** → Vercel ✅ — bu oddiy statik sayt, Vercel unga ideal.
> - **Bot + API** → doimiy ishlaydigan host: **Render**, **Railway**, **Fly.io** yoki oddiy VPS.

### A. Mini App → Vercel

Ikkala sozlash ham ishlaydi — qaysi biri qulay bo‘lsa:

| Root Directory | Qaysi konfiguratsiya ishlaydi | Qo‘shimcha shart |
|---|---|---|
| **bo‘sh (repo ildizi)** — tavsiya | ildizdagi `vercel.json` → `dist/` | yo‘q |
| `packages/web` | `packages/web/vercel.json` → `packages/web/dist/` | Settings’da **“Include source files outside of the Root Directory”** yoqilgan bo‘lsin |

1. Vercel’da yangi loyiha yarating (tavsiya: Root Directory’ni bo‘sh qoldiring).
   Konfiguratsiya fayli build va chiqish papkasini o‘zi sozlaydi — Project Settings’dagi
   **Build Command / Output Directory maydonlarini bo‘sh qoldiring** (qo‘lda yozilgan qiymat
   chalkashlik keltirib chiqaradi).
2. Environment Variables:

   | Kalit | Qiymat |
   |---|---|
   | `VITE_API_URL` | Bot serveringiz manzili, masalan `https://testrace-bot.onrender.com` |

3. Deploy’dan keyin Vercel bergan manzilni (masalan `https://testrace.vercel.app`) eslab qoling —
   u bot serverida `WEBAPP_URL` bo‘lib ketadi.

<details>
<summary><b>Xatolik: “No Output Directory named dist found”</b></summary>

Build natijasi endi <b>har doim</b> repo ildizidagi `dist/` ga ham nusxalanadi
(`scripts/mirror-web-dist.mjs`), shuning uchun Vercel qaysi sozlamani ishlatishidan qat’i nazar
papkani topadi. Agar xato baribir chiqsa:

Vercel `vercel.json` ni **Root Directory ichidan** qidiradi. Agar Root Directory `packages/web`
bo‘lsa, ildizdagi fayl o‘qilmaydi (va aksincha). Tekshiring:

1. Project Settings → **Root Directory**: bo‘sh (repo ildizi) yoki `packages/web`.
2. Settings → Build & Development Settings → **Output Directory** maydoni bo‘sh bo‘lsin
   (qo‘lda yozilgan qiymat `vercel.json` bilan to‘qnashadi).
3. `packages/web` ni tanlagan bo‘lsangiz — **“Include source files outside of the Root Directory”**
   yoqilgan bo‘lsin, chunki umumiy kod `packages/shared` da turadi.
4. Sozlamani o‘zgartirgach **Redeploy** qiling (cache’siz).

</details>

### B. Bot + API → Render (yoki Railway / VPS)

`render.yaml` tayyor turibdi (Blueprint sifatida import qilsangiz bo‘ladi). Qo‘lda sozlaganda:

- **Build:** `npm ci && npm run fonts && npm run build`
- **Start:** `npm start`
- **Health check:** `/api/health`
- **Plan:** bepul reja **yaramaydi** — xizmat uxlab qolsa bot javob bermaydi. Eng arzon
  “doim yoqiq” rejani tanlang.

Environment Variables (namunasi: `.env.production.example`):

| Kalit | Qiymat |
|---|---|
| `NODE_ENV` | `production` |
| `BOT_TOKEN` | BotFather bergan token |
| `BOT_USERNAME` | bot username (@ siz) |
| `MONGODB_URI` | Atlas ulanish satri |
| `WEBAPP_URL` | Vercel bergan manzil |
| `SERVE_WEB` | `false` (Mini App Vercel’da) |
| `PORT` | host beradi, odatda avtomatik |

### C. Yakuniy ulash

1. Atlas → **Network Access** → bot serveringiz IP sini (yoki `0.0.0.0/0`) ruxsat ro‘yxatiga qo‘shing.
2. Bot serveridagi `WEBAPP_URL` = Vercel manzili.
3. Vercel’dagi `VITE_API_URL` = bot serveri manzili → **qayta deploy qiling**
   (bu qiymat build paytida bundle ichiga yoziladi).
4. Tekshirish: `https://<bot-server>/api/health` → `{"ok":true}`.
5. Telegram’da `/start` → “Mini App’ni ochish” tugmasi Vercel manzilini ochishi kerak.

> **Bitta serverda ham bo‘ladi:** agar Vercel’ni ishlatmasangiz, `SERVE_WEB=true` qoldiring —
> server Mini App’ni o‘zi tarqatadi va `WEBAPP_URL` = server domeni bo‘ladi (`npm start` yetarli).
> Docker uchun: `docker compose --profile full up -d`.

### Lokal production sinovi
```bash
npm run build
npm start                                  # bot + API + Mini App bitta jarayonda
npm run check:prod -w @testrace/server     # production yo‘llarini Telegramsiz tekshiradi
```

---

## Test fayl formati

**1. `+` belgisi (asosiy)**
```
1. O‘zbekiston poytaxti?
+A) Toshkent
B) Samarqand
```

**2. Javoblar kaliti (oxirida)**
```
Javoblar kaliti:
1-A, 2-C, 3-B
```

**3. Word’da qalin (bold) javob** — `.docx` da `+` bo‘lmasa, qalin variant to‘g‘ri deb olinadi.

Qo‘llab-quvvatlanadi: `1.` `1)` `1]` raqamlash; `A)` `A.` `A:` `A -` variantlar; lotin va kirill;
`====` ajratgichlar; sahifa raqamlari va sarlavhalar avtomatik tashlab ketiladi.

> Skaner qilingan (rasm) PDF ishlamaydi — ichida matn bo‘lishi kerak.
> Uzun savol/variantlar so‘rovnomaga sig‘masa, to‘liq matni alohida xabarda chiqadi.

---

## Buyruqlar

**Shaxsiy:** `/start` `/shablonlarim` `/statistika` `/yordam`
**Guruh:** `/boshlash` `/toxtat` `/holat`

---

## Sinovlar

Tashqi xizmat kerak emas — MongoDB xotirada, Telegram API soxta (mock):

```bash
npm test                                  # API (33) + musobaqa (40) sinovlari
DUMP=1 npm run smoke:race -w @testrace/server   # soʻrovnoma va yakuniy xabar koʻrinishini chop etadi
npm run check:parser -w @testrace/server  # tahlilchini namuna faylda tekshirish
npm run check:output -w @testrace/server  # PDF va podium rasmini ./out ga chiqarish
npm run preview:ui -w @testrace/server    # Mini App UI sini Telegramsiz ko‘rish (localhost:3100)
npm run check:prod -w @testrace/server    # production sozlamalari va indekslarini tekshirish
npm run db:clean -w @testrace/server      # bazani tozalash (-- --yes bilan rostdan o‘chiradi)
```

---

## API (Mini App uchun)

Barcha `/api/*` yo‘llari Telegram `initData` imzosi bilan himoyalangan (HMAC-SHA256, 24 soat).

| Metod | Yo‘l | Vazifasi |
|---|---|---|
| POST | `/api/parse` · `/api/upload` | Matn / fayldan qoralama yaratish |
| GET/PATCH/DELETE | `/api/drafts/:id` | Qoralama |
| POST | `/api/drafts/:id/confirm` | Tasdiqlash → shablon |
| GET/PATCH/DELETE | `/api/templates/:id` | Shablon |
| GET | `/api/templates/:id/pdf?mode=plain\|key\|teacher` | PDF |
| POST | `/api/templates/:id/send-pdf` | PDF ni bot orqali yuborish |
| GET | `/api/races` · `/api/races/:id` | Musobaqa natijalari |
| GET | `/api/races/:id/podium.png` | G‘oliblar rasmi |
| GET | `/api/me` · `/api/stats` | Profil va statistika |

---

## Eslatmalar

- Musobaqa holati xotirada, har savoldan keyin bazaga yoziladi. Bot qayta ishga tushsa,
  tugallanmagan musobaqalar avtomatik yopiladi.
- Bir guruhda bir vaqtda bitta musobaqa.
- Quiz so‘rovnomasi cheklovi: savol ≤ 300, variant ≤ 100 belgi (uzunlari qisqartiriladi va
  to‘liq matn alohida xabarda chiqadi), 12 tagacha variant.
- `poll_answer` yangilanishi kerak bo‘lgani uchun so‘rovnomalar **anonim emas**.
- Telegram fayl chegarasi — 20 MB.
