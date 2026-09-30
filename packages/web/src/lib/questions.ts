import type { Question } from '@testrace/shared';

/** Serverdagi cheklov bilan bir xil (8 tagacha variant) */
export const MAX_OPTIONS = 8;

/** Yangi savol: 4 ta bo'sh variant bilan */
export function emptyQuestion(): Question {
  return { text: '', options: [{ text: '' }, { text: '' }, { text: '' }, { text: '' }], correctIndex: -1 };
}

/**
 * Ro'yxatdagi savollar uchun barqaror React kalitlari. Indeks kalit bo'lsa, savol
 * o'chirilganda tahrirlash holati qo'shni savolga o'tib ketadi.
 */
let keySeq = 0;
export const newQuestionKey = () => ++keySeq;

/** Yangi savolni tugatishga nima yetishmayapti (null — tayyor) */
export function newQuestionProblem(q: Question): string | null {
  if (!q.text) return 'Savol matnini yozing';
  if (q.options.length < 2) return 'Kamida 2 ta variant yozing';
  if (q.correctIndex < 0) return 'To‘g‘ri javobni belgilang — variant harfini bosing';
  return null;
}

/** Savol musobaqaga tayyormi: to'g'ri javob belgilangan va kamida 2 variant bor */
export function isQuestionReady(q: Question): boolean {
  return q.options.length >= 2 && q.correctIndex >= 0 && q.correctIndex < q.options.length;
}

/**
 * Bo'sh variantlarni olib tashlaydi va to'g'ri javob indeksini moslaydi.
 * Server bo'sh matnni qabul qilmaydi — saqlashdan oldin chaqiriladi.
 */
export function cleanQuestion(q: Question): Question {
  const options: Question['options'] = [];
  let correctIndex = -1;
  q.options.forEach((o, i) => {
    const text = o.text.trim();
    if (!text) return;
    if (i === q.correctIndex) correctIndex = options.length;
    options.push({ text });
  });
  return {
    ...q,
    text: q.text.trim(),
    options,
    correctIndex,
    explanation: q.explanation?.trim() || undefined,
  };
}
