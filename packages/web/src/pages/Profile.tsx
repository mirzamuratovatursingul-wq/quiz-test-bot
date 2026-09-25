import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, Trophy } from 'lucide-react';
import type { UserProfileDTO } from '@testrace/shared';
import { api, ApiError, type StatsOverview, type UserStats } from '@/api';
import { EmptyState, ErrorNote, IconTile, LoadingList, Page, PageHeader, SectionTitle } from '@/components/app';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { currentUser, tap } from '@/telegram';

export default function Profile() {
  const [profile, setProfile] = useState<UserProfileDTO | null>(null);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [overview, setOverview] = useState<StatsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const tgUser = currentUser();
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [me, ov] = await Promise.all([api.me(), api.stats()]);
      setProfile(me.profile);
      setStats(me.stats);
      setOverview(ov);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Yuklanmadi');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading)
    return (
      <Page>
        <PageHeader title="Profil" />
        <Skeleton className="h-40 w-full rounded-2xl" />
        <LoadingList rows={3} />
      </Page>
    );

  const photo = profile?.photoUrl || tgUser?.photo_url;
  const name = [profile?.firstName ?? tgUser?.first_name, profile?.lastName].filter(Boolean).join(' ');
  const accuracy =
    stats && stats.totalAnswers > 0 ? Math.round((stats.totalCorrect / stats.totalAnswers) * 100) : 0;
  const totals = overview?.totals;

  return (
    <Page>
      <PageHeader title="Profil" meta="Natijalaringiz va musobaqalar tarixi" />
      {error && <ErrorNote onRetry={() => void load()}>{error}</ErrorNote>}

      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center gap-3">
          {photo ? (
            <img src={photo} alt="" className="size-14 rounded-full object-cover" />
          ) : (
            <div className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-xl font-bold text-primary">
              {(name || 'U').slice(0, 1)}
            </div>
          )}
          <div className="min-w-0">
            <div className="truncate text-[17px] font-bold">{name || 'Foydalanuvchi'}</div>
            {profile?.username && (
              <div className="text-[13px] text-muted-foreground">@{profile.username}</div>
            )}
          </div>
        </div>

        <p className="mb-2 mt-4 text-[12px] font-bold uppercase tracking-wide text-muted-foreground">
          Yaratuvchi sifatida
        </p>
        <div className="grid grid-cols-3 gap-2">
          <Stat value={profile?.templatesCount ?? 0} label="shablon" />
          <Stat value={stats?.racesHosted ?? 0} label="musobaqa" />
          <Stat value={totals?.participants ?? 0} label="ishtirokchi" />
        </div>

        <p className="mb-2 mt-4 text-[12px] font-bold uppercase tracking-wide text-muted-foreground">
          Ishtirokchi sifatida
        </p>
        <div className="grid grid-cols-3 gap-2">
          <Stat value={stats?.racesPlayed ?? 0} label="qatnashgan" />
          <Stat value={stats?.wins ?? 0} label="g‘alaba" />
          <Stat value={`${accuracy}%`} label="aniqlik" />
        </div>
      </div>

      <SectionTitle hint="Shablonlaringiz bo‘yicha o‘tkazilgan musobaqalar">🏁 Oxirgi musobaqalar</SectionTitle>
      {overview && overview.recentRaces.length > 0 ? (
        <div className="space-y-2">
          {overview.recentRaces.map((r) => (
            <Link
              key={r.id}
              to={`/race/${r.id}`}
              onClick={tap}
              className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-3 active:scale-[.99]"
            >
              <IconTile emoji="🏆" tone="muted" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{r.templateTitle}</div>
                <div className="truncate text-[13px] text-muted-foreground">
                  {r.chatTitle || 'Guruh'} · 👥 {r.participants}
                  {r.winner ? ` · 🥇 ${r.winner}` : ''}
                </div>
              </div>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Trophy}
          title="Hali musobaqa o‘tkazilmagan"
          hint="Shablonni guruhga yuboring — natijalar shu yerda paydo bo‘ladi."
          action={
            <Button variant="tonal" className="w-full" onClick={() => navigate('/')}>
              Shablonlarga o‘tish
            </Button>
          }
        />
      )}
    </Page>
  );
}

function Stat({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="rounded-[12px] bg-background px-2 py-2.5 text-center">
      <div className="text-[19px] font-extrabold leading-tight tabular-nums">{value}</div>
      <div className="text-[11.5px] text-muted-foreground">{label}</div>
    </div>
  );
}
