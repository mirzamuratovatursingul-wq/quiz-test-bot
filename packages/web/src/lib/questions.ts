import type { Question } from '@testrace/shared';

/** Serverdagi cheklov bilan bir xil (8 tagacha variant) */
export const MAX_OPTIONS = 8;

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
