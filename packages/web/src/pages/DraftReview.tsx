import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Filter, Settings2 } from 'lucide-react';
import { toast } from 'sonner';
import type { DraftDTO, Question, TemplateDTO } from '@testrace/shared';
import { api, ApiError } from '@/api';
import { ErrorNote, LoadingList, Page, PageHeader } from '@/components/app';
import { QuestionEditor } from '@/components/question-editor';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  useInfiniteList,
  useTelegramBackButton,
  useTelegramMainButton,
  useUnsavedChanges,
} from '@/hooks';
import { confirmMsg, haptic, selectionTap } from '@/telegram';

type Settings = TemplateDTO['settings'];

const DEFAULTS: Settings = {
  timePerQuestion: 15,
  shuffleQuestions: true,
  shuffleOptions: true,
  questionLimit: 0,
  speedBonus: true,
};

export default function DraftReview() {
  const { id = '' } = useParams();
  const navigate = useNavigate();

  const [draft, setDraft] = useState<DraftDTO | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [title, setTitle] = useState('');
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [onlyOpen, setOnlyOpen] = useState(false);

  useTelegramBackButton();
  useUnsavedChanges(!loading && !busy);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.draft(id);
        setDraft(res.draft);
        setQuestions(res.draft.questions);
        setTitle(res.draft.title);
        setOnlyOpen(res.draft.questions.some((q) => q.correctIndex < 0));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Yuklab bo‘lmadi');
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const open = useMemo(
    () => questions.filter((q) => q.correctIndex < 0 || q.options.length < 2).length,
    [questions],
  );
  const ready = questions.length - open;

  const visible = useMemo(
    () =>
      questions
        .map((q, i) => ({ q, i }))
        .filter(({ q }) => !onlyOpen || q.correctIndex < 0 || q.options.length < 2),
    [questions, onlyOpen],
  );

  const list = useInfiniteList(visible, 10);

  function update(index: number, next: Question) {
    setQuestions((prev) => prev.map((q, i) => (i === index ? next : q)));
  }

  async function removeQuestion(index: number) {
    if (!(await confirmMsg('Bu savol o‘chirilsinmi?'))) return;
    setQuestions((prev) => prev.filter((_, i) => i !== index));
  }

  async function confirm() {
    if (ready === 0) {
      toast.error('Kamida bitta to‘liq savol kerak');
      return;
    }
    if (
      open > 0 &&
      !(await confirmMsg(
        `${open} ta savolning to‘g‘ri javobi belgilanmagan. Ular saqlanmaydi. Davom etamizmi?`,
      ))
    ) {
      return;
    }

    setBusy(true);
    try {
      await api.updateDraft(id, { title, questions });
      const res = await api.confirmDraft(id, { title, settings, skipIncomplete: true });
      haptic('success');
      toast.success('Shablon saqlandi');
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
    visible: !loading,
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
        <ErrorNote>{error ?? 'Topilmadi'}</ErrorNote>
      </Page>
    );

  return (
    <Page className="pb-28">
      <PageHeader
        title="Tekshirib chiqing"
        meta={`${questions.length} ta savol topildi`}
        back
        action={
          <Sheet>
            <SheetTrigger asChild>
              <Button size="icon" variant="secondary" aria-label="Sozlamalar">
                <Settings2 />
              </Button>
            </SheetTrigger>
            <SheetContent title="⚙️ Musobaqa sozlamalari">
              <SettingsForm settings={settings} onChange={setSettings} max={questions.length} />
            </SheetContent>
          </Sheet>
        }
      />

      <div
        className={`mb-3 rounded-lg p-3 text-[13.5px] leading-relaxed ${
          open > 0 ? 'bg-[color:var(--warning)]/10' : 'bg-muted'
        }`}
      >
        {open > 0 ? (
          <>
            <b>⚠️ {open} ta savolning javobi topilmadi.</b> Ularni sariq ramka bilan belgiladim —
            to‘g‘ri variantni bosib qo‘ying. Belgilanmaganlari saqlanmaydi.
          </>
        ) : (
          <>
            <b>✅ Hammasi joyida.</b> Savol matnini bosib tahrirlashingiz, variantni bosib to‘g‘ri
            javobni almashtirishingiz mumkin.
          </>
        )}
      </div>

      <Label className="mb-1.5 block">Shablon nomi</Label>
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="h-12 text-[16px] font-semibold"
        placeholder="Masalan: Matematika 7-sinf"
      />

      {open > 0 && (
        <button
          onClick={() => {
            selectionTap();
            setOnlyOpen((v) => !v);
          }}
          className="mt-3 flex w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-[13.5px]"
        >
          <Filter className="size-4 text-muted-foreground" />
          {onlyOpen
            ? `Hammasini ko‘rsatish (${questions.length} ta)`
            : `Faqat javobsizlarini ko‘rsatish (${open} ta)`}
        </button>
      )}

      <div className="mt-3 space-y-2.5">
        {list.visible.map(({ q, i }) => (
          <QuestionEditor
            key={i}
            index={i}
            question={q}
            onChange={(next) => update(i, next)}
            onDelete={() => void removeQuestion(i)}
          />
        ))}
      </div>

      {list.hasMore && (
        <div ref={list.sentinelRef} className="space-y-2.5 pt-2.5">
          <Skeleton className="h-28 w-full" />
          <p className="text-center text-[12.5px] text-muted-foreground">
            {list.shown}/{list.total} ta savol ko‘rsatildi
          </p>
        </div>
      )}

      <Button
        className="mt-5 w-full"
        size="lg"
        loading={busy}
        disabled={ready === 0}
        onClick={() => void confirm()}
      >
        ✅ Tasdiqlash · {ready} ta savol
      </Button>
      <p className="mt-2 text-center text-[12.5px] text-muted-foreground">
        Tasdiqlagandan so‘ng shablon profilingizda saqlanadi
      </p>
    </Page>
  );
}

export function SettingsForm({
  settings,
  onChange,
  max,
}: {
  settings: Settings;
  onChange: (s: Settings) => void;
  max: number;
}) {
  return (
    <div className="space-y-5">
      <Field
        label="⏱ Har bir savolga vaqt"
        hint="Guruhda so‘rovnoma shuncha soniya ochiq turadi (5–120)"
      >
        <Input
          type="number"
          min={5}
          max={120}
          value={settings.timePerQuestion}
          onChange={(e) => onChange({ ...settings, timePerQuestion: Number(e.target.value) || 15 })}
        />
      </Field>

      <Field label="🔢 Musobaqadagi savollar soni" hint={`0 = hammasi (jami ${max} ta)`}>
        <Input
          type="number"
          min={0}
          max={max}
          value={settings.questionLimit}
          onChange={(e) => onChange({ ...settings, questionLimit: Number(e.target.value) || 0 })}
        />
      </Field>

      <Toggle
        label="🔀 Savollarni aralashtirish"
        hint="Har musobaqada tartib boshqacha bo‘ladi"
        checked={settings.shuffleQuestions}
        onChange={(v) => onChange({ ...settings, shuffleQuestions: v })}
      />
      <Toggle
        label="🔁 Variantlarni aralashtirish"
        hint="Javoblarni yodlab olishning oldini oladi"
        checked={settings.shuffleOptions}
        onChange={(v) => onChange({ ...settings, shuffleOptions: v })}
      />
      <Toggle
        label="⚡ Tezlik bonusi"
        hint="Tez javob bergan ko‘proq ball oladi (100 + 100 gacha)"
        checked={settings.speedBonus}
        onChange={(v) => onChange({ ...settings, speedBonus: v })}
      />
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[14px] font-semibold text-foreground">{label}</Label>
      {hint && <p className="text-[12.5px] text-muted-foreground">{hint}</p>}
      {children}
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="text-[14.5px] font-medium">{label}</div>
        {hint && <div className="text-[12.5px] leading-snug text-muted-foreground">{hint}</div>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} className="mt-1 shrink-0" />
    </div>
  );
}
