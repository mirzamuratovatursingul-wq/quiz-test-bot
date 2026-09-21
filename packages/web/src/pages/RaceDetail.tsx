import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { FileDown } from 'lucide-react';
import { toast } from 'sonner';
import { medal, optionLabel, type RaceDTO } from '@testrace/shared';
import { api, ApiError } from '@/api';
import { ErrorNote, LoadingList, Page, PageHeader, SectionTitle } from '@/components/app';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { initData } from '@/telegram';
import { useTelegramBackButton } from '@/hooks';

export default function RaceDetail() {
  const { id = '' } = useParams();
  const [race, setRace] = useState<RaceDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageOk, setImageOk] = useState(true);

  useTelegramBackButton();

  useEffect(() => {
    (async () => {
      try {
        const res = await api.race(id);
        setRace(res.race);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Yuklanmadi');
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  if (loading)
    return (
      <Page>
        <PageHeader title="Natijalar" back />
        <LoadingList />
      </Page>
    );

  if (!race)
    return (
      <Page>
        <PageHeader title="Natijalar" back />
        <ErrorNote>{error ?? 'Topilmadi'}</ErrorNote>
      </Page>
    );

  const sorted = [...race.participants].sort(
    (a, b) => (a.place ?? 99) - (b.place ?? 99) || b.score - a.score,
  );

  return (
    <Page>
      <PageHeader
        title={race.templateTitle}
        meta={`${race.chatTitle || 'Guruh'} · ${race.participants.length} kishi`}
        back
      />

      {imageOk && (
        <img
          src={`${api.podiumUrl(id)}?initData=${encodeURIComponent(initData())}`}
          alt=""
          className="mb-3 w-full rounded-lg border border-border"
          onError={() => setImageOk(false)}
        />
      )}

      <div className="space-y-1">
        {sorted.map((p) => (
          <div
            key={p.userId}
            className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5"
          >
            <span className="w-7 shrink-0 text-center text-[13px] text-muted-foreground">
              {p.place ? medal(p.place) : '–'}
            </span>
            <span className="min-w-0 flex-1 truncate">{p.firstName}</span>
            <span className="text-[13px] text-muted-foreground">
              {p.correct}/{race.totalQuestions}
            </span>
            <span className="w-14 text-right font-semibold tabular-nums">{p.score}</span>
          </div>
        ))}
      </div>

      <SectionTitle hint="Qaysi savol qiyin kelganini ko‘rsatadi">❓ Savollar tahlili</SectionTitle>
      <div className="space-y-2">
        {race.questionStats.map((q) => {
          const rate = q.answeredCount > 0 ? Math.round((q.correctCount / q.answeredCount) * 100) : 0;
          return (
            <div key={q.index} className="rounded-lg border border-border bg-card p-3">
              <div className="mb-1 flex items-center justify-between text-[12px] text-muted-foreground">
                <span>{q.index + 1}</span>
                <span>
                  {optionLabel(q.correctIndex)} · {rate}%
                </span>
              </div>
              <p className="mb-2 line-clamp-2 text-[14px] leading-snug">{q.text}</p>
              <Progress
                value={rate}
                indicatorClassName={
                  rate >= 60
                    ? 'bg-[color:var(--success)]'
                    : rate >= 30
                      ? 'bg-[color:var(--warning)]'
                      : 'bg-destructive'
                }
              />
            </div>
          );
        })}
      </div>

      <Button
        variant="secondary"
        className="mt-4 w-full"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api.sendRacePdf(id);
            toast.success('Botga yuborildi');
          } catch (err) {
            toast.error(err instanceof ApiError ? err.message : 'Yuborilmadi');
          } finally {
            setBusy(false);
          }
        }}
      >
        <FileDown /> Hisobotni PDF qilib olish
      </Button>
    </Page>
  );
}
