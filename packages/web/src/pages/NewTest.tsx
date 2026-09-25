import { useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ClipboardPaste, FileUp, Loader2, Type, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError } from '@/api';
import { Page, PageHeader } from '@/components/app';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useTelegramBackButton, useTelegramMainButton } from '@/hooks';
import { hasNativeButtons, haptic, tap } from '@/telegram';

const SAMPLE = `1. O‘zbekiston poytaxti qaysi shahar?
+A) Toshkent
B) Samarqand
C) Buxoro

2. 7 × 8 = ?
A) 54
+B) 56
C) 64`;

/** Tahlilga yuborish uchun eng kam matn uzunligi */
const MIN_LENGTH = 20;

export default function NewTest() {
  // "Namuna bilan sinash" (bosh sahifadan): matn rejimi namuna bilan to'ldirilib ochiladi
  const [params] = useSearchParams();
  const withSample = params.get('sample') === '1';
  const [mode, setMode] = useState<'choose' | 'text'>(withSample ? 'text' : 'choose');
  const [text, setText] = useState(withSample ? SAMPLE : '');
  const [busy, setBusy] = useState<null | { label: string }>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // "Yangi test" — pastki menyudagi bo'lim; orqaga tugmasi faqat matn rejimida kerak
  useTelegramBackButton(() => setMode('choose'), mode === 'text');

  async function run(label: string, fn: () => Promise<{ draft: { id: string } }>) {
    setBusy({ label });
    try {
      const res = await fn();
      haptic('success');
      navigate(`/draft/${res.draft.id}`, { replace: true });
    } catch (err) {
      haptic('error');
      toast.error(err instanceof ApiError ? err.message : 'Tahlil qilib bo‘lmadi');
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const trimmed = text.trim();
  const questionCount = (trimmed.match(/^\s*\d+\s*[.)\]]/gm) ?? []).length;
  const canParse = trimmed.length >= MIN_LENGTH;
  const parseText = () => void run('Savollar ajratilmoqda…', () => api.parseText(text));

  useTelegramMainButton({
    text: busy ? 'Tahlil qilinmoqda…' : '🔍 Tahlil qilish',
    visible: mode === 'text',
    enabled: canParse,
    loading: Boolean(busy),
    onClick: parseText,
  });

  return (
    <Page>
      <PageHeader
        title="Yangi test"
        meta={mode === 'text' ? 'Test matnini joylashtiring' : 'Testni qaysi ko‘rinishda berasiz?'}
        back={mode === 'text'}
      />

      <input
        ref={fileRef}
        type="file"
        accept=".pdf,.docx,.txt,.md,.csv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void run(`“${file.name}” o‘qilmoqda…`, () => api.uploadFile(file));
        }}
      />

      {busy && <BusyOverlay label={busy.label} />}

      {mode === 'choose' ? (
        <>
          <div className="space-y-2.5">
            <Choice
              icon={<FileUp className="size-6" />}
              label="Fayl yuklash"
              hint="PDF yoki Word (.docx) — 20 MB gacha"
              disabled={Boolean(busy)}
              onClick={() => {
                tap();
                fileRef.current?.click();
              }}
            />
            <Choice
              icon={<Type className="size-6" />}
              label="Matnni joylash"
              hint="Testni nusxa ko‘chirib shu yerga qo‘yasiz"
              disabled={Boolean(busy)}
              onClick={() => {
                tap();
                setMode('text');
              }}
            />
          </div>

          <div className="mt-5 flex gap-3 rounded-xl bg-primary/5 p-4">
            <Wand2 className="mt-0.5 size-5 shrink-0 text-primary" />
            <div>
              <p className="font-semibold">Keyin nima bo‘ladi?</p>
              <p className="mt-0.5 text-[13.5px] leading-relaxed text-muted-foreground">
                Savol, variant va to‘g‘ri javoblarni o‘zim ajrataman. Siz ko‘rib chiqasiz — javobi
                topilmaganlari sariq bo‘lib turadi, bir bosishda belgilaysiz.
              </p>
            </div>
          </div>

          <FormatHelp />
        </>
      ) : (
        <div className="space-y-3">
          <Textarea
            autoFocus
            value={text}
            placeholder={SAMPLE}
            className="min-h-[44vh] rounded-xl bg-card font-mono text-[14px] leading-relaxed"
            onChange={(e) => setText(e.target.value)}
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-[12.5px] text-muted-foreground">
              {!canParse
                ? '✍️ Kamida bitta savol va variantlarini qo‘ying'
                : questionCount > 0
                  ? `✓ Taxminan ${questionCount} ta savol`
                  : `✓ ${trimmed.split('\n').filter(Boolean).length} qator`}
            </p>
            {!trimmed && (
              <Button
                variant="tonal"
                size="sm"
                onClick={() => {
                  tap();
                  setText(SAMPLE);
                }}
              >
                <ClipboardPaste /> Namunani qo‘yish
              </Button>
            )}
          </div>

          {/* Telegram ichida bu vazifani pastdagi MainButton bajaradi */}
          {!hasNativeButtons && (
            <Button className="w-full" size="lg" loading={Boolean(busy)} disabled={!canParse} onClick={parseText}>
              🔍 Tahlil qilish
            </Button>
          )}

          <FormatHelp />
        </div>
      )}
    </Page>
  );
}

/** Tahlil vaqtida butun ekranni yopib turuvchi holat — ikki marta bosilmasin */
function BusyOverlay({ label }: { label: string }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-background/80 p-6 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-xs rounded-2xl border border-border bg-card p-6 text-center shadow-lg">
        <Loader2 className="mx-auto size-8 animate-spin text-primary" />
        <p className="mt-3 truncate font-semibold">{label}</p>
        <p className="mt-1 text-[13px] text-muted-foreground">Katta fayllarda bir necha soniya oladi</p>
      </div>
    </div>
  );
}

function FormatHelp() {
  return (
    <details className="group mt-4 rounded-xl border border-border bg-card p-4 [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex cursor-pointer list-none items-center justify-between font-semibold">
        📋 Format qanday bo‘lsin?
        <span className="text-[13px] font-medium text-primary group-open:hidden">Ko‘rish</span>
        <span className="hidden text-[13px] font-medium text-primary group-open:inline">Yopish</span>
      </summary>
      <div className="mt-3 space-y-2 text-[13.5px] leading-relaxed text-muted-foreground">
        <p>
          To‘g‘ri javob oldiga <b className="text-foreground">+</b> qo‘ying:
        </p>
        <pre className="overflow-x-auto rounded-[12px] bg-muted p-3 text-[13px] leading-relaxed text-foreground">
{`1. Savol matni?
+A) To‘g‘ri javob
B) Boshqa variant`}
        </pre>
        <p>
          ➕ Yoki oxirida kalit bering: <b className="text-foreground">1-A, 2-C, 3-B</b>
        </p>
        <p>➕ Word faylda to‘g‘ri javob qalin (bold) bo‘lsa ham tanib olaman.</p>
        <p>⚠️ Skaner qilingan (rasm) PDF ishlamaydi — ichida matn bo‘lishi kerak.</p>
      </div>
    </details>
  );
}

function Choice({
  icon,
  label,
  hint,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-4 rounded-xl border border-border bg-card p-4 text-left transition-transform active:scale-[.99] disabled:opacity-50"
    >
      <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] font-bold">{label}</span>
        <span className="block text-[13px] leading-snug text-muted-foreground">{hint}</span>
      </span>
    </button>
  );
}
