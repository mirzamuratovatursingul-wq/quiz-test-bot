import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { DEFAULT_TEMPLATE_SETTINGS } from '@testrace/shared';

/* ------------------------------------------------------------------ */
/* User                                                                */
/* ------------------------------------------------------------------ */

const userSchema = new Schema(
  {
    telegramId: { type: Number, required: true, unique: true, index: true },
    firstName: { type: String, default: '' },
    lastName: { type: String, default: '' },
    username: { type: String, default: '' },
    photoUrl: { type: String, default: '' },
    languageCode: { type: String, default: 'uz' },
    isBlocked: { type: Boolean, default: false },
    stats: {
      templatesCount: { type: Number, default: 0 },
      racesHosted: { type: Number, default: 0 },
      racesPlayed: { type: Number, default: 0 },
      wins: { type: Number, default: 0 },
      totalScore: { type: Number, default: 0 },
      totalCorrect: { type: Number, default: 0 },
      totalAnswers: { type: Number, default: 0 },
    },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

export type UserDoc = HydratedDocument<InferSchemaType<typeof userSchema>>;
export const User = model('User', userSchema);

/* ------------------------------------------------------------------ */
/* Question (embedded)                                                 */
/* ------------------------------------------------------------------ */

const optionSchema = new Schema({ text: { type: String, required: true } }, { _id: false });

const questionSchema = new Schema(
  {
    text: { type: String, required: true },
    options: { type: [optionSchema], default: [] },
    correctIndex: { type: Number, default: -1 },
    explanation: { type: String },
  },
  { _id: false },
);

/* ------------------------------------------------------------------ */
/* Template                                                            */
/* ------------------------------------------------------------------ */

const templateSchema = new Schema(
  {
    ownerId: { type: Number, required: true, index: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    subject: { type: String, default: '' },
    status: { type: String, enum: ['draft', 'ready'], default: 'ready' },
    questions: { type: [questionSchema], default: [] },
    settings: {
      timePerQuestion: { type: Number, default: DEFAULT_TEMPLATE_SETTINGS.timePerQuestion },
      shuffleQuestions: { type: Boolean, default: DEFAULT_TEMPLATE_SETTINGS.shuffleQuestions },
      shuffleOptions: { type: Boolean, default: DEFAULT_TEMPLATE_SETTINGS.shuffleOptions },
      questionLimit: { type: Number, default: DEFAULT_TEMPLATE_SETTINGS.questionLimit },
      speedBonus: { type: Boolean, default: DEFAULT_TEMPLATE_SETTINGS.speedBonus },
    },
    sourceType: { type: String, enum: ['pdf', 'docx', 'text', 'manual'], default: 'manual' },
    sourceFileName: { type: String, default: '' },
    racesCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

templateSchema.index({ ownerId: 1, createdAt: -1 });

export type TemplateDoc = HydratedDocument<InferSchemaType<typeof templateSchema>>;
export const Template = model('Template', templateSchema);

/* ------------------------------------------------------------------ */
/* Draft (tasdiqlashni kutayotgan tahlil natijasi)                     */
/* ------------------------------------------------------------------ */

const warningSchema = new Schema(
  {
    questionNumber: { type: Number },
    code: { type: String, required: true },
    message: { type: String, required: true },
  },
  { _id: false },
);

const draftSchema = new Schema(
  {
    ownerId: { type: Number, required: true, index: true },
    title: { type: String, default: 'Nomsiz test' },
    questions: { type: [questionSchema], default: [] },
    warnings: { type: [warningSchema], default: [] },
    strategy: { type: String, default: 'none' },
    sourceType: { type: String, enum: ['pdf', 'docx', 'text'], required: true },
    sourceFileName: { type: String, default: '' },
    rawText: { type: String, default: '' },
    /** Bot ichidagi ko'rib chiqish kursori */
    reviewIndex: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: { createdAt: 'createdAt', updatedAt: true } },
);

// Tasdiqlanmagan qoralamalar 7 kundan keyin o'chadi
draftSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 3600 });

export type DraftDoc = HydratedDocument<InferSchemaType<typeof draftSchema>>;
export const Draft = model('Draft', draftSchema);

/* ------------------------------------------------------------------ */
/* Race                                                                */
/* ------------------------------------------------------------------ */

const participantSchema = new Schema(
  {
    userId: { type: Number, required: true },
    firstName: { type: String, default: '' },
    username: { type: String, default: '' },
    photoFileId: { type: String, default: '' },
    score: { type: Number, default: 0 },
    correct: { type: Number, default: 0 },
    wrong: { type: Number, default: 0 },
    missed: { type: Number, default: 0 },
    totalTimeMs: { type: Number, default: 0 },
    answered: { type: Number, default: 0 },
    place: { type: Number, default: 0 },
  },
  { _id: false },
);

const raceQuestionSchema = new Schema(
  {
    text: { type: String, required: true },
    options: { type: [optionSchema], default: [] },
    correctIndex: { type: Number, required: true },
    answeredCount: { type: Number, default: 0 },
    correctCount: { type: Number, default: 0 },
    optionCounts: { type: [Number], default: [] },
  },
  { _id: false },
);

const raceSchema = new Schema(
  {
    templateId: { type: Schema.Types.ObjectId, ref: 'Template', required: true, index: true },
    templateTitle: { type: String, default: '' },
    ownerId: { type: Number, required: true, index: true },
    hostId: { type: Number, required: true },
    chatId: { type: Number, required: true, index: true },
    chatTitle: { type: String, default: '' },
    status: {
      type: String,
      enum: ['waiting', 'running', 'finished', 'cancelled'],
      default: 'waiting',
    },
    questions: { type: [raceQuestionSchema], default: [] },
    participants: { type: [participantSchema], default: [] },
    currentIndex: { type: Number, default: 0 },
    timePerQuestion: { type: Number, default: 15 },
    speedBonus: { type: Boolean, default: true },
    startedAt: { type: Date },
    finishedAt: { type: Date },
  },
  { timestamps: true },
);

raceSchema.index({ chatId: 1, status: 1 });
raceSchema.index({ ownerId: 1, createdAt: -1 });

export type RaceDoc = HydratedDocument<InferSchemaType<typeof raceSchema>>;
export const Race = model('Race', raceSchema);

/* ------------------------------------------------------------------ */
/* Group (bot a'zo bo'lgan guruhlar)                                   */
/* ------------------------------------------------------------------ */

const groupSchema = new Schema(
  {
    chatId: { type: Number, required: true, unique: true },
    title: { type: String, default: '' },
    type: { type: String, default: 'group' },
    addedBy: { type: Number },
    membersSeen: { type: Number, default: 0 },
    racesCount: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export type GroupDoc = HydratedDocument<InferSchemaType<typeof groupSchema>>;
export const Group = model('Group', groupSchema);
