import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronRight, RefreshCw, Search, ShieldCheck, X } from 'lucide-react';
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
import { api, ApiError } from '@/api';
import { EmptyState, ErrorNote, LoadingList, Page, PageHeader, SectionTitle } from '@/components/app';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { selectionTap, tap } from '@/telegram';

/* ------------------------------------------------------------------ */
/* Formatlash                                                          */
/* ------------------------------------------------------------------ */

const MONTHS = ['yan', 'fev', 'mar', 'apr', 'may', 'iyun', 'iyul', 'avg', 'sen', 'okt', 'noy', 'dek'];

/** "2026-09-30" -> "30-sen" */
function shortDate(isoDay: string): string {
  const [, m, d] = isoDay.split('-').map(Number);
  return `${d}-${MONTHS[(m ?? 1) - 1]}`;
}

function fullDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()}-${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const sec = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return 'hozirgina';
  if (sec < 3600) return `${Math.floor(sec / 60)} daq oldin`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} soat oldin`;
  if (sec < 30 * 86400) return `${Math.floor(sec / 86400)} kun oldin`;
  return fullDate(iso);
}

const compact = (n: number) => (n >= 10_000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}K` : n.toLocaleString('ru-RU'));

const STATUS: Record<RaceStatus, { label: string; variant: 'default' | 'success' | 'warning' | 'tonal' }> = {
  finished: { label: 'yakunlangan', variant: 'success' },
  running: { label: 'ketmoqda', variant: 'warning' },
  waiting: { label: 'kutmoqda', variant: 'tonal' },
  cancelled: { label: 'bekor', variant: 'default' },
};

type Tab = 'overview' | 'users' | 'groups';

/* ------------------------------------------------------------------ */
/* Sahifa                                                              */
/* ------------------------------------------------------------------ */

const TABS: Tab[] = ['overview', 'users', 'groups'];

export default function Admin() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  // /admin?tab=users — to'g'ridan-to'g'ri kerakli tabni ochish
  const [tab, setTab] = useState<Tab>(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('tab') as Tab | null;
    return fromUrl && TABS.includes(fromUrl) ? fromUrl : 'overview';
  });
  const [userId, setUserId] = useState<number | null>(null);
  const [groupId, setGroupId] = useState<number | null>(null);

  useEffect(() => {
    api
      .config()
      .then((c) => setAllowed(c.isAdmin))
      .catch(() => setAllowed(false));
  }, []);

  const openUser = (id: number) => {
    tap();
    setGroupId(null);
    setUserId(id);
  };
  const openGroup = (id: number) => {
    tap();
    setUserId(null);
    setGroupId(id);
  };

  if (allowed === null) {
    return (
      <Page>
        <PageHeader title="Admin panel" />
        <LoadingList rows={4} />
      </Page>
    );
  }

  if (!allowed) {
    return (
      <Page>
        <PageHeader title="Admin panel" />
        <EmptyState
          icon={ShieldCheck}
          title="Faqat bot adminlari uchun"
          hint="Kirish uchun Telegram ID ingiz serverdagi .env faylidagi ADMIN_IDS roʻyxatida boʻlishi kerak."
        />
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader title="Admin panel" meta="Bot kimlar tomonidan va qanday ishlatilmoqda" />

      <div className="sticky top-[60px] z-10 -mx-4 mb-3 bg-background/90 px-4 pb-2 backdrop-blur">
        <div className="grid grid-cols-3 gap-1 rounded-[10px] bg-muted p-1">
          {(
            [
              ['overview', 'Umumiy'],
              ['users', 'Foydalanuvchilar'],
              ['groups', 'Guruhlar'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => {
                selectionTap();
                setTab(key);
              }}
              className={cn(
                'h-8 rounded-[8px] text-[13px] font-semibold transition-colors',
                tab === key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Tablar yashirilganda holati (qidiruv, sahifa) saqlanib qoladi */}
      <div hidden={tab !== 'overview'}>
        <OverviewTab onUser={openUser} onGroup={openGroup} />
      </div>
      <div hidden={tab !== 'users'}>
        <UsersTab onUser={openUser} active={tab === 'users'} />
      </div>
      <div hidden={tab !== 'groups'}>
        <GroupsTab onGroup={openGroup} active={tab === 'groups'} />
      </div>

      <UserSheet id={userId} onClose={() => setUserId(null)} onGroup={openGroup} />
      <GroupSheet chatId={groupId} onClose={() => setGroupId(null)} onUser={openUser} />
    </Page>
  );
}

/* ------------------------------------------------------------------ */
/* Umumiy                                                              */
/* ------------------------------------------------------------------ */

function OverviewTab({ onUser, onGroup }: { onUser: (id: number) => void; onGroup: (id: number) => void }) {
  const [data, setData] = useState<AdminOverviewDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (fresh: boolean) => {
    setRefreshing(true);
    setError(null);
    try {
      setData((await api.admin.overview(fresh)).overview);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Yuklanmadi');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  if (!data) {
    return error ? (
      <ErrorNote onRetry={() => void load(false)}>{error}</ErrorNote>
    ) : (
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[84px] rounded-[10px]" />
          ))}
        </div>
        <Skeleton className="h-[128px] rounded-[10px]" />
        <Skeleton className="h-[128px] rounded-[10px]" />
      </div>
    );
  }

  const t = data.totals;
  return (
    // Yangilanayotganda eski ko'rinish xiraroq turadi — sakrash yo'q
    <div className={cn('transition-opacity', refreshing && 'opacity-60')}>
      {error && <ErrorNote onRetry={() => void load(true)}>{error}</ErrorNote>}

      <div className="grid grid-cols-2 gap-2">
        <StatTile label="Foydalanuvchilar" value={t.users} sub={`24 soatda faol: ${compact(t.active24h)}`} />
        <StatTile label="Shablonlar" value={t.templates} sub={`kod orqali nusxa: ${compact(t.copiedTemplates)}`} />
        <StatTile
          label="Oʻtkazilgan testlar"
          value={t.racesFinished}
          sub={t.racesActive > 0 ? `hozir ketmoqda: ${t.racesActive}` : 'hozir faol test yoʻq'}
        />
        <StatTile label="Faol guruhlar" value={t.groupsActive} sub={`jami qoʻshilgan: ${compact(t.groupsTotal)}`} />
      </div>

      <div className="mt-2 space-y-2">
        <DailyBars title="Yangi foydalanuvchilar" data={data.daily.map((d) => ({ date: d.date, value: d.users }))} />
        <DailyBars title="Oʻtkazilgan testlar" data={data.daily.map((d) => ({ date: d.date, value: d.races }))} />
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
        <MiniStat value={t.active7d} label="7 kunda faol" />
        <MiniStat value={t.players} label="qatnashchi" />
        <MiniStat value={t.drafts} label="qoralama" />
      </div>

      <SectionTitle hint="Eng koʻp shablon yaratganlar">Faol yaratuvchilar</SectionTitle>
      <RowList empty="Hali shablon yoʻq">
        {data.topCreators.map((c) => (
          <Row
            key={c.telegramId}
            onClick={() => onUser(c.telegramId)}
            avatar={c.name}
            title={c.name}
            meta={`${c.templates} ta shablon`}
          />
        ))}
      </RowList>

      <SectionTitle hint="Eng koʻp test oʻtkazilgan">Faol guruhlar</SectionTitle>
      <RowList empty="Hali guruhda test oʻtkazilmagan">
        {data.topGroups.map((g) => (
          <Row key={g.chatId} onClick={() => onGroup(g.chatId)} avatar={g.title} title={g.title} meta={`${g.races} ta test`} />
        ))}
      </RowList>

      <div className="mt-4 flex items-center justify-center gap-2 text-[12px] text-muted-foreground">
        <span>
          {new Date(data.generatedAt).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })} holatiga
        </span>
        <button
          onClick={() => {
            tap();
            void load(true);
          }}
          disabled={refreshing}
          className="inline-flex items-center gap-1 rounded-full px-2 py-1 font-semibold text-primary disabled:opacity-50"
        >
          <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} /> Yangilash
        </button>
      </div>
    </div>
  );
}

function StatTile({ label, value, sub }: { label: string; value: number; sub: string }) {
  return (
    <div className="rounded-[10px] border border-border bg-card px-3 py-2.5">
      <div className="text-[12.5px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-[24px] font-bold leading-tight">{compact(value)}</div>
      <div className="mt-0.5 truncate text-[11.5px] text-muted-foreground">{sub}</div>
    </div>
  );
}

function MiniStat({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-[10px] bg-muted px-2 py-2">
      <div className="text-[16px] font-bold leading-tight tabular-nums">{compact(value)}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

/**
 * 14 kunlik ustunli grafik (bitta o'lchov — legenda kerak emas, sarlavha nomlaydi).
 * Ustunni bosish/ustiga olib borish kun qiymatini ko'rsatadi; aks holda 14 kunlik jami.
 */
function DailyBars({ title, data }: { title: string; data: { date: string; value: number }[] }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const total = data.reduce((s, d) => s + d.value, 0);
  const focused = active !== null ? data[active] : null;

  return (
    <div className="rounded-[10px] border border-border bg-card px-3 pb-2 pt-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[13px] font-semibold">{title}</div>
        <div className="text-[12.5px] text-muted-foreground">
          {focused ? (
            <>
              {shortDate(focused.date)}: <b className="text-[14px] text-foreground">{focused.value}</b>
            </>
          ) : (
            <>
              14 kunda: <b className="text-[14px] text-foreground">{total}</b>
            </>
          )}
        </div>
      </div>

      <div className="mt-2 flex h-16 items-end border-b border-border" onPointerLeave={() => setActive(null)}>
        {data.map((d, i) => {
          const pct = d.value > 0 ? Math.max(8, (d.value / max) * 100) : 0;
          return (
            <button
              key={d.date}
              type="button"
              aria-label={`${shortDate(d.date)}: ${d.value}`}
              onPointerEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              onClick={() => setActive(i)}
              // Butun ustun balandligi — bosish maydoni ustunning o'zidan katta
              className="flex h-full flex-1 items-end justify-center px-[1px] outline-none"
            >
              <span
                className={cn(
                  'block w-full max-w-[24px] rounded-t-[4px] transition-opacity',
                  d.value > 0 ? 'bg-primary' : 'bg-transparent',
                  active !== null && active !== i && 'opacity-45',
                )}
                style={{ height: `${pct}%` }}
              />
            </button>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
        <span>{data[0] ? shortDate(data[0].date) : ''}</span>
        <span>bugun</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Ro'yxatlar                                                          */
/* ------------------------------------------------------------------ */

/** Qidiruv + sahifalab yuklash (20 tadan) */
function usePagedList<T>(fetcher: (q: string, page: number) => Promise<AdminPage<T>>, active: boolean) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const seq = useRef(0);

  const load = useCallback(
    async (q: string, p: number) => {
      const id = ++seq.current;
      setLoading(true);
      setError(null);
      try {
        const res = await fetcher(q, p);
        if (id !== seq.current) return; // eskirgan javob (qidiruv o'zgargan)
        setItems((prev) => (p === 0 ? res.items : [...prev, ...res.items]));
        setTotal(res.total);
        setPage(p);
      } catch (err) {
        if (id === seq.current) setError(err instanceof ApiError ? err.message : 'Yuklanmadi');
      } finally {
        if (id === seq.current) setLoading(false);
      }
    },
    [fetcher],
  );

  // Tab birinchi ochilganda yuklanadi (admin faqat Umumiy'ni ko'rsa, ro'yxatlar so'ralmaydi)
  useEffect(() => {
    if (active && !started) {
      setStarted(true);
      void load('', 0);
    }
  }, [active, started, load]);

  // Qidiruv: yozish to'xtagach 400 ms
  useEffect(() => {
    if (!started) return;
    const t = setTimeout(() => void load(query, 0), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return {
    query,
    setQuery,
    items,
    total,
    loading,
    error,
    hasMore: items.length < total,
    loadMore: () => void load(query, page + 1),
    retry: () => void load(query, 0),
  };
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative mb-2">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-10 rounded-[10px] bg-card pl-9 pr-9"
      />
      {value && (
        <button
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground"
          aria-label="Tozalash"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}

function ListFooter({ shown, total, loading, hasMore, onMore }: { shown: number; total: number; loading: boolean; hasMore: boolean; onMore: () => void }) {
  return (
    <div className="pt-2 text-center">
      {hasMore ? (
        <Button variant="secondary" size="sm" loading={loading} onClick={onMore}>
          Yana yuklash · {shown}/{total}
        </Button>
      ) : (
        shown > 0 && <p className="text-[12px] text-muted-foreground">Jami {total} ta</p>
      )}
    </div>
  );
}

function UsersTab({ onUser, active }: { onUser: (id: number) => void; active: boolean }) {
  const list = usePagedList<AdminUserRowDTO>(api.admin.users, active);
  return (
    <>
      <SearchBox value={list.query} onChange={list.setQuery} placeholder="Ism, @username yoki Telegram ID" />
      {list.error && <ErrorNote onRetry={list.retry}>{list.error}</ErrorNote>}
      {list.loading && list.items.length === 0 ? (
        <LoadingList rows={5} />
      ) : (
        <RowList empty={list.query ? 'Hech kim topilmadi' : 'Foydalanuvchilar yoʻq'}>
          {list.items.map((u) => (
            <Row
              key={u.telegramId}
              onClick={() => onUser(u.telegramId)}
              avatar={u.name}
              title={u.name}
              badge={u.isAdmin ? <Badge variant="tonal">admin</Badge> : undefined}
              meta={[u.username ? `@${u.username}` : null, timeAgo(u.lastSeenAt)].filter(Boolean).join(' · ')}
              right={<Counts items={[['shablon', u.templates], ['test', u.racesHosted]]} />}
            />
          ))}
        </RowList>
      )}
      <ListFooter shown={list.items.length} total={list.total} loading={list.loading} hasMore={list.hasMore} onMore={list.loadMore} />
    </>
  );
}

function GroupsTab({ onGroup, active }: { onGroup: (id: number) => void; active: boolean }) {
  const list = usePagedList<AdminGroupRowDTO>(api.admin.groups, active);
  return (
    <>
      <SearchBox value={list.query} onChange={list.setQuery} placeholder="Guruh nomi" />
      {list.error && <ErrorNote onRetry={list.retry}>{list.error}</ErrorNote>}
      {list.loading && list.items.length === 0 ? (
        <LoadingList rows={5} />
      ) : (
        <RowList empty={list.query ? 'Guruh topilmadi' : 'Bot hali guruhga qoʻshilmagan'}>
          {list.items.map((g) => (
            <Row
              key={g.chatId}
              onClick={() => onGroup(g.chatId)}
              avatar={g.title}
              title={g.title}
              badge={g.isActive ? undefined : <Badge>chiqarilgan</Badge>}
              meta={`oxirgi faollik: ${timeAgo(g.lastActivityAt)}`}
              right={<Counts items={[['test', g.races]]} />}
            />
          ))}
        </RowList>
      )}
      <ListFooter shown={list.items.length} total={list.total} loading={list.loading} hasMore={list.hasMore} onMore={list.loadMore} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Tafsilotlar                                                         */
/* ------------------------------------------------------------------ */

function useDetail<T>(key: number | null, fetcher: (key: number) => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setData(null);
    setError(null);
    if (key === null) return;
    let alive = true;
    fetcher(key)
      .then((d) => alive && setData(d))
      .catch((err) => alive && setError(err instanceof ApiError ? err.message : 'Yuklanmadi'));
    return () => {
      alive = false;
    };
  }, [key, fetcher]);
  return { data, error };
}

function UserSheet({ id, onClose, onGroup }: { id: number | null; onClose: () => void; onGroup: (id: number) => void }) {
  const { data, error } = useDetail<AdminUserDetailDTO>(id, api.admin.user);
  const u = data?.user;
  return (
    <Sheet open={id !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent title="Foydalanuvchi">
        {error && <ErrorNote>{error}</ErrorNote>}
        {!data && !error && <DetailSkeleton />}
        {u && data && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Avatar name={u.name} size="lg" />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[17px] font-bold">{u.name}</span>
                  {u.isAdmin && <Badge variant="tonal">admin</Badge>}
                </div>
                <div className="truncate text-[12.5px] text-muted-foreground">
                  {[u.username ? `@${u.username}` : null, `ID ${u.telegramId}`].filter(Boolean).join(' · ')}
                </div>
                <div className="text-[12px] text-muted-foreground">
                  qoʻshilgan {fullDate(u.createdAt)} · oxirgi marta {timeAgo(u.lastSeenAt)}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-1.5 text-center">
              <MiniStat value={u.templates} label="shablon" />
              <MiniStat value={u.racesHosted} label="test" />
              <MiniStat value={u.groups} label="guruh" />
              <MiniStat value={u.racesPlayed} label="qatnashgan" />
            </div>

            <DetailSection title="Shablonlari" count={data.templates.length} empty="Shablon yoʻq">
              {data.templates.map((tpl) => (
                <div key={tpl.id} className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{tpl.title}</span>
                    {tpl.shared && <Badge variant="tonal">ulashilgan</Badge>}
                  </div>
                  <div className="truncate text-[12px] text-muted-foreground">
                    {tpl.questions} savol · {tpl.racesCount} marta oʻtkazilgan · {fullDate(tpl.createdAt)}
                    {tpl.copiedFrom ? ` · nusxa: ${tpl.copiedFrom}` : ''}
                  </div>
                </div>
              ))}
            </DetailSection>

            <DetailSection title="Test oʻtkazgan guruhlari" count={data.groups.length} empty="Guruhga test yubormagan">
              {data.groups.map((g) => (
                <button
                  key={g.chatId}
                  onClick={() => onGroup(g.chatId)}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left active:bg-muted"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold">{g.title}</span>
                    <span className="block text-[12px] text-muted-foreground">
                      {g.races} ta test · oxirgisi {timeAgo(g.lastAt)}
                    </span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </DetailSection>

            <DetailSection title="Soʻnggi testlari" count={data.races.length} empty="Test oʻtkazmagan">
              {data.races.map((r) => (
                <RaceLine key={r.id} race={r} context="group" />
              ))}
            </DetailSection>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function GroupSheet({ chatId, onClose, onUser }: { chatId: number | null; onClose: () => void; onUser: (id: number) => void }) {
  const { data, error } = useDetail<AdminGroupDetailDTO>(chatId, api.admin.group);
  const g = data?.group;
  return (
    <Sheet open={chatId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent title="Guruh">
        {error && <ErrorNote>{error}</ErrorNote>}
        {!data && !error && <DetailSkeleton />}
        {g && data && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Avatar name={g.title} size="lg" />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[17px] font-bold">{g.title}</span>
                  {g.isActive ? <Badge variant="success">faol</Badge> : <Badge>chiqarilgan</Badge>}
                </div>
                <div className="text-[12.5px] text-muted-foreground">
                  ID {g.chatId} · {g.type === 'supergroup' ? 'superguruh' : 'guruh'}
                </div>
                <div className="text-[12px] text-muted-foreground">
                  qoʻshilgan {fullDate(g.addedAt)} · faollik {timeAgo(g.lastActivityAt)}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-1.5 text-center">
              <MiniStat value={g.races} label="jami test" />
              <MiniStat value={data.hosts.length} label="test yuborganlar" />
            </div>

            <DetailSection title="Test yuborganlar" count={data.hosts.length} empty="Hali hech kim test yubormagan">
              {data.hosts.map((h) => (
                <button
                  key={h.telegramId}
                  onClick={() => onUser(h.telegramId)}
                  className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left active:bg-muted"
                >
                  <Avatar name={h.name} />
                  <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{h.name}</span>
                  <span className="text-[12px] text-muted-foreground">{h.races} ta test</span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </DetailSection>

            <DetailSection title="Soʻnggi testlar" count={data.races.length} empty="Test oʻtkazilmagan">
              {data.races.map((r) => (
                <RaceLine key={r.id} race={r} context="host" />
              ))}
            </DetailSection>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function RaceLine({ race, context }: { race: AdminRaceRowDTO; context: 'group' | 'host' }) {
  const s = STATUS[race.status];
  return (
    <div className="px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{race.templateTitle}</span>
        <Badge variant={s.variant}>{s.label}</Badge>
      </div>
      <div className="truncate text-[12px] text-muted-foreground">
        {context === 'group' ? race.chatTitle : race.hostName} · {race.questions} savol · {race.participants} kishi
        {race.untimed ? ' · vaqtsiz' : ''} · {timeAgo(race.createdAt)}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Kichik bo'laklar                                                    */
/* ------------------------------------------------------------------ */

function Avatar({ name, size = 'md' }: { name: string; size?: 'md' | 'lg' }) {
  const letter = (name.replace(/^@/, '').trim()[0] ?? '?').toUpperCase();
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full bg-primary/10 font-bold text-primary',
        size === 'lg' ? 'size-12 text-[18px]' : 'size-9 text-[14px]',
      )}
    >
      {letter}
    </span>
  );
}

function RowList({ children, empty }: { children: React.ReactNode[]; empty: string }) {
  if (children.length === 0) {
    return <p className="rounded-[10px] border border-dashed border-border py-6 text-center text-[13px] text-muted-foreground">{empty}</p>;
  }
  return <div className="divide-y divide-border overflow-hidden rounded-[10px] border border-border bg-card">{children}</div>;
}

function Row({
  onClick,
  avatar,
  title,
  meta,
  badge,
  right,
}: {
  onClick: () => void;
  avatar: string;
  title: string;
  meta: string;
  badge?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left active:bg-muted">
      <Avatar name={avatar} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[14.5px] font-semibold">{title}</span>
          {badge}
        </span>
        <span className="block truncate text-[12px] text-muted-foreground">{meta}</span>
      </span>
      {right}
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

function Counts({ items }: { items: [string, number][] }) {
  return (
    <span className="flex shrink-0 gap-2.5 text-right">
      {items.map(([label, n]) => (
        <span key={label} className="leading-tight">
          <span className="block text-[14px] font-bold tabular-nums">{n}</span>
          <span className="block text-[10.5px] text-muted-foreground">{label}</span>
        </span>
      ))}
    </span>
  );
}

function DetailSection({ title, count, empty, children }: { title: string; count: number; empty: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-1.5 flex items-baseline justify-between px-1">
        <span className="text-[13px] font-bold">{title}</span>
        {count > 0 && <span className="text-[12px] text-muted-foreground">{count}</span>}
      </div>
      {count === 0 ? (
        <p className="rounded-[10px] bg-muted py-3 text-center text-[12.5px] text-muted-foreground">{empty}</p>
      ) : (
        <div className="max-h-[260px] divide-y divide-border overflow-y-auto rounded-[10px] border border-border bg-card">
          {children}
        </div>
      )}
    </section>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Skeleton className="size-12 rounded-full" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      </div>
      <Skeleton className="h-14 w-full rounded-[10px]" />
      <Skeleton className="h-32 w-full rounded-[10px]" />
    </div>
  );
}
