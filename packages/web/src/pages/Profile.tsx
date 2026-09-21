import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import type { UserProfileDTO } from '@testrace/shared';
import { api, ApiError, type StatsOverview, type UserStats } from '@/api';
import { ErrorNote, LoadingList, Page, PageHeader, SectionTitle } from '@/components/app';
import { currentUser } from '@/telegram';

export default function Profile() {
  const [profile, setProfile] = useState<UserProfileDTO | null>(null);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [overview, setOverview] = useState<StatsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const tgUser = currentUser();

  useEffect(() => {
    (async () => {
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
    })();
  }, []);

  if (loading)
    return (
      <Page>
        <PageHeader title="Profil" />
        <LoadingList />
      </Page>
    );

  const photo = profile?.photoUrl || tgUser?.photo_url;
  const accuracy =
    stats && stats.totalAnswers > 0
      ? Math.round((stats.totalCorrect / stats.totalAnswers) * 100)
      : 0;

  return (
    <Page>
      <PageHeader title="Profil" meta="Sizning natijalaringiz va tarix" />
      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="flex items-center gap-3 pb-2">
        {photo ? (
          <img src={photo} alt="" className="size-14 rounded-full object-cover" />
        ) : (
          <div className="flex size-14 items-center justify-center rounded-full bg-muted text-xl font-semibold">
            {(profile?.firstName ?? 'U').slice(0, 1)}
          </div>
        )}
        <div className="min-w-0">
          <div className="truncate font-semibold">
            {profile?.firstName} {profile?.lastName ?? ''}
          </div>
          {profile?.username && (
            <div className="text-[13px] text-muted-foreground">@{profile.username}</div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2 pt-2">
        <Stat value={profile?.templatesCount ?? 0} label="shablon" />
        <Stat value={stats?.racesHosted ?? 0} label="musobaqa" />
        <Stat value={stats?.wins ?? 0} label="g‘alaba" />
        <Stat value={`${accuracy}%`} label="aniqlik" />
      </div>

      {overview && overview.recentRaces.length > 0 && (
        <>
          <SectionTitle hint="Shablonlaringiz bo‘yicha o‘tkazilgan musobaqalar">🏁 Oxirgi musobaqalar</SectionTitle>
          <div className="space-y-2">
            {overview.recentRaces.map((r) => (
              <Link
                key={r.id}
                to={`/race/${r.id}`}
                className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{r.templateTitle}</div>
                  <div className="truncate text-[13px] text-muted-foreground">
                    {r.chatTitle || 'Guruh'} · {r.participants} kishi
                    {r.winner ? ` · 🥇 ${r.winner}` : ''}
                  </div>
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            ))}
          </div>
        </>
      )}
    </Page>
  );
}

function Stat({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-2 py-3 text-center">
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}
