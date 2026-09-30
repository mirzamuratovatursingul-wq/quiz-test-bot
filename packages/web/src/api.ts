import type {
  AdminGroupDetailDTO,
  AdminGroupRowDTO,
  AdminOverviewDTO,
  AdminPage,
  AdminUserDetailDTO,
  AdminUserRowDTO,
  DraftDTO,
  DraftSummaryDTO,
  Question,
  RaceDTO,
  SharedTemplatePreviewDTO,
  TemplateDTO,
  TemplateSummaryDTO,
  UserProfileDTO,
} from '@testrace/shared';
import { initData } from '@/telegram';

const BASE = import.meta.env.VITE_API_URL ?? '';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('X-Init-Data', initData());
  if (options.body && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(`${BASE}${path}`, { ...options, headers });

  if (!res.ok) {
    let message = `Xatolik (${res.status})`;
    let code: string | undefined;
    try {
      const data = (await res.json()) as { message?: string; error?: string };
      message = data.message ?? message;
      code = data.error;
    } catch {
      /* javob JSON emas */
    }
    throw new ApiError(message, res.status, code);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface UserStats {
  templatesCount: number;
  racesHosted: number;
  racesPlayed: number;
  wins: number;
  totalScore: number;
  totalCorrect: number;
  totalAnswers: number;
}

export interface StatsOverview {
  topTemplates: { id: string; title: string; questions: number; racesCount: number }[];
  recentRaces: {
    id: string;
    templateTitle: string;
    chatTitle: string;
    finishedAt?: string;
    participants: number;
    winner: string | null;
  }[];
  totals: { races: number; participants: number; answers: number; correctRate: number };
}

export interface AppConfig {
  botUsername: string | null;
  /** .env dagi ADMIN_IDS ro'yxatidami */
  isAdmin: boolean;
}

/** Sessiya davomida o'zgarmaydi — bir marta so'raladi */
let configPromise: Promise<AppConfig> | null = null;

const qs = (params: Record<string, string | number | undefined>) =>
  new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => [k, String(v)]),
  ).toString();

export const api = {
  /* Profil */
  me: () =>
    request<{ profile: UserProfileDTO; stats: UserStats | null; botUsername: string | null }>(
      '/api/me',
    ),
  stats: () => request<StatsOverview>('/api/stats'),
  config: () => {
    configPromise ??= request<AppConfig>('/api/config').catch((err) => {
      configPromise = null; // xato bo'lsa keyingi safar qayta so'raladi
      throw err;
    });
    return configPromise;
  },

  /* Shablonlar */
  templates: () => request<{ templates: TemplateSummaryDTO[] }>('/api/templates'),
  template: (id: string) => request<{ template: TemplateDTO }>(`/api/templates/${id}`),
  updateTemplate: (id: string, patch: Partial<TemplateDTO>) =>
    request<{ template: TemplateDTO }>(`/api/templates/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteTemplate: (id: string) => request<{ ok: true }>(`/api/templates/${id}`, { method: 'DELETE' }),
  duplicateTemplate: (id: string) =>
    request<{ template: TemplateDTO }>(`/api/templates/${id}/duplicate`, { method: 'POST' }),
  sendTemplatePdf: (id: string, mode: 'plain' | 'key' | 'teacher') =>
    request<{ ok: true }>(`/api/templates/${id}/send-pdf?mode=${mode}`, { method: 'POST' }),

  /* Ulashish: kod orqali nusxa */
  shareTemplate: (id: string) =>
    request<{ code: string; link: string | null }>(`/api/templates/${id}/share`, { method: 'POST' }),
  unshareTemplate: (id: string) => request<{ ok: true }>(`/api/templates/${id}/share`, { method: 'DELETE' }),
  sharedPreview: (code: string) =>
    request<{ preview: SharedTemplatePreviewDTO }>(`/api/templates/shared/${encodeURIComponent(code)}`),
  importTemplate: (code: string) =>
    request<{ template: TemplateDTO; already: boolean }>('/api/templates/import', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),

  /* Qoralamalar */
  drafts: () => request<{ drafts: DraftSummaryDTO[] }>('/api/drafts'),
  draft: (id: string) => request<{ draft: DraftDTO }>(`/api/drafts/${id}`),
  parseText: (text: string, title?: string) =>
    request<{ draft: DraftDTO }>('/api/parse', {
      method: 'POST',
      body: JSON.stringify({ text, title }),
    }),
  uploadFile: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<{ draft: DraftDTO }>('/api/upload', { method: 'POST', body: form });
  },
  updateDraft: (
    id: string,
    patch: { title?: string; questions?: Question[]; answerKeyText?: string; firstIsCorrect?: boolean },
  ) =>
    request<{ draft: DraftDTO }>(`/api/drafts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  confirmDraft: (
    id: string,
    body: {
      title?: string;
      subject?: string;
      settings?: Partial<TemplateDTO['settings']>;
      skipIncomplete?: boolean;
    },
  ) =>
    request<{ template: TemplateDTO; skipped: number }>(`/api/drafts/${id}/confirm`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  deleteDraft: (id: string) => request<{ ok: true }>(`/api/drafts/${id}`, { method: 'DELETE' }),

  /* Musobaqalar */
  races: (templateId?: string) =>
    request<{ races: RaceDTO[] }>(`/api/races${templateId ? `?templateId=${templateId}` : ''}`),
  race: (id: string) => request<{ race: RaceDTO }>(`/api/races/${id}`),
  sendRacePdf: (id: string) => request<{ ok: true }>(`/api/races/${id}/send-pdf`, { method: 'POST' }),
  podiumUrl: (id: string) => `${BASE}/api/races/${id}/podium.png`,

  /* Admin panel (faqat ADMIN_IDS) */
  admin: {
    overview: (fresh = false) =>
      request<{ overview: AdminOverviewDTO }>(`/api/admin/overview${fresh ? '?fresh=1' : ''}`),
    users: (q: string, page: number) =>
      request<AdminPage<AdminUserRowDTO>>(`/api/admin/users?${qs({ q, page })}`),
    user: (id: number) => request<AdminUserDetailDTO>(`/api/admin/users/${id}`),
    groups: (q: string, page: number) =>
      request<AdminPage<AdminGroupRowDTO>>(`/api/admin/groups?${qs({ q, page })}`),
    group: (chatId: number) => request<AdminGroupDetailDTO>(`/api/admin/groups/${chatId}`),
  },
};
