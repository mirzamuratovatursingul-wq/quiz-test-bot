import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ChevronRight,
  FileText,
  FileUp,
  ListChecks,
  Plus,
  Search,
  Send,
  Upload,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { DraftDTO, TemplateDTO } from '@testrace/shared';
import { api, ApiError } from '@/api';
import { ErrorNote, IconTile, LoadingList, Page, PageHeader, SectionTitle } from '@/components/app';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { isQuestionReady } from '@/lib/questions';
import { currentUser, tap } from '@/telegram';

/** Shablonlar shu sondan ko'p bo'lsa qidiruv maydoni chiqadi */
const SEARCH_FROM = 5;

const SOURCE_LABEL: Record<string, string> = { pdf: 'PDF', docx: 'Word', text: 'matn' };

export default function Home() {
  const [templates, setTemplates] = useState<TemplateDTO[]>([]);
  const [drafts, setDrafts] = useState<DraftDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const user = currentUser();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [t, d] = await Promise.all([api.templates(), api.drafts()]);
      setTemplates(t.templates);
      setDrafts(d.drafts);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Serverga ulanib bo‘lmadi');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? templates.filter((t) => t.title.toLowerCase().includes(q)) : templates;
  }, [templates, query]);

  const empty = !loading && !error && templates.length === 0 && drafts.length === 0;
  const totalQuestions = templates.reduce((s, t) => s + t.questions.length, 0);
  const totalRaces = templates.reduce((s, t) => s + t.racesCount, 0);

  return (
    <Page>
      <PageHeader
        title={user ? `Salom, ${user.first_name}! 👋` : 'Shablonlar'}
        meta={
          templates.length > 0
            ? `${templates.length} ta shablon · ${totalQuestions} ta savol · ${totalRaces} ta musobaqa`
            : 'Testlaringizni shu yerda tayyorlaysiz'
        }
        action={
          <Button size="icon" onClick={() => navigate('/new')} aria-label="Yangi test">
            <Plus />
          </Button>
        }
      />

      {error && <ErrorNote onRetry={() => void load()}>{error}</ErrorNote>}
      {loading && <LoadingList />}

      {empty && (
        <Onboarding onStart={() => navigate('/new')} onSample={() => navigate('/new?sample=1')} />
      )}

      {!loading && drafts.length > 0 && (
        <>
          <SectionTitle hint="Tahlil qilindi — ko‘rib chiqib tasdiqlang">
            ⏳ Tasdiqlashni kutmoqda
          </SectionTitle>
          <div className="space-y-2">
            {drafts.map((d) => {
              const open = d.questions.filter((q) => !isQuestionReady(q)).length;
              return (
                <Row
                  key={d.id}
                  to={`/draft/${d.id}`}
                  icon={<IconTile emoji="📝" tone="warning" />}
                  title={d.title}
                  meta={`${d.questions.length} ta savol · ${SOURCE_LABEL[d.sourceType] ?? 'matn'}`}
                  badge={
                    open > 0 ? (
                      <Badge variant="warning">{open} ta javobsiz</Badge>
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
          <SectionTitle hint="Ochib, guruhga yuboring yoki PDF oling">📚 Shablonlarim</SectionTitle>

          {templates.length >= SEARCH_FROM && (
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Shablon nomi bo‘yicha qidirish"
                className="h-11 rounded-[12px] bg-card pl-9 pr-9"
              />
              {query && (
                <button
                  onClick={() => setQuery('')}
                  className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground"
                  aria-label="Tozalash"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>
          )}

          <div className="space-y-2">
            {filtered.map((t) => (
              <Row
                key={t.id}
                to={`/template/${t.id}`}
                icon={<IconTile emoji="📘" />}
                title={t.title}
                meta={`${t.questions.length} ta savol · ⏱ ${t.settings?.timePerQuestion ?? 15} s`}
                badge={
                  t.racesCount > 0 ? (
                    <Badge>🏁 {t.racesCount}</Badge>
                  ) : (
                    <Badge variant="tonal">yangi</Badge>
                  )
                }
              />
            ))}
            {filtered.length === 0 && (
              <p className="py-6 text-center text-[13.5px] text-muted-foreground">
                “{query}” bo‘yicha shablon topilmadi
              </p>
            )}
          </div>
        </>
      )}

      {/* Tajribali foydalanuvchiga qo'llanma xalaqit bermasin — faqat boshida */}
      {!loading && !empty && templates.length < 3 && <HowItWorks />}
    </Page>
  );
}

const ONBOARDING_STEPS: { icon: LucideIcon; title: string; hint: string }[] = [
  { icon: FileUp, title: 'Test yuklang', hint: 'PDF, Word yoki matn' },
  { icon: ListChecks, title: 'Tekshirib tasdiqlang', hint: 'Javobsiz savollarni belgilaysiz' },
  { icon: Send, title: 'Guruhga yuboring', hint: 'Musobaqa so‘rovnoma bo‘lib o‘tadi' },
];

/** Yangi foydalanuvchi uchun boshlash kartasi — minimal: sarlavha, 3 qadam, bitta amal */
function Onboarding({ onStart, onSample }: { onStart: () => void; onSample: () => void }) {
  return (
    <section className="rounded-[10px] border border-border p-5">
      <h2 className="text-[18px] font-bold leading-snug">Birinchi testingizni qo‘shing</h2>
      <p className="mt-1 text-[13.5px] text-muted-foreground">
        Savol va variantlarni o‘zim ajrataman — sizga faqat tekshirish qoladi.
      </p>

      <ol className="mt-5 space-y-3.5">
        {ONBOARDING_STEPS.map(({ icon: Icon, title, hint }) => (
          <li key={title} className="flex items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-[8px] bg-muted text-foreground">
              <Icon className="size-[18px]" strokeWidth={1.75} />
            </span>
            <div className="min-w-0">
              <div className="text-[14.5px] font-semibold leading-tight">{title}</div>
              <div className="text-[12.5px] text-muted-foreground">{hint}</div>
            </div>
          </li>
        ))}
      </ol>

      <Button
        className="mt-6 w-full rounded-[8px]"
        onClick={() => {
          tap();
          onStart();
        }}
      >
        <Upload /> Test yuklash
      </Button>
      <button
        onClick={() => {
          tap();
          onSample();
        }}
        className="mt-3 flex w-full items-center justify-center gap-1.5 text-[13.5px] font-medium text-primary"
      >
        <FileText className="size-4" strokeWidth={1.75} /> Namuna bilan sinab ko‘rish
      </button>
    </section>
  );
}

function HowItWorks() {
  return (
    <div className="mt-6 rounded-xl border border-border bg-card p-4">
      <p className="mb-2 font-bold">🏁 Guruhda musobaqa qanday o‘tadi?</p>
      <ol className="space-y-1.5 text-[13.5px] leading-relaxed text-muted-foreground">
        <li>
          <b className="text-foreground">1.</b> Shablonni ochib, “Guruhga yuborish”ni bosasiz.
        </li>
        <li>
          <b className="text-foreground">2.</b> Guruhda “Boshlash” tugmasi chiqadi — bosasiz.
        </li>
        <li>
          <b className="text-foreground">3.</b> Savollar so‘rovnoma bo‘lib tushadi, sekundlar jonli
          sanaladi.
        </li>
        <li>
          <b className="text-foreground">4.</b> Yakunda g‘oliblar rasmi va statistika chiqadi.
        </li>
      </ol>
    </div>
  );
}

function Row({
  to,
  icon,
  title,
  meta,
  badge,
}: {
  to: string;
  icon: React.ReactNode;
  title: string;
  meta: string;
  badge?: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      onClick={tap}
      className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-3 transition-transform active:scale-[.99]"
    >
      {icon}
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold">{title}</div>
        <div className="mt-0.5 flex items-center gap-2 text-[13px] text-muted-foreground">
          <span className="truncate">{meta}</span>
          {badge}
        </div>
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}
