import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileUp, Sparkles, Type } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError } from '@/api';
import { Page, PageHeader } from '@/components/app';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useTelegramBackButton, useTelegramMainButton } from '@/hooks';
import { haptic, tap } from '@/telegram';

const SAMPLE = `1. O‘zbekiston poytaxti qaysi shahar?
+A) Toshkent
B) Samarqand
C) Buxoro

2. 7 × 8 = ?
A) 54
+B) 56
C) 64`;

export default function NewTest() {
  const [mode, setMode] = useState<'choose' | 'text'>('choose');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useTelegramBackButton(() => (mode === 'text' ? setMode('choose') : navigate(-1)));

  async function run(fn: () => Promise<{ draft: { id: string } }>) {
    setBusy(true);
    try {
      const res = await fn();
      haptic('success');
      navigate(`/draft/${res.draft.id}`, { replace: true });
    } catch (err) {
      haptic('error');
      toast.error(err instanceof ApiError ? err.message : 'Tahlil qilib bo‘lmadi');
    } finally {
      setBusy(false);
    }
  }

  useTelegramMainButton({
    text: busy ? 'Tahlil qilinmoqda…' : '🔍 Tahlil qilish',
    visible: mode === 'text',
    enabled: text.trim().length >= 20,
    loading: busy,
    onClick: () => void run(() => api.parseText(text)),
  });

  return (
    <Page>
      <PageHeader
        title="Yangi test"
        meta={mode === 'text' ? 'Test matnini joylashtiring' : 'Qaysi ko‘rinishda beryapsiz?'}
        back
      />

      <input
        ref={fileRef}
        type="file"
        accept=".pdf,.docx,.txt,.md,.csv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void run(() => api.uploadFile(file));
        }}
      />

      {mode === 'choose' ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Choice
              icon={<FileUp className="size-6" />}
              label="Fayl yuklash"
              hint="PDF yoki Word (.docx)"
              disabled={busy}
              onClick={() => {
                tap();
                fileRef.current?.click();
              }}
            />
            <Choice
              icon={<Type className="size-6" />}
              label="Matn joylash"
              hint="Nusxa ko‘chirib qo‘yasiz"
              disabled={busy}
              onClick={() => {
                tap();
                setMode('text');
              }}
            />
          </div>

          {busy && (
            <p className="pt-5 text-center text-[13.5px] text-muted-foreground">
              ⏳ Fayl o‘qilmoqda va savollar ajratilmoqda…
            </p>
          )}

          <div className="mt-5 rounded-lg border border-border bg-card p-4">
            <p className="mb-1 flex items-center gap-2 font-semibold">
              <Sparkles className="size-4 text-primary" /> Nima bo‘ladi keyin?
            </p>
            <p className="text-[13.5px] leading-relaxed text-muted-foreground">
              Savol, variant va to‘g‘ri javoblarni o‘zim ajratib olaman. Keyin ularni ko‘rib
              chiqasiz — javobi topilmaganlari sariq bo‘lib turadi, bir bosishda belgilaysiz.
            </p>
          </div>

          <FormatHelp />
        </>
      ) : (
        <div className="space-y-3">
          <Textarea
            autoFocus
            value={text}
            placeholder={SAMPLE}
            className="min-h-[44vh] leading-relaxed"
            onChange={(e) => setText(e.target.value)}
          />
          <p className="text-[12.5px] text-muted-foreground">
            {text.trim().length < 20
              ? '✍️ Test matnini qo‘ying — kamida bitta savol va variantlar.'
              : `✓ ${text.trim().split('\n').filter(Boolean).length} qator kiritildi`}
          </p>

          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setMode('choose')}>
              Orqaga
            </Button>
            <Button
              className="flex-1"
              loading={busy}
              disabled={text.trim().length < 20}
              onClick={() => void run(() => api.parseText(text))}
            >
              🔍 Tahlil qilish
            </Button>
          </div>

          <FormatHelp />
        </div>
      )}
    </Page>
  );
}

function FormatHelp() {
  return (
    <div className="mt-3 rounded-lg border border-border bg-card p-4">
      <p className="mb-2 font-semibold">📋 Format qanday bo‘lsin?</p>
      <div className="space-y-2 text-[13.5px] leading-relaxed text-muted-foreground">
        <p>
          To‘g‘ri javob oldiga <b className="text-foreground">+</b> qo‘ying:
        </p>
        <pre className="overflow-x-auto rounded-md bg-muted p-3 text-[13px] leading-relaxed text-foreground">
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
    </div>
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
      className="flex flex-col items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 py-6 text-center active:scale-[.98] disabled:opacity-50"
    >
      <span className="flex size-12 items-center justify-center rounded-xl bg-muted text-primary">
        {icon}
      </span>
      <span className="font-semibold">{label}</span>
      <span className="text-[12.5px] leading-tight text-muted-foreground">{hint}</span>
    </button>
  );
}
