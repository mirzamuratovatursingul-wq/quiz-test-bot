/** Umumiy tiplar: server ham, Mini App ham shu tiplardan foydalanadi. */

export type OptionLabel = string; // "A", "B", "C" ...

export interface QuestionOption {
  /** Variant matni (belgilarsiz, toza) */
  text: string;
}

export interface Question {
  /** Savol matni */
  text: string;
  options: QuestionOption[];
  /** To'g'ri variant indeksi. -1 => hali aniqlanmagan (user tasdiqlashi kerak) */
  correctIndex: number;
  /** Ixtiyoriy izoh / to'g'ri javob tushuntirishi */
  explanation?: string;
}

export interface ParseWarning {
  /** 1 dan boshlanadigan savol raqami (agar savolga tegishli bo'lsa) */
  questionNumber?: number;
  code:
    | 'no_correct_answer'
    | 'too_few_options'
    | 'too_many_options'
    | 'empty_question'
    | 'duplicate_question'
    | 'multiple_correct'
    | 'no_questions';
  message: string;
}

export interface ParseResult {
  questions: Question[];
  warnings: ParseWarning[];
  /** Qaysi strategiya ishladi */
  strategy: 'plus' | 'answer_key' | 'first_is_correct' | 'mixed' | 'ai' | 'none';
  stats: {
    total: number;
    withCorrect: number;
    needsReview: number;
  };
}

export type TemplateStatus = 'draft' | 'ready';

export interface TemplateSettings {
  /**
   * Har bir savolga beriladigan vaqt (sekund, 5–120).
   * 0 — vaqtsiz: savollar guruhga oddiy so'rovnoma bo'lib birdaniga yuboriladi,
   * natijani admin "Yakunlash" tugmasi bilan e'lon qiladi.
   */
  timePerQuestion: number;
  /** Savollarni aralashtirish */
  shuffleQuestions: boolean;
  /** Variantlarni aralashtirish */
  shuffleOptions: boolean;
  /** Musobaqada nechta savol ishlatilsin (0 => hammasi) */
  questionLimit: number;
  /** Tezlik bonusi yoqilganmi */
  speedBonus: boolean;
}

export const DEFAULT_TEMPLATE_SETTINGS: TemplateSettings = {
  timePerQuestion: 15,
  shuffleQuestions: true,
  shuffleOptions: true,
  questionLimit: 0,
  speedBonus: true,
};

/** Savolga vaqt chegarasi: 0 = vaqtsiz rejim */
export const UNTIMED = 0;
export const MIN_TIME_PER_QUESTION = 5;
export const MAX_TIME_PER_QUESTION = 120;

export function isUntimed(timePerQuestion: number | undefined | null): boolean {
  return timePerQuestion === UNTIMED;
}

/** "15 s" yoki "vaqtsiz" */
export function formatTimeLimit(timePerQuestion: number | undefined | null): string {
  return isUntimed(timePerQuestion) ? 'vaqtsiz' : `${timePerQuestion ?? DEFAULT_TEMPLATE_SETTINGS.timePerQuestion} s`;
}

export interface TemplateDTO {
  id: string;
  ownerId: number;
  title: string;
  description?: string;
  subject?: string;
  status: TemplateStatus;
  questions: Question[];
  settings: TemplateSettings;
  sourceType: 'pdf' | 'docx' | 'text' | 'manual';
  sourceFileName?: string;
  racesCount: number;
  /** Ulashish kodi (egasi yaratgan bo'lsa) — boshqalar shu kod bilan nusxa oladi */
  shareCode?: string | null;
  /** Kod orqali olingan nusxa bo'lsa — kimdan olingani (asl shablonga bog'liq emas) */
  copiedFrom?: { ownerName: string; code: string; at: string } | null;
  createdAt: string;
  updatedAt: string;
}

/** Ulashish kodi bo'yicha ko'rinish (nusxa olishdan oldin) */
export interface SharedTemplatePreviewDTO {
  code: string;
  title: string;
  questions: number;
  ownerName: string;
  timePerQuestion: number;
  /** So'rovchining o'zi egasi */
  isOwn: boolean;
  /** So'rovchida bu shablonning nusxasi allaqachon bor */
  alreadyCopiedId: string | null;
}

/** Ulashish kodi: chalkash belgilarsiz (0/O, 1/I/L yo'q) */
export const SHARE_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const SHARE_CODE_LENGTH = 6;

/** Foydalanuvchi yozgan kodni tozalash: "k7m-2qx" -> "K7M2QX". Noto'g'ri bo'lsa null */
export function normalizeShareCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s_-]+/g, '');
  if (code.length !== SHARE_CODE_LENGTH) return null;
  return [...code].every((ch) => SHARE_CODE_ALPHABET.includes(ch)) ? code : null;
}

export interface DraftDTO {
  id: string;
  ownerId: number;
  title: string;
  questions: Question[];
  warnings: ParseWarning[];
  strategy: ParseResult['strategy'];
  sourceType: 'pdf' | 'docx' | 'text';
  sourceFileName?: string;
  createdAt: string;
}

export type RaceStatus = 'waiting' | 'running' | 'finished' | 'cancelled';

export interface RaceParticipantDTO {
  userId: number;
  firstName: string;
  username?: string;
  score: number;
  correct: number;
  wrong: number;
  missed: number;
  /** o'rtacha javob vaqti, ms */
  avgTimeMs: number;
  place?: number;
}

export interface RaceQuestionStatDTO {
  index: number;
  text: string;
  correctIndex: number;
  answeredCount: number;
  correctCount: number;
  optionCounts: number[];
}

export interface RaceDTO {
  id: string;
  templateId: string;
  templateTitle: string;
  ownerId: number;
  chatId: number;
  chatTitle: string;
  status: RaceStatus;
  startedAt?: string;
  finishedAt?: string;
  totalQuestions: number;
  participants: RaceParticipantDTO[];
  questionStats: RaceQuestionStatDTO[];
}

export interface UserProfileDTO {
  telegramId: number;
  firstName: string;
  lastName?: string;
  username?: string;
  photoUrl?: string;
  templatesCount: number;
  racesCount: number;
  createdAt: string;
}

export interface ApiError {
  error: string;
  message: string;
}
