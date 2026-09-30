import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Copy, Download, Link2, Send } from 'lucide-react';
import { toast } from 'sonner';
import {
  formatTimeLimit,
  normalizeShareCode,
  SHARE_CODE_LENGTH,
  type SharedTemplatePreviewDTO,
  type TemplateDTO,
} from '@testrace/shared';
import { api, ApiError } from '@/api';
import { IconTile } from '@/components/app';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { confirmMsg, copyText, haptic, openTelegramLink, tap } from '@/telegram';

function botLink(botUsername: string | null, code: string): string | null {
  return botUsername ? `https://t.me/${botUsername}?start=copy_${code}` : null;
}

/**
 * Shablonni ulashish: noyob kod yaratish, nusxalash, Telegramda yuborish.
 * Kodni olgan odam shablonning mustaqil nusxasini oladi.
 */
export function ShareTemplateSheet({
  template,
  botUsername,
  onCodeChange,
}: {
  template: TemplateDTO;
  botUsername: string | null;
  onCodeChange: (code: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const code = template.shareCode ?? null;
  const link = code ? botLink(botUsername, code) : null;

  async function create() {
    setBusy(true);
    try {
      const res = await api.shareTemplate(template.id);
      onCodeChange(res.code);
      haptic('success');
    } catch (err) {
      haptic('error');
      toast.error(err instanceof ApiError ? err.message : 'Kod yaratib bo‘lmadi');
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!(await confirmMsg('Kod o‘chirilsinmi? Yangi odamlar nusxa ola olmaydi, olinganlari esa ularda qoladi.'))) return;
    setBusy(true);
    try {
      await api.unshareTemplate(template.id);
      onCodeChange(null);
      toast.success('Ulashish to‘xtatildi');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'O‘chirib bo‘lmadi');
    } finally {
      setBusy(false);
    }
  }

  async function copy(value: string, what: string) {
    tap();
    if (await copyText(value)) toast.success(`${what} nusxalandi`);
    else toast.error('Nusxalab bo‘lmadi — qo‘lda belgilab oling');
  }

  function sendInTelegram() {
    if (!code) return;
    tap();
    const text = `📚 «${template.title}» testini oling — kod: ${code}`;
    openTelegramLink(
      link
        ? `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`
        : `https://t.me/share/url?url=${encodeURIComponent(text)}`,
    );
  }

  return (
    <Sheet>
      <SheetTrigger asChild>
        <button
          onClick={tap}
          className="mt-2.5 flex w-full items-center gap-3 rounded-xl border border-border bg-card px-3 py-3 text-left active:scale-[.99]"
        >
          <IconTile emoji="🔗" tone="muted" />
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">Ulashish</span>
            <span className="block text-[12.5px] text-muted-foreground">
              {code ? `Kod: ${code}` : 'Boshqalar kod orqali nusxa oladi'}
            </span>
          </span>
          <ChevronRight className="size-4 text-muted-foreground" />
        </button>
      </SheetTrigger>
      <SheetContent title="🔗 Shablonni ulashish">
        {code ? (
          <div className="space-y-3">
            <button
              onClick={() => void copy(code, 'Kod')}
              className="w-full rounded-xl border border-border bg-card py-5 text-center active:scale-[.99]"
            >
              <span className="block font-mono text-[32px] font-extrabold tracking-[0.3em]">{code}</span>
              <span className="mt-1 block text-[12.5px] text-muted-foreground">bosing — nusxalanadi</span>
            </button>
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => void copy(link ?? code, link ? 'Havola' : 'Kod')}>
                <Copy /> {link ? 'Havolani' : 'Kodni'} nusxalash
              </Button>
              <Button className="flex-1" onClick={sendInTelegram}>
                <Send /> Yuborish
              </Button>
            </div>
            <p className="rounded-[12px] bg-muted px-3 py-2 text-[13px] leading-relaxed text-muted-foreground">
              Kodni olgan odam uni botga yuboradi yoki panelda «Kod orqali qo‘shish»ga yozadi. Shablonning{' '}
              <b className="text-foreground">nusxasi</b> uning ro‘yxatiga tushadi va u o‘zi admin bo‘lgan
              guruhlarda ishlata oladi. Siz shablonni o‘zgartirsangiz yoki o‘chirsangiz ham, olingan nusxalar
              egalarida qoladi.
            </p>
            <Button variant="ghost" className="w-full text-destructive" disabled={busy} onClick={() => void revoke()}>
              Ulashishni to‘xtatish
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-[14px] leading-relaxed text-muted-foreground">
              Shablon uchun {SHARE_CODE_LENGTH} belgili noyob kod yaratiladi. Kodni olgan odam shablonning
              mustaqil nusxasini oladi va uni o‘z guruhlarida ishlatadi. Asl shablon sizda qoladi.
            </p>
            <Button className="w-full" size="lg" loading={busy} onClick={() => void create()}>
              <Link2 /> Kod yaratish
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Bosh sahifa: boshqa foydalanuvchi bergan kod bo'yicha shablon nusxasini olish */
export function ImportByCodeSheet() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [preview, setPreview] = useState<SharedTemplatePreviewDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const code = normalizeShareCode(input);

  // To'liq kod yozilishi bilan shablonni ko'rsatamiz
  useEffect(() => {
    setPreview(null);
    setError(null);
    if (!code) return;
    let cancelled = false;
    setLoading(true);
    api
      .sharedPreview(code)
      .then((res) => !cancelled && setPreview(res.preview))
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : 'Tekshirib bo‘lmadi'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [code]);

  async function importIt() {
    if (!code) return;
    setBusy(true);
    try {
      const res = await api.importTemplate(code);
      haptic('success');
      toast.success(res.already ? 'Bu shablon ro‘yxatingizda bor' : 'Shablon ro‘yxatingizga qo‘shildi 🎉');
      setOpen(false);
      navigate(`/template/${res.template.id}`);
    } catch (err) {
      haptic('error');
      toast.error(err instanceof ApiError ? err.message : 'Nusxa olib bo‘lmadi');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setInput('');
      }}
    >
      <SheetTrigger asChild>
        <button
          onClick={tap}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card px-3 py-3 text-[14.5px] font-semibold text-primary active:scale-[.99]"
        >
          <Download className="size-4" /> Kod orqali shablon qo‘shish
        </button>
      </SheetTrigger>
      <SheetContent title="📥 Kod orqali qo‘shish">
        <div className="space-y-3">
          <p className="text-[13.5px] text-muted-foreground">Shablon egasi bergan kodni yozing:</p>
          <Input
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value.toUpperCase())}
            placeholder="K7M2QX"
            maxLength={SHARE_CODE_LENGTH + 2}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            className="h-14 rounded-[12px] text-center font-mono text-[24px] font-bold tracking-[0.3em]"
          />

          {loading && <p className="text-center text-[13px] text-muted-foreground">Tekshirilmoqda…</p>}
          {error && <p className="text-center text-[13px] font-semibold text-destructive">⚠️ {error}</p>}

          {preview && (
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="font-bold">{preview.title}</div>
              <div className="mt-1 text-[13px] text-muted-foreground">
                ❓ {preview.questions} ta savol · ⏱ {formatTimeLimit(preview.timePerQuestion)} · 👤 {preview.ownerName}
              </div>
              {preview.isOwn ? (
                <p className="mt-3 text-[13px] text-muted-foreground">Bu o‘zingizning shablongiz.</p>
              ) : preview.alreadyCopiedId ? (
                <Button
                  variant="secondary"
                  className="mt-3 w-full"
                  onClick={() => {
                    setOpen(false);
                    navigate(`/template/${preview.alreadyCopiedId}`);
                  }}
                >
                  Ro‘yxatingizda bor — ochish
                </Button>
              ) : (
                <Button className="mt-3 w-full" loading={busy} onClick={() => void importIt()}>
                  <Download /> Ro‘yxatimga qo‘shish
                </Button>
              )}
            </div>
          )}

          <p className="text-center text-[12px] text-muted-foreground">
            Nusxa sizniki bo‘ladi: egasi o‘chirsa ham qoladi, o‘zingiz admin bo‘lgan guruhlarda ishlatasiz.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
