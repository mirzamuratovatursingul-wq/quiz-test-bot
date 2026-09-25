import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { FileDown } from 'lucide-react';
import { toast } from 'sonner';
import { medal, optionLabel, type RaceDTO } from '@testrace/shared';
import { api, ApiError } from '@/api';
import { ErrorNote, LoadingList, Page, PageHeader, SectionTitle } from '@/components/app';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { useTelegramBackButton } from '@/hooks';
import { cn } from '@/lib/utils';
import { haptic, initData, selectionTap } from '@/telegram';

export default function RaceDetail() {
  const { id = '' } = useParams();
  const [race, setRace] = useState<RaceDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageState, setImageState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [hardestFirst, setHardestFirst] = useState(false);

  useTelegramBackButton();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.race(id);
      setRace(res.race);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Yuklanmadi');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const questions = useMemo(() => {
    if (!race) return [];
    const withRate = race.questionStats.map((q) => ({
      ...q,
      rate: q.answeredCount > 0 ? Math.round((q.correctCount / q.answeredCount) * 100) : 0,
    }));
    return hardestFirst ? [...withRate].sort((a, b) => a.rate - b.rate) : withRate;
  }, [race, hardestFirst]);

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
        <ErrorNote onRetry={() => void load()}>{error ?? 'Musobaqa topilmadi'}</ErrorNote>
      </Page>
    );

  const sorted = [...race.participants].sort(
    (a, b) => (a.place ?? 99) - (b.place ?? 99) || b.score - a.score,
  );
  const answered = race.questionStats.reduce((s, q) => s + q.answeredCount, 0);
  const correct = race.questionStats.reduce((s, q) => s + q.correctCount, 0);
  const accuracy = answered > 0 ? Math.round((correct / answered) * 100) : 0;
  const date = race.finishedAt ? new Date(race.finishedAt).toLocaleDateString('uz-UZ') : null;

  return (
    <Page>
      <PageHeader
        title={race.templateTitle}
        meta={`${race.chatTitle || 'Guruh'}${date ? ` · ${date}` : ''}`}
        back
      />

      {imageState !== 'error' && (
        <div className="relative mb-3">
          {imageState === 'loading' && <Skeleton className="aspect-[16/10] w-full rounded-2xl" />}
          <img
            src={`${api.podiumUrl(id)}?initData=${encodeURIComponent(initData())}`}
            alt="G‘oliblar"
            className={cn(
              'w-full rounded-2xl border border-border',
              imageState === 'loading' && 'absolute inset-0 opacity-0',
            )}
            onLoad={() => setImageState('ok')}
            onError={() => setImageState('error')}
          />
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        <Metric value={race.participants.length} label="ishtirokchi" />
        <Metric value={race.totalQuestions} label="savol" />
        <Metric value={`${accuracy}%`} label="to‘g‘ri javob" />
      </div>

      <SectionTitle>🏆 Reyting</SectionTitle>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {sorted.map((p, i) => {
          const top = p.place !== undefined && p.place <= 3;
          return (
            <div
              key={p.userId}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5',
                i > 0 && 'border-t border-border',
                p.place === 1 && 'bg-warning/10',
              )}
            >
              <span className={cn('w-7 shrink-0 text-center tabular-nums', top ? 'text-[18px]' : 'text-[13px] text-muted-foreground')}>
                {p.place ? medal(p.place) : '–'}
              </span>
              <div className="min-w-0 flex-1">
                <div className={cn('truncate', top && 'font-semibold')}>{p.firstName}</div>
                <div className="text-[12px] text-muted-foreground">
                  ✅ {p.correct}/{race.totalQuestions}
                  {p.avgTimeMs > 0 && p.avgTimeMs < 1e9 ? ` · ⚡ ${(p.avgTimeMs / 1000).toFixed(1)} s` : ''}
                </div>
              </div>
              <span className="text-right text-[16px] font-extrabold tabular-nums">{p.score}</span>
            </div>
          );
        })}
      </div>

      <SectionTitle
        hint="Qaysi savol qiyin kelganini ko‘rsatadi"
        action={
          <button
            onClick={() => {
              selectionTap();
              setHardestFirst((v) => !v);
            }}
            className="shrink-0 rounded-full bg-card px-3 py-1 text-[12.5px] font-semibold text-primary"
          >
            {hardestFirst ? '↕ Tartib bo‘yicha' : '🔥 Qiyinlari oldin'}
          </button>
        }
      >
        ❓ Savollar tahlili
      </SectionTitle>
      <div className="space-y-2">
        {questions.map((q) => (
          <div key={q.index} className="rounded-xl border border-border bg-card p-3">
            <div className="mb-1 flex items-center justify-between text-[12px] text-muted-foreground">
              <span className="font-bold">{q.index + 1}-savol</span>
              <span>
                javob: <b className="text-foreground">{optionLabel(q.correctIndex)}</b> ·{' '}
                <b
                  className={cn(
                    q.rate >= 60 ? 'text-success-foreground' : q.rate >= 30 ? 'text-warning-foreground' : 'text-destructive',
                  )}
                >
                  {q.rate}%
                </b>{' '}
                ({q.correctCount}/{q.answeredCount})
              </span>
            </div>
            <p className="mb-2 line-clamp-2 text-[14px] leading-snug">{q.text}</p>
            <Progress
              value={q.rate}
              indicatorClassName={q.rate >= 60 ? 'bg-success' : q.rate >= 30 ? 'bg-warning' : 'bg-destructive'}
            />
          </div>
        ))}
      </div>

      <Button
        variant="secondary"
        className="mt-5 w-full"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api.sendRacePdf(id);
            haptic('success');
            toast.success('Hisobot bot chatiga yuborildi 📩');
          } catch (err) {
            haptic('error');
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

function Metric({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-2 py-2.5 text-center">
      <div className="text-[19px] font-extrabold leading-tight tabular-nums">{value}</div>
      <div className="text-[11.5px] text-muted-foreground">{label}</div>
    </div>
  );
}
