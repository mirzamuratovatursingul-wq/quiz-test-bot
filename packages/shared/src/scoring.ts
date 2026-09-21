/** Musobaqa ball hisoblash qoidalari (Kahoot uslubi: to'g'rilik + tezlik). */

export const BASE_POINTS = 100;
export const MAX_SPEED_BONUS = 100;

export interface ScoreInput {
  correct: boolean;
  /** Javob berilgan vaqt (savol chiqqandan beri), ms */
  elapsedMs: number;
  /** Savolga berilgan umumiy vaqt, ms */
  limitMs: number;
  speedBonus: boolean;
}

/** Bitta javob uchun ball */
export function computeScore({ correct, elapsedMs, limitMs, speedBonus }: ScoreInput): number {
  if (!correct) return 0;
  if (!speedBonus) return BASE_POINTS;
  const left = Math.max(0, Math.min(limitMs, limitMs - elapsedMs));
  const ratio = limitMs > 0 ? left / limitMs : 0;
  return BASE_POINTS + Math.round(MAX_SPEED_BONUS * ratio);
}

/** Massivni tasodifiy aralashtirish (Fisher-Yates) */
export function shuffle<T>(items: readonly T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = arr[i] as T;
    const b = arr[j] as T;
    arr[i] = b;
    arr[j] = a;
  }
  return arr;
}

/** Ballga qarab o'rinlarni belgilash (teng ballar bir xil o'rin oladi) */
export function assignPlaces<T extends { score: number; avgTimeMs: number }>(
  participants: T[],
): (T & { place: number })[] {
  const sorted = [...participants].sort(
    (a, b) => b.score - a.score || a.avgTimeMs - b.avgTimeMs,
  );
  let place = 0;
  let prevScore: number | null = null;
  return sorted.map((p, i) => {
    if (prevScore === null || p.score !== prevScore) place = i + 1;
    prevScore = p.score;
    return { ...p, place };
  });
}

export function medal(place: number): string {
  if (place === 1) return '\u{1F947}';
  if (place === 2) return '\u{1F948}';
  if (place === 3) return '\u{1F949}';
  return `${place}.`;
}
