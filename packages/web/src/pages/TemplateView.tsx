import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronRight, Copy, FileDown, Send, Settings2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Question, RaceDTO, TemplateDTO } from '@testrace/shared';
import { api, ApiError } from '@/api';
import { ErrorNote, IconTile, LoadingList, Page, PageHeader, SectionTitle, StickyAction } from '@/components/app';
import { QuestionEditor } from '@/components/question-editor';
import { SettingsForm } from '@/components/settings-form';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetClose, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import {
  useInfiniteList,
  useTelegramBackButton,
  useTelegramMainButton,
  useUnsavedChanges,
} from '@/hooks';
import { cleanQuestion, isQuestionReady } from '@/lib/questions';
import { confirmMsg, hasNativeButtons, haptic, openTelegramLink, tap } from '@/telegram';

const PDF_MODES = [
  { mode: 'plain', emoji: '📄', label: 'Faqat savollar', hint: 'O‘quvchilarga tarqatish uchun' },
  { mode: 'key', emoji: '🔑', label: 'Javoblar kaliti bilan', hint: 'Kalit oxirgi sahifada' },
  { mode: 'teacher', emoji: '👩‍🏫', label: 'O‘qituvchi nusxasi', hint: 'To‘g‘ri javoblar belgilangan' },
] as const;

export default function TemplateView() {
  const { id = '' } = useParams();
  const navigate = useNavigate();

  const [template, setTemplate] = useState<TemplateDTO | null>(null);
  const [races, setRaces] = useState<RaceDTO[]>([]);
  const [botUsername, setBotUsername] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const list = useInfiniteList(template?.questions ?? [], 10);

  useUnsavedChanges(dirty);
  useTelegramBackButton(async () => {
    if (dirty && !(await confirmMsg('Saqlanmagan o‘zgarishlar bor. Chiqib ketamizmi?'))) return;
    navigate(-1);
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [t, r, me] = await Promise.all([api.template(id), api.races(id), api.me()]);
      setTemplate(t.template);
      setRaces(r.races);
      setBotUsername(me.botUsername);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Yuklab bo‘lmadi');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  function patch(p: Partial<TemplateDTO>) {
    setTemplate((prev) => (prev ? { ...prev, ...p } : prev));
    setDirty(true);
  }

  function patchQuestion(index: number, q: Question) {
    setTemplate((prev) =>
      prev ? { ...prev, questions: prev.questions.map((x, i) => (i === index ? q : x)) } : prev,
    );
    setDirty(true);
  }

  async function removeQuestion(index: number) {
    if (!template) return;
    if (template.questions.length <= 1) {
      toast.error('Shablonda kamida bitta savol qolishi kerak');
      return;
    }
    if (!(await confirmMsg(`${index + 1}-savol o‘chirilsinmi?`))) return;
    patch({ questions: template.questions.filter((_, i) => i !== index) });
  }

  async function save() {
    if (!template) return;
    const questions = template.questions.map(cleanQuestion);
    const broken = questions.findIndex((q) => !q.text || !isQuestionReady(q));
    if (broken >= 0) {
      haptic('error');
      toast.error(`${broken + 1}-savolda matn, 2 ta variant yoki to‘g‘ri javob yetishmayapti`);
      return;
    }
    if (template.title.trim().length < 2) {
      haptic('error');
      toast.error('Shablon nomini yozing');
      return;
    }
    setBusy(true);
    try {
      const res = await api.updateTemplate(id, {
        title: template.title.trim(),
        questions,
        settings: template.settings,
      });
      setTemplate(res.template);
      setDirty(false);
      haptic('success');
      toast.success('O‘zgarishlar saqlandi');
    } catch (err) {
      haptic('error');
      toast.error(err instanceof ApiError ? err.message : 'Saqlab bo‘lmadi');
    } finally {
      setBusy(false);
    }
  }

  async function sendToGroup() {
    if (!botUsername) {
      toast.error('Bot nomi sozlanmagan (.env dagi BOT_USERNAME)');
      return;
    }
    if (dirty) {
      toast.error('Avval o‘zgarishlarni saqlang');
      return;
    }
    haptic('success');
    openTelegramLink(`https://t.me/${botUsername}?startgroup=tpl_${id}`);
  }

  async function sendPdf(mode: 'plain' | 'key' | 'teacher') {
    setBusy(true);
    try {
      await api.sendTemplatePdf(id, mode);
      haptic('success');
      toast.success('PDF bot chatiga yuborildi 📩');
    } catch (err) {
      haptic('error');
      toast.error(err instanceof ApiError ? err.message : 'Yuborib bo‘lmadi');
    } finally {
      setBusy(false);
    }
  }

  async function duplicate() {
    try {
      const res = await api.duplicateTemplate(id);
      haptic('success');
      toast.success('Nusxa yaratildi');
      navigate(`/template/${res.template.id}`, { replace: true });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Nusxa olib bo‘lmadi');
    }
  }

  async function remove() {
    if (!(await confirmMsg('Shablon butunlay o‘chirilsinmi? Musobaqa natijalari saqlanib qoladi.'))) return;
    try {
      await api.deleteTemplate(id);
      haptic('success');
      toast.success('Shablon o‘chirildi');
      navigate('/', { replace: true });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'O‘chirib bo‘lmadi');
    }
  }

  useTelegramMainButton({
    text: dirty ? '💾 O‘zgarishlarni saqlash' : '🏁 Guruhga yuborish',
    visible: !loading && Boolean(template),
    loading: busy,
    onClick: () => (dirty ? void save() : void sendToGroup()),
  });

  if (loading)
    return (
      <Page>
        <PageHeader title="Shablon" back />
        <Skeleton className="h-36 w-full rounded-2xl" />
        <LoadingList rows={3} />
      </Page>
    );

  if (!template)
    return (
      <Page>
        <PageHeader title="Shablon" back />
        <ErrorNote onRetry={() => void load()}>{error ?? 'Shablon topilmadi'}</ErrorNote>
      </Page>
    );

  const s = template.settings;
  const perRace = s.questionLimit > 0 && s.questionLimit < template.questions.length ? s.questionLimit : template.questions.length;

  return (
    <Page>
      <PageHeader
        title={template.title}
        meta={dirty ? '✏️ Saqlanmagan o‘zgarishlar bor' : 'Shablon'}
        back
        action={
          <Sheet>
            <SheetTrigger asChild>
              <Button size="icon" variant="secondary" aria-label="Sozlamalar">
                <Settings2 />
              </Button>
            </SheetTrigger>
            <SheetContent title="⚙️ Shablon sozlamalari">
              <div className="space-y-6">
                <div className="space-y-1.5">
                  <Label className="text-[14.5px] font-bold text-foreground">📚 Nomi</Label>
                  <Input
                    value={template.title}
                    onChange={(e) => patch({ title: e.target.value })}
                    placeholder="Shablon nomi"
                  />
                </div>
                <SettingsForm
                  settings={template.settings}
                  max={template.questions.length}
                  onChange={(next) => patch({ settings: next })}
                />
                <div className="flex gap-2 border-t border-border pt-5">
                  <Button variant="secondary" className="flex-1" onClick={() => void duplicate()}>
                    <Copy /> Nusxa olish
                  </Button>
                  <Button variant="ghost" className="flex-1 text-destructive" onClick={() => void remove()}>
                    <Trash2 /> O‘chirish
                  </Button>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        }
      />

      {/* Asosiy karta: ko'rsatkichlar + asosiy amal */}
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="grid grid-cols-3 gap-2 text-center">
          <Metric value={perRace} label={perRace === template.questions.length ? 'savol' : `savol (${template.questions.length} dan)`} />
          <Metric value={`${s.timePerQuestion}s`} label="savolga" />
          <Metric value={template.racesCount} label="musobaqa" />
        </div>
        <div className="mt-3 flex flex-wrap justify-center gap-1.5 text-[12px] text-muted-foreground">
          {s.shuffleQuestions && <Tag>🔀 aralash savollar</Tag>}
          {s.shuffleOptions && <Tag>🔁 aralash variantlar</Tag>}
          {s.speedBonus && <Tag>⚡ tezlik bonusi</Tag>}
        </div>

        {!hasNativeButtons && (
          <Button className="mt-4 w-full" size="lg" onClick={() => void sendToGroup()} disabled={dirty}>
            <Send /> Guruhga yuborish
          </Button>
        )}
        <p className="mt-3 text-center text-[12.5px] leading-relaxed text-muted-foreground">
          {hasNativeButtons ? 'Pastdagi tugma → ' : ''}Guruhni tanlaysiz → u yerda “Boshlash” chiqadi.
          Musobaqani faqat guruh admini boshlaydi.
        </p>
      </div>

      <Sheet>
        <SheetTrigger asChild>
          <button
            onClick={tap}
            className="mt-2.5 flex w-full items-center gap-3 rounded-xl border border-border bg-card px-3 py-3 text-left active:scale-[.99]"
          >
            <IconTile emoji="📄" tone="muted" />
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">PDF qilib olish</span>
              <span className="block text-[12.5px] text-muted-foreground">Chop etish yoki tarqatish uchun</span>
            </span>
            <FileDown className="size-4 text-muted-foreground" />
          </button>
        </SheetTrigger>
        <SheetContent title="📄 Qaysi ko‘rinishda?">
          <div className="space-y-2">
            {PDF_MODES.map(({ mode, emoji, label, hint }) => (
              <SheetClose asChild key={mode}>
                <button
                  disabled={busy}
                  onClick={() => void sendPdf(mode)}
                  className="flex w-full items-center gap-3 rounded-xl border border-border px-3 py-3 text-left active:scale-[.99] disabled:opacity-50"
                >
                  <IconTile emoji={emoji} tone="muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{label}</span>
                    <span className="block text-[12.5px] text-muted-foreground">{hint}</span>
                  </span>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </button>
              </SheetClose>
            ))}
            <p className="pt-1 text-center text-[12.5px] text-muted-foreground">
              📩 Fayl bot orqali shaxsiy chatingizga keladi
            </p>
          </div>
        </SheetContent>
      </Sheet>

      {races.length > 0 && (
        <>
          <SectionTitle hint="Guruhlarda o‘tkazilgan musobaqalar">🏁 Natijalar</SectionTitle>
          <div className="space-y-2">
            {races.map((r) => {
              const winner = r.participants.find((p) => p.place === 1);
              return (
                <Link
                  key={r.id}
                  to={`/race/${r.id}`}
                  onClick={tap}
                  className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-3 active:scale-[.99]"
                >
                  <IconTile emoji="🏆" tone="muted" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{r.chatTitle || 'Guruh'}</div>
                    <div className="truncate text-[13px] text-muted-foreground">
                      👥 {r.participants.length} kishi
                      {winner ? ` · 🥇 ${winner.firstName}` : ''}
                      {r.finishedAt ? ` · ${new Date(r.finishedAt).toLocaleDateString('uz-UZ')}` : ''}
                    </div>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </Link>
              );
            })}
          </div>
        </>
      )}

      <SectionTitle hint={`Variantni bosib javobni almashtirasiz · ✏️ — matnni tuzatish`}>
        ❓ Savollar · {template.questions.length}
      </SectionTitle>
      <div className="space-y-2.5">
        {list.visible.map((q, i) => (
          <QuestionEditor
            key={i}
            index={i}
            question={q}
            onChange={(next) => patchQuestion(i, next)}
            onDelete={() => void removeQuestion(i)}
          />
        ))}
      </div>

      {list.hasMore && (
        <div ref={list.sentinelRef} className="space-y-2.5 pt-2.5">
          <Skeleton className="h-28 w-full rounded-xl" />
          <p className="text-center text-[12.5px] text-muted-foreground">
            {list.shown}/{list.total} ta savol yuklandi…
          </p>
        </div>
      )}

      {dirty && (
        <StickyAction>
          <Button className="w-full" size="lg" loading={busy} onClick={() => void save()}>
            💾 O‘zgarishlarni saqlash
          </Button>
        </StickyAction>
      )}
    </Page>
  );
}

function Metric({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="rounded-[12px] bg-background px-2 py-2.5">
      <div className="text-[20px] font-extrabold leading-tight tabular-nums">{value}</div>
      <div className="text-[12px] text-muted-foreground">{label}</div>
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-background px-2.5 py-1">{children}</span>;
}
