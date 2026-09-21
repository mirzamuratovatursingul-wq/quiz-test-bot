import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, Plus } from 'lucide-react';
import type { DraftDTO, TemplateDTO } from '@testrace/shared';
import { api, ApiError } from '@/api';
import { ErrorNote, LoadingList, Page, PageHeader, SectionTitle } from '@/components/app';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { currentUser } from '@/telegram';

export default function Home() {
  const [templates, setTemplates] = useState<TemplateDTO[]>([]);
  const [drafts, setDrafts] = useState<DraftDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const user = currentUser();

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [t, d] = await Promise.all([api.templates(), api.drafts()]);
        if (!alive) return;
        setTemplates(t.templates);
        setDrafts(d.drafts);
      } catch (err) {
        if (alive) setError(err instanceof ApiError ? err.message : 'Ulanib bo‘lmadi');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const empty = !loading && templates.length === 0 && drafts.length === 0;

  return (
    <Page>
      <PageHeader
        title={user ? `Salom, ${user.first_name}! 👋` : 'Shablonlar'}
        meta="Testlaringizni shu yerda tayyorlaysiz"
        action={
          <Button size="icon" onClick={() => navigate('/new')} aria-label="Yangi test">
            <Plus />
          </Button>
        }
      />

      {error && <ErrorNote>{error}</ErrorNote>}
      {loading && <LoadingList />}

      {!loading && drafts.length > 0 && (
        <>
          <SectionTitle hint="Tahlil qilindi — ko‘rib chiqib tasdiqlang">
            ⏳ Tasdiqlashni kutmoqda
          </SectionTitle>
          <div className="space-y-2">
            {drafts.map((d) => {
              const open = d.questions.filter((q) => q.correctIndex < 0).length;
              return (
                <Row
                  key={d.id}
                  to={`/draft/${d.id}`}
                  emoji="📝"
                  title={d.title}
                  meta={`${d.questions.length} ta savol · ${
                    d.sourceType === 'pdf' ? 'PDF' : d.sourceType === 'docx' ? 'Word' : 'matn'
                  }`}
                  badge={
                    open > 0 ? (
                      <Badge variant="warning">⚠️ {open} ta javobsiz</Badge>
                    ) : (
                      <Badge variant="success">✓ tayyor</Badge>
                    )
                  }
                />
              );
            })}
          </div>
        </>
      )}

      {!loading && templates.length > 0 && (
        <>
          <SectionTitle hint="Guruhga yuborib, musobaqa o‘tkazsa bo‘ladi">
            📚 Shablonlarim
          </SectionTitle>
          <div className="space-y-2">
            {templates.map((t) => (
              <Row
                key={t.id}
                to={`/template/${t.id}`}
                emoji="📘"
                title={t.title}
                meta={`${t.questions.length} ta savol · savolga ${t.settings?.timePerQuestion ?? 15} s`}
                badge={t.racesCount > 0 ? <Badge>🏁 {t.racesCount} musobaqa</Badge> : null}
              />
            ))}
          </div>
        </>
      )}

      {empty && (
        <div className="rounded-lg border border-border bg-card p-5 text-center">
          <div className="text-3xl">📚</div>
          <p className="mt-2 font-semibold">Hali shablon yo‘q</p>
          <p className="mt-1 text-[13.5px] leading-relaxed text-muted-foreground">
            Menga PDF, Word fayl yoki test matnini bering — savollarni o‘zim ajratib beraman.
          </p>
          <Button className="mt-4 w-full" onClick={() => navigate('/new')}>
            <Plus /> Birinchi testni qo‘shish
          </Button>
        </div>
      )}

      {!loading && (
        <div className="mt-5 rounded-lg border border-border bg-card p-4">
          <p className="mb-2 font-semibold">🏁 Guruhda musobaqa qanday o‘tadi?</p>
          <ol className="space-y-1.5 text-[13.5px] leading-relaxed text-muted-foreground">
            <li>
              <b className="text-foreground">1.</b> Shablonni ochib, “Guruhga yuborish”ni bosasiz.
            </li>
            <li>
              <b className="text-foreground">2.</b> Guruhda “Boshlash” tugmasi chiqadi — bosasiz.
            </li>
            <li>
              <b className="text-foreground">3.</b> Savollar so‘rovnoma bo‘lib tushadi, sekundlar
              jonli sanaladi.
            </li>
            <li>
              <b className="text-foreground">4.</b> Yakunda g‘oliblar rasmi va statistika chiqadi.
            </li>
          </ol>
        </div>
      )}
    </Page>
  );
}

function Row({
  to,
  emoji,
  title,
  meta,
  badge,
}: {
  to: string;
  emoji: string;
  title: string;
  meta: string;
  badge?: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 active:scale-[.99]"
    >
      <span className="text-xl leading-none">{emoji}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold">{title}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
          <span className="truncate">{meta}</span>
          {badge}
        </div>
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}
