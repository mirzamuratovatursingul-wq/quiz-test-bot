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
  strategy: 'plus' | 'answer_key' | 'first_is_correct' | 'mixed' | 'none';
  stats: {
    total: number;
    withCorrect: number;
    needsReview: number;
  };
}

export type TemplateStatus = 'draft' | 'ready';

export interface TemplateSettings {
  /** Har bir savolga beriladigan vaqt (sekund) */
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
  createdAt: string;
  updatedAt: string;
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
