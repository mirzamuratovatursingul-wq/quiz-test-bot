import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronRight, Copy, FileDown, Send, Settings2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Question, RaceDTO, TemplateDTO } from '@testrace/shared';
import { api, ApiError } from '@/api';
import { ErrorNote, LoadingList, Page, PageHeader, SectionTitle } from '@/components/app';
import { QuestionEditor } from '@/components/question-editor';
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
import { confirmMsg, haptic, openTelegramLink } from '@/telegram';
import { SettingsForm } from './DraftReview';

const PDF_MODES = [
  { mode: 'plain', emoji: '📄', label: 'Faqat savollar', hint: 'O‘quvchiga tarqatish uchun' },
  { mode: 'key', emoji: '🔑', label: 'Javoblar kaliti bilan', hint: 'Oxirgi sahifada kalit' },
  { mode: 'teacher', emoji: '👩‍🏫', label: 'O‘qituvchi nusxasi', hint: 'To‘g‘ri javob belgilangan' },
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

  useTelegramBackButton();
  useUnsavedChanges(dirty);

  useEffect(() => {
    (async () => {
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
    })();
  }, [id]);

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

  async function save() {
    if (!template) return;
    setBusy(true);
    try {
      await api.updateTemplate(id, {
        title: template.title,
        questions: template.questions,
        settings: template.settings,
      });
      setDirty(false);
      haptic('success');
      toast.success('O‘zgarishlar saqlandi');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Saqlab bo‘lmadi');
    } finally {
      setBusy(false);
    }
  }

  function sendToGroup() {
    if (!botUsername) {
      toast.error('Bot nomi sozlanmagan (.env dagi BOT_USERNAME)');
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
      toast.success('PDF botdagi chatingizga yuborildi');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Yuborib bo‘lmadi');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!(await confirmMsg('Shablon butunlay o‘chirilsinmi?'))) return;
    await api.deleteTemplate(id);
    navigate('/', { replace: true });
  }

  useTelegramMainButton({
    text: dirty ? '💾 Saqlash' : '🏁 Guruhga yuborish',
    visible: !loading,
    loading: busy,
    onClick: () => (dirty ? void save() : sendToGroup()),
  });

  if (loading)
    return (
      <Page>
        <PageHeader title="Shablon" back />
        <LoadingList />
      </Page>
    );

  if (!template)
    return (
      <Page>
        <PageHeader title="Shablon" back />
        <ErrorNote>{error ?? 'Topilmadi'}</ErrorNote>
      </Page>
    );

  return (
    <Page className="pb-24">
      <PageHeader
        title={template.title}
        meta={`${template.questions.length} ta savol · savolga ${template.settings.timePerQuestion} s`}
        back
        action={
          <Sheet>
            <SheetTrigger asChild>
              <Button size="icon" variant="secondary" aria-label="Sozlamalar">
                <Settings2 />
              </Button>
            </SheetTrigger>
            <SheetContent title="⚙️ Shablon sozlamalari">
              <div className="space-y-5">
                <div className="space-y-1.5">
                  <Label className="text-[14px] font-semibold text-foreground">📚 Nomi</Label>
                  <Input
                    value={template.title}
                    onChange={(e) => patch({ title: e.target.value })}
                    placeholder="Shablon nomi"
                  />
                </div>
                <SettingsForm
                  settings={template.settings}
                  max={template.questions.length}
                  onChange={(s) => patch({ settings: s })}
                />
                <div className="flex gap-2 border-t border-border pt-4">
                  <Button
                    variant="secondary"
                    className="flex-1"
                    onClick={async () => {
                      const res = await api.duplicateTemplate(id);
                      toast.success('Nusxa yaratildi');
                      navigate(`/template/${res.template.id}`, { replace: true });
                    }}
                  >
                    <Copy /> Nusxa olish
                  </Button>
                  <Button variant="destructive" className="flex-1" onClick={() => void remove()}>
                    <Trash2 /> O‘chirish
                  </Button>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        }
      />

      <Button className="w-full" size="lg" onClick={sendToGroup}>
        <Send /> Guruhga yuborish
      </Button>
      <p className="mt-2 text-center text-[12.5px] leading-relaxed text-muted-foreground">
        Guruhni tanlaysiz → u yerda “Boshlash” tugmasi chiqadi.
        <br />
        A’zolar ro‘yxatdan o‘tmaydi, istalgan savoldan qo‘shilaveradi.
      </p>

      <Sheet>
        <SheetTrigger asChild>
          <Button variant="secondary" className="mt-4 w-full">
            <FileDown /> PDF qilib olish
          </Button>
        </SheetTrigger>
        <SheetContent title="📄 Qaysi ko‘rinishda?">
          <div className="space-y-2">
            {PDF_MODES.map(({ mode, emoji, label, hint }) => (
              <SheetClose asChild key={mode}>
                <button
                  disabled={busy}
                  onClick={() => void sendPdf(mode)}
                  className="flex w-full items-center gap-3 rounded-lg border border-border px-4 py-3 text-left active:scale-[.99] disabled:opacity-50"
                >
                  <span className="text-xl">{emoji}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{label}</span>
                    <span className="block text-[12.5px] text-muted-foreground">{hint}</span>
                  </span>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </button>
              </SheetClose>
            ))}
            <p className="pt-1 text-center text-[12.5px] text-muted-foreground">
              Fayl bot orqali shaxsiy chatingizga keladi
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
                  className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{r.chatTitle || 'Guruh'}</div>
                    <div className="truncate text-[13px] text-muted-foreground">
                      👥 {r.participants.length} kishi
                      {winner ? ` · 🥇 ${winner.firstName}` : ''}
                      {r.finishedAt
                        ? ` · ${new Date(r.finishedAt).toLocaleDateString('uz-UZ')}`
                        : ''}
                    </div>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </Link>
              );
            })}
          </div>
        </>
      )}

      <SectionTitle
        hint={`Variantni bosib to‘g‘ri javobni almashtirsangiz bo‘ladi · ${list.shown}/${list.total}`}
      >
        ❓ Savollar
      </SectionTitle>
      <div className="space-y-2.5">
        {list.visible.map((q, i) => (
          <QuestionEditor
            key={i}
            index={i}
            question={q}
            onChange={(next) => patchQuestion(i, next)}
          />
        ))}
      </div>

      {list.hasMore && (
        <div ref={list.sentinelRef} className="space-y-2.5 pt-2.5">
          <Skeleton className="h-28 w-full" />
          <p className="text-center text-[12.5px] text-muted-foreground">
            {list.shown}/{list.total} ta savol yuklandi…
          </p>
        </div>
      )}

      {dirty && (
        <div className="fixed inset-x-0 bottom-[calc(56px+env(safe-area-inset-bottom,0px))] z-20 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto w-full max-w-lg">
            <Button className="w-full" loading={busy} onClick={() => void save()}>
              💾 O‘zgarishlarni saqlash
            </Button>
          </div>
        </div>
      )}
    </Page>
  );
}
