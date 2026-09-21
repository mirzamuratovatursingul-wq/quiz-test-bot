/**
 * Bazani tozalash (sinov ma'lumotlarini o'chirish).
 *
 *   npm run db:clean -w @testrace/server            # faqat ko'rsatadi
 *   npm run db:clean -w @testrace/server -- --yes   # rostdan o'chiradi
 *
 * Kolleksiyalar o'chirilmaydi, faqat ichidagi hujjatlar tozalanadi —
 * indekslar joyida qoladi.
 */
import mongoose, { type Model } from 'mongoose';
import { config } from '../config.js';
import { Draft, Group, Race, Template, User } from '../db/models.js';

const apply = process.argv.includes('--yes');

const models: { name: string; model: Model<any> }[] = [
  { name: 'Foydalanuvchilar', model: User },
  { name: 'Shablonlar', model: Template },
  { name: 'Qoralamalar', model: Draft },
  { name: 'Musobaqalar', model: Race },
  { name: 'Guruhlar', model: Group },
];

await mongoose.connect(config.MONGODB_URI, { serverSelectionTimeoutMS: 15_000 });
console.log(`Baza: ${mongoose.connection.name}\n`);

let total = 0;
for (const { name, model } of models) {
  const count = await model.countDocuments();
  total += count;
  console.log(`  ${name.padEnd(18)} ${count}`);
}

if (total === 0) {
  console.log('\nBaza allaqachon boʻsh.');
} else if (!apply) {
  console.log(`\nJami ${total} ta yozuv. Oʻchirish uchun: npm run db:clean -w @testrace/server -- --yes`);
} else {
  console.log('\nTozalanmoqda...');
  for (const { name, model } of models) {
    const res = await model.deleteMany({});
    console.log(`  ${name.padEnd(18)} ${res.deletedCount} ta oʻchirildi`);
  }

  console.log('\nTekshiruv:');
  for (const { name, model } of models) {
    console.log(`  ${name.padEnd(18)} ${await model.countDocuments()}`);
  }
  console.log('\n✅ Baza tozalandi.');
}

await mongoose.disconnect();
