import type {
  AdminGroupDetailDTO,
  AdminGroupRowDTO,
  AdminOverviewDTO,
  AdminPage,
  AdminRaceRowDTO,
  AdminUserDetailDTO,
  AdminUserRowDTO,
  RaceStatus,
} from '@testrace/shared';
import { isAdmin } from '../config.js';
import { Draft, Group, Race, Template, User } from '../db/models.js';

/**
 * Admin panel ma'lumotlari. Bazaga yuklama bermaslik uchun:
 *   - umumiy ko'rsatkichlar xotirada OVERVIEW_TTL_MS keshlanadi (bir nechta admin yoki
 *     sahifani qayta-qayta ochish bazaga borib kelmaydi);
 *   - ro'yxatlar sahifalab (PAGE_SIZE), faqat kerakli maydonlar bilan olinadi;
 *   - sanashlar faqat sahifadagi foydalanuvchilar uchun bitta aggregate bilan.
 */

const OVERVIEW_TTL_MS = 60_000;
/** "Yangilash" tugmasi bosilganda ham shundan tez-tez hisoblanmaydi */
const OVERVIEW_MIN_REFRESH_MS = 10_000;
export const PAGE_SIZE = 20;
const DAY_MS = 24 * 60 * 60 * 1000;
const TZ = 'Asia/Tashkent';

let overviewCache: { at: number; data: AdminOverviewDTO } | null = null;
let overviewPending: Promise<AdminOverviewDTO> | null = null;

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);

function displayName(u: { firstName?: string | null; lastName?: string | null; username?: string | null } | null | undefined, id?: number): string {
  const name = [u?.firstName, u?.lastName].filter(Boolean).join(' ').trim();
  if (name) return name;
  if (u?.username) return `@${u.username}`;
  return id ? `ID ${id}` : 'Nomaʼlum';
}

/** Foydalanuvchi id -> ism (bitta so'rov bilan) */
async function namesOf(ids: number[]): Promise<Map<number, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const users = await User.find({ telegramId: { $in: unique } }, { telegramId: 1, firstName: 1, lastName: 1, username: 1 }).lean();
  const map = new Map(users.map((u) => [u.telegramId, displayName(u)]));
  for (const id of unique) if (!map.has(id)) map.set(id, displayName(null, id));
  return map;
}

/** Oxirgi 14 kun sanalari (Toshkent vaqti), eskidan yangiga */
function lastDays(count: number): string[] {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  const days: string[] = [];
  for (let i = count - 1; i >= 0; i--) days.push(fmt.format(new Date(Date.now() - i * DAY_MS)));
  return days;
}

async function computeOverview(): Promise<AdminOverviewDTO> {
  const now = Date.now();
  const since14 = new Date(now - 14 * DAY_MS);

  const [
    users,
    active24h,
    active7d,
    newUsers7d,
    players,
    templates,
    copiedTemplates,
    drafts,
    racesFinished,
    racesActive,
    groupsActive,
    groupsTotal,
    usersDaily,
    racesDaily,
    creators,
    topGroupsDocs,
  ] = await Promise.all([
    User.estimatedDocumentCount(),
    User.countDocuments({ lastSeenAt: { $gte: new Date(now - DAY_MS) } }),
    User.countDocuments({ lastSeenAt: { $gte: new Date(now - 7 * DAY_MS) } }),
    User.countDocuments({ createdAt: { $gte: new Date(now - 7 * DAY_MS) } }),
    User.countDocuments({ 'stats.racesPlayed': { $gt: 0 } }),
    Template.estimatedDocumentCount(),
    Template.countDocuments({ copiedFrom: { $exists: true } }),
    Draft.estimatedDocumentCount(),
    Race.countDocuments({ status: 'finished' }),
    Race.countDocuments({ status: { $in: ['waiting', 'running'] } }),
    Group.countDocuments({ isActive: true }),
    Group.estimatedDocumentCount(),
    User.aggregate<{ _id: string; n: number }>([
      { $match: { createdAt: { $gte: since14 } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: TZ } }, n: { $sum: 1 } } },
    ]),
    Race.aggregate<{ _id: string; n: number }>([
      { $match: { status: 'finished', finishedAt: { $gte: since14 } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$finishedAt', timezone: TZ } }, n: { $sum: 1 } } },
    ]),
    Template.aggregate<{ _id: number; n: number }>([
      { $group: { _id: '$ownerId', n: { $sum: 1 } } },
      { $sort: { n: -1 } },
      { $limit: 5 },
    ]),
    Group.find({}, { chatId: 1, title: 1, racesCount: 1 }).sort({ racesCount: -1 }).limit(5).lean(),
  ]);

  const usersByDay = new Map(usersDaily.map((d) => [d._id, d.n]));
  const racesByDay = new Map(racesDaily.map((d) => [d._id, d.n]));
  const names = await namesOf(creators.map((c) => c._id));

  return {
    totals: {
      users,
      active24h,
      active7d,
      newUsers7d,
      players,
      templates,
      copiedTemplates,
      drafts,
      racesFinished,
      racesActive,
      groupsActive,
      groupsTotal,
    },
    daily: lastDays(14).map((date) => ({ date, users: usersByDay.get(date) ?? 0, races: racesByDay.get(date) ?? 0 })),
    topCreators: creators.map((c) => ({ telegramId: c._id, name: names.get(c._id) ?? '', templates: c.n })),
    topGroups: topGroupsDocs
      .filter((g) => (g.racesCount ?? 0) > 0)
      .map((g) => ({ chatId: g.chatId, title: g.title || `Guruh ${g.chatId}`, races: g.racesCount ?? 0 })),
    generatedAt: new Date(now).toISOString(),
  };
}

/** Keshlangan umumiy ko'rsatkichlar; bir vaqtda kelgan so'rovlar bitta hisobni kutadi */
export async function getOverview(fresh = false): Promise<AdminOverviewDTO> {
  const age = overviewCache ? Date.now() - overviewCache.at : Number.POSITIVE_INFINITY;
  if (overviewCache && (age < (fresh ? OVERVIEW_MIN_REFRESH_MS : OVERVIEW_TTL_MS))) return overviewCache.data;
  overviewPending ??= computeOverview()
    .then((data) => {
      overviewCache = { at: Date.now(), data };
      return data;
    })
    .finally(() => {
      overviewPending = null;
    });
  return overviewPending;
}

/* ------------------------------------------------------------------ */
/* Foydalanuvchilar                                                    */
/* ------------------------------------------------------------------ */

type UserLean = {
  telegramId: number;
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
  createdAt?: Date | null;
  lastSeenAt?: Date | null;
  stats?: { racesPlayed?: number | null } | null;
};

const USER_FIELDS = { telegramId: 1, firstName: 1, lastName: 1, username: 1, createdAt: 1, lastSeenAt: 1, 'stats.racesPlayed': 1 };

/** Sahifadagi foydalanuvchilar uchun shablon/test/guruh sonlari — ikki aggregate bilan */
async function userRows(users: UserLean[]): Promise<AdminUserRowDTO[]> {
  const ids = users.map((u) => u.telegramId);
  const [tplCounts, raceCounts] = await Promise.all([
    Template.aggregate<{ _id: number; n: number }>([
      { $match: { ownerId: { $in: ids } } },
      { $group: { _id: '$ownerId', n: { $sum: 1 } } },
    ]),
    Race.aggregate<{ _id: number; races: number; chats: number[] }>([
      { $match: { hostId: { $in: ids }, status: { $ne: 'cancelled' } } },
      { $group: { _id: '$hostId', races: { $sum: 1 }, chats: { $addToSet: '$chatId' } } },
    ]),
  ]);
  const tpl = new Map(tplCounts.map((c) => [c._id, c.n]));
  const races = new Map(raceCounts.map((c) => [c._id, c]));
  return users.map((u) => ({
    telegramId: u.telegramId,
    name: displayName(u, u.telegramId),
    username: u.username ?? '',
    createdAt: iso(u.createdAt) ?? new Date(0).toISOString(),
    lastSeenAt: iso(u.lastSeenAt),
    templates: tpl.get(u.telegramId) ?? 0,
    racesHosted: races.get(u.telegramId)?.races ?? 0,
    groups: races.get(u.telegramId)?.chats.length ?? 0,
    racesPlayed: u.stats?.racesPlayed ?? 0,
    isAdmin: isAdmin(u.telegramId),
  }));
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function listUsers(query: string, page: number): Promise<AdminPage<AdminUserRowDTO>> {
  const q = query.trim().replace(/^@/, '');
  let filter: Record<string, unknown> = {};
  if (/^\d{3,}$/.test(q)) filter = { telegramId: Number(q) };
  else if (q) {
    const re = new RegExp(escapeRegex(q.slice(0, 50)), 'i');
    filter = { $or: [{ firstName: re }, { lastName: re }, { username: re }] };
  }
  const [total, users] = await Promise.all([
    q ? User.countDocuments(filter) : User.estimatedDocumentCount(),
    User.find(filter, USER_FIELDS)
      .sort({ lastSeenAt: -1 })
      .skip(page * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .lean<UserLean[]>(),
  ]);
  return { items: await userRows(users), total, page, pageSize: PAGE_SIZE };
}

function raceRow(r: Record<string, any>, names: Map<number, string>): AdminRaceRowDTO {
  return {
    id: String(r._id),
    templateTitle: r.templateTitle ?? '',
    chatId: r.chatId,
    chatTitle: r.chatTitle || `Guruh ${r.chatId}`,
    hostId: r.hostId,
    hostName: names.get(r.hostId) ?? displayName(null, r.hostId),
    status: r.status as RaceStatus,
    untimed: Boolean(r.untimed),
    questions: r.questionsCount ?? 0,
    participants: r.participantsCount ?? 0,
    createdAt: iso(r.createdAt) ?? new Date(0).toISOString(),
  };
}

/** Musobaqalar: savol va ishtirokchilarning faqat soni (hujjatning o'zi emas) */
const RACE_ROW_PROJECTION = {
  templateTitle: 1,
  chatId: 1,
  chatTitle: 1,
  hostId: 1,
  status: 1,
  untimed: 1,
  createdAt: 1,
  questionsCount: { $size: '$questions' },
  participantsCount: { $size: '$participants' },
};

export async function userDetail(telegramId: number): Promise<AdminUserDetailDTO | null> {
  const user = await User.findOne({ telegramId }, USER_FIELDS).lean<UserLean>();
  if (!user) return null;

  const [[row], templates, races, groups] = await Promise.all([
    userRows([user]),
    Template.aggregate([
      { $match: { ownerId: telegramId } },
      { $sort: { createdAt: -1 } },
      { $limit: 50 },
      {
        $project: {
          title: 1,
          racesCount: 1,
          createdAt: 1,
          shareCode: 1,
          'copiedFrom.ownerName': 1,
          questionsCount: { $size: '$questions' },
        },
      },
    ]),
    Race.aggregate([
      { $match: { hostId: telegramId } },
      { $sort: { createdAt: -1 } },
      { $limit: 15 },
      { $project: RACE_ROW_PROJECTION },
    ]),
    Race.aggregate<{ _id: number; title: string; races: number; lastAt: Date }>([
      { $match: { hostId: telegramId, status: { $ne: 'cancelled' } } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: '$chatId', title: { $first: '$chatTitle' }, races: { $sum: 1 }, lastAt: { $first: '$createdAt' } } },
      { $sort: { lastAt: -1 } },
      { $limit: 20 },
    ]),
  ]);

  const names = new Map([[telegramId, row!.name]]);
  return {
    user: row!,
    templates: templates.map((t) => ({
      id: String(t._id),
      title: t.title,
      questions: t.questionsCount ?? 0,
      racesCount: t.racesCount ?? 0,
      createdAt: iso(t.createdAt) ?? new Date(0).toISOString(),
      copiedFrom: t.copiedFrom?.ownerName ?? null,
      shared: Boolean(t.shareCode),
    })),
    races: races.map((r) => raceRow(r, names)),
    groups: groups.map((g) => ({
      chatId: g._id,
      title: g.title || `Guruh ${g._id}`,
      races: g.races,
      lastAt: iso(g.lastAt) ?? new Date(0).toISOString(),
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Guruhlar                                                            */
/* ------------------------------------------------------------------ */

type GroupLean = {
  chatId: number;
  title?: string | null;
  type?: string | null;
  isActive?: boolean | null;
  racesCount?: number | null;
  createdAt?: Date | null;
  updatedAt?: Date | null;
};

function groupRow(g: GroupLean): AdminGroupRowDTO {
  return {
    chatId: g.chatId,
    title: g.title || `Guruh ${g.chatId}`,
    type: g.type ?? 'group',
    isActive: g.isActive !== false,
    races: g.racesCount ?? 0,
    addedAt: iso(g.createdAt) ?? new Date(0).toISOString(),
    lastActivityAt: iso(g.updatedAt) ?? new Date(0).toISOString(),
  };
}

export async function listGroups(query: string, page: number): Promise<AdminPage<AdminGroupRowDTO>> {
  const q = query.trim();
  const filter = q ? { title: new RegExp(escapeRegex(q.slice(0, 50)), 'i') } : {};
  const [total, groups] = await Promise.all([
    q ? Group.countDocuments(filter) : Group.estimatedDocumentCount(),
    Group.find(filter).sort({ updatedAt: -1 }).skip(page * PAGE_SIZE).limit(PAGE_SIZE).lean<GroupLean[]>(),
  ]);
  return { items: groups.map(groupRow), total, page, pageSize: PAGE_SIZE };
}

export async function groupDetail(chatId: number): Promise<AdminGroupDetailDTO | null> {
  const group = await Group.findOne({ chatId }).lean<GroupLean>();
  if (!group) return null;

  const [races, hosts] = await Promise.all([
    Race.aggregate([
      { $match: { chatId } },
      { $sort: { createdAt: -1 } },
      { $limit: 20 },
      { $project: RACE_ROW_PROJECTION },
    ]),
    Race.aggregate<{ _id: number; races: number }>([
      { $match: { chatId, status: { $ne: 'cancelled' } } },
      { $group: { _id: '$hostId', races: { $sum: 1 } } },
      { $sort: { races: -1 } },
      { $limit: 20 },
    ]),
  ]);
  const names = await namesOf([...races.map((r) => r.hostId as number), ...hosts.map((h) => h._id)]);
  return {
    group: groupRow(group),
    races: races.map((r) => raceRow(r, names)),
    hosts: hosts.map((h) => ({ telegramId: h._id, name: names.get(h._id) ?? '', races: h.races })),
  };
}
