import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Check, CloudUpload, Settings2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { DraftDTO, Question } from '@testrace/shared';
import { api, ApiError } from '@/api';
import { ErrorNote, LoadingList, Page, PageHeader, StickyAction } from '@/components/app';
import { QuestionEditor } from '@/components/question-editor';
import { DEFAULT_SETTINGS, SettingsForm, type Settings } from '@/components/settings-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useInfiniteList,
  useTelegramBackButton,
  useTelegramMainButton,
  useUnsavedChanges,
} from '@/hooks';
import { cleanQuestion, isQuestionReady } from '@/lib/questions';
import { cn } from '@/lib/utils';
import { confirmMsg, haptic, selectionTap } from '@/telegram';

/** O'zgarishdan keyin shuncha vaqt o'tib qoralama serverga yoziladi */
const AUTOSAVE_MS = 1200;

type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

export default function DraftReview() {
  const { id = '' } = useParams();
  const navigate = useNavigate();

  const [draft, setDraft] = useState<DraftDTO | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [title, setTitle] = useState('');
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * "Javobsizlar" filtri: yoqilgan paytdagi javobsiz savollar indekslari.
   * Javob belgilangan savol ro'yxatdan darhol yo'qolmaydi — yashil bo'lib qoladi.
   */
  const [focus, setFocus] = useState<Set<number> | null>(null);
  const onlyOpen = focus !== null;
  const [saveState, setSaveState] = useState<SaveState>('idle');

  useTelegramBackButton();
  useUnsavedChanges(saveState === 'pending' || saveState === 'saving' || saveState === 'error');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.draft(id);
      setDraft(res.draft);
      setQuestions(res.draft.questions);
      setTitle(res.draft.title);
      setFocus(openIndices(res.draft.questions));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Yuklab bo‘lmadi');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  /* ---------- Avtosaqlash: orqaga chiqib ketilsa ham tahrir yo'qolmaydi ---------- */

  const latest = useRef({ title, questions });
  latest.current = { title, questions };
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const persist = useCallback(async () => {
    clearTimeout(timer.current);
    const cleaned = latest.current.questions.map(cleanQuestion);
    // Tahrirlash jarayonidagi bo'sh savol/variantlar serverdan o'tmaydi — keyinroq saqlanadi
    if (cleaned.some((q) => !q.text || q.options.length === 0)) {
      setSaveState('pending');
      return false;
    }
    setSaveState('saving');
    try {
      await api.updateDraft(id, { title: latest.current.title.trim() || 'Nomsiz test', questions: cleaned });
      setSaveState('saved');
      return true;
    } catch {
      setSaveState('error');
      return false;
    }
  }, [id]);

  function markDirty() {
    setSaveState('pending');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void persist(), AUTOSAVE_MS);
  }

  useEffect(() => () => clearTimeout(timer.current), []);

  /* ---------- Hisob-kitoblar ---------- */

  const open = useMemo(() => questions.filter((q) => !isQuestionReady(q)).length, [questions]);
  const ready = questions.length - open;

  const visible = useMemo(
    () => questions.map((q, i) => ({ q, i })).filter(({ i }) => !focus || focus.has(i)),
    [questions, focus],
  );

  function setOnlyOpen(value: boolean) {
    setFocus(value ? openIndices(questions) : null);
  }

  const list = useInfiniteList(visible, 10);

  function update(index: number, next: Question) {
    setQuestions((prev) => prev.map((q, i) => (i === index ? next : q)));
    markDirty();
  }

  async function removeQuestion(index: number) {
    if (!(await confirmMsg(`${index + 1}-savol o‘chirilsinmi?`))) return;
    const next = questions.filter((_, i) => i !== index);
    setQuestions(next);
    if (focus) setFocus(openIndices(next));
    markDirty();
  }

  async function removeDraft() {
    if (!(await confirmMsg('Qoralama butunlay o‘chirilsinmi? Bu amalni qaytarib bo‘lmaydi.'))) return;
    try {
      clearTimeout(timer.current);
      await api.deleteDraft(id);
      haptic('success');
      toast.success('Qoralama o‘chirildi');
      navigate('/', { replace: true });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'O‘chirib bo‘lmadi');
    }
  }

  async function confirm() {
    if (ready === 0) {
      haptic('error');
      toast.error('Kamida bitta savolning to‘g‘ri javobini belgilang');
      return;
    }
    if (
      open > 0 &&
      !(await confirmMsg(
        `${open} ta savolning javobi belgilanmagan — ular shablonga kirmaydi. ${ready} ta savol bilan saqlaymizmi?`,
      ))
    ) {
      return;
    }

    setBusy(true);
    try {
      clearTimeout(timer.current);
      await api.updateDraft(id, {
        title: title.trim() || 'Nomsiz test',
        questions: questions.map(cleanQuestion).filter((q) => q.text && q.options.length > 0),
      });
      const res = await api.confirmDraft(id, {
        title: title.trim() || 'Nomsiz test',
        settings,
        skipIncomplete: true,
      });
      setSaveState('idle');
      haptic('success');
      toast.success('Shablon saqlandi 🎉');
      navigate(`/template/${res.template.id}`, { replace: true });
    } catch (err) {
      haptic('error');
      toast.error(err instanceof ApiError ? err.message : 'Saqlab bo‘lmadi');
    } finally {
      setBusy(false);
    }
  }

  useTelegramMainButton({
    text: busy ? 'Saqlanmoqda…' : `✅ Tasdiqlash · ${ready} ta savol`,
    enabled: ready > 0,
    loading: busy,
    visible: !loading && Boolean(draft),
    onClick: () => void confirm(),
  });

  if (loading)
    return (
      <Page>
        <PageHeader title="Tekshirish" back />
        <LoadingList />
      </Page>
    );

  if (!draft)
    return (
      <Page>
        <PageHeader title="Tekshirish" back />
        <ErrorNote onRetry={() => void load()}>{error ?? 'Qoralama topilmadi'}</ErrorNote>
      </Page>
    );

  const percent = questions.length > 0 ? Math.round((ready / questions.length) * 100) : 0;

  return (
    <Page>
      <PageHeader
        title="Tekshirib chiqing"
        meta={<SaveIndicator state={saveState} total={questions.length} />}
        back
        action={
          <Sheet>
            <SheetTrigger asChild>
              <Button size="icon" variant="secondary" aria-label="Sozlamalar">
                <Settings2 />
              </Button>
            </SheetTrigger>
            <SheetContent title="⚙️ Musobaqa sozlamalari">
              <SettingsForm settings={settings} onChange={setSettings} max={Math.max(ready, 1)} />
              <Button variant="ghost" className="mt-6 w-full text-destructive" onClick={() => void removeDraft()}>
                <Trash2 /> Qoralamani o‘chirish
              </Button>
            </SheetContent>
          </Sheet>
        }
      />

      {/* Holat kartasi: nechta tayyor, nechta qoldi */}
      <div className={cn('rounded-xl p-4', open > 0 ? 'bg-warning/10' : 'bg-success/10')}>
        <div className="flex items-baseline justify-between">
          <span className="font-bold">
            {open > 0 ? `⚠️ ${open} ta savolga javob kerak` : '✅ Hammasi tayyor'}
          </span>
          <span className="text-[13px] font-semibold tabular-nums text-muted-foreground">
            {ready}/{questions.length}
          </span>
        </div>
        <Progress
          value={percent}
          className="mt-2 h-2 bg-background"
          indicatorClassName={open > 0 ? 'bg-warning' : 'bg-success'}
        />
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          {open > 0
            ? 'Sariq savollarda to‘g‘ri variantni bosing. Belgilanmaganlari shablonga kirmaydi.'
            : 'Variantni bosib javobni almashtirish, ✏️ bilan matnni tuzatish mumkin.'}
        </p>
        {open > 0 && (
          <div className="mt-3 flex gap-2">
            <FilterChip active={onlyOpen} onClick={() => setOnlyOpen(true)}>
              Javobsizlar · {open}
            </FilterChip>
            <FilterChip active={!onlyOpen} onClick={() => setOnlyOpen(false)}>
              Hammasi · {questions.length}
            </FilterChip>
          </div>
        )}
      </div>

      <Label className="mb-1.5 mt-4 block px-1 text-[13px] text-muted-foreground">Shablon nomi</Label>
      <Input
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
          markDirty();
        }}
        className="h-12 rounded-[12px] bg-card text-[16px] font-semibold"
        placeholder="Masalan: Matematika 7-sinf"
      />

      <div className="mt-4 space-y-2.5">
        {list.visible.map(({ q, i }) => (
          <QuestionEditor
            key={i}
            index={i}
            question={q}
            onChange={(next) => update(i, next)}
            onDelete={() => void removeQuestion(i)}
          />
        ))}
        {onlyOpen && open === 0 && (
          <div className="rounded-xl bg-success/10 p-5 text-center">
            <p className="font-bold">🎉 Hamma savolga javob belgilandi</p>
            <Button variant="tonal" size="sm" className="mt-3" onClick={() => setOnlyOpen(false)}>
              Hammasini ko‘rish
            </Button>
          </div>
        )}
      </div>

      {list.hasMore && (
        <div ref={list.sentinelRef} className="space-y-2.5 pt-2.5">
          <Skeleton className="h-28 w-full rounded-xl" />
          <p className="text-center text-[12.5px] text-muted-foreground">
            {list.shown}/{list.total} ta savol ko‘rsatildi
          </p>
        </div>
      )}

      <StickyAction>
        <Button className="w-full" size="lg" loading={busy} disabled={ready === 0} onClick={() => void confirm()}>
          ✅ Tasdiqlash · {ready} ta savol
        </Button>
      </StickyAction>
    </Page>
  );
}

function openIndices(questions: Question[]): Set<number> | null {
  const set = new Set(questions.flatMap((q, i) => (isQuestionReady(q) ? [] : [i])));
  return set.size > 0 ? set : null;
}

function SaveIndicator({ state, total }: { state: SaveState; total: number }) {
  if (state === 'saving' || state === 'pending')
    return (
      <span className="inline-flex items-center gap-1">
        <CloudUpload className="size-3.5" /> Saqlanmoqda…
      </span>
    );
  if (state === 'saved')
    return (
      <span className="inline-flex items-center gap-1 text-success-foreground">
        <Check className="size-3.5" /> Qoralama saqlandi
      </span>
    );
  if (state === 'error') return <span className="text-destructive">⚠️ Saqlanmadi — internetni tekshiring</span>;
  return <>{total} ta savol topildi</>;
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={() => {
        selectionTap();
        onClick();
      }}
      className={cn(
        'h-8 rounded-full px-3 text-[13px] font-semibold transition-colors',
        active ? 'bg-foreground text-background' : 'bg-background text-foreground',
      )}
    >
      {children}
    </button>
  );
}
