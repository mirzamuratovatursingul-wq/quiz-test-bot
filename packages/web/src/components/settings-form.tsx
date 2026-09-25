import { Minus, Plus } from 'lucide-react';
import type { TemplateDTO } from '@testrace/shared';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { selectionTap } from '@/telegram';

export type Settings = TemplateDTO['settings'];

export const DEFAULT_SETTINGS: Settings = {
  timePerQuestion: 15,
  shuffleQuestions: true,
  shuffleOptions: true,
  questionLimit: 0,
  speedBonus: true,
};

const TIME_PRESETS = [10, 15, 20, 30, 45, 60];
const LIMIT_PRESETS = [10, 15, 20, 30, 50];

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** Musobaqa sozlamalari: qoralamada ham, shablonda ham bir xil */
export function SettingsForm({
  settings,
  onChange,
  max,
}: {
  settings: Settings;
  onChange: (s: Settings) => void;
  max: number;
}) {
  const set = (patch: Partial<Settings>) => {
    selectionTap();
    onChange({ ...settings, ...patch });
  };
  const limits = LIMIT_PRESETS.filter((n) => n < max);
  const time = settings.timePerQuestion;
  const limit = settings.questionLimit;
  const perRace = limit > 0 && limit < max ? limit : max;
  const totalSec = perRace * (time + 2);

  return (
    <div className="space-y-6">
      <Field label="⏱ Har bir savolga vaqt" hint="Guruhda so‘rovnoma shuncha soniya ochiq turadi">
        <Chips
          items={TIME_PRESETS.map((n) => ({ value: n, label: `${n} s` }))}
          value={time}
          onSelect={(n) => set({ timePerQuestion: n })}
        />
        <Stepper
          value={time}
          suffix="soniya"
          onChange={(n) => set({ timePerQuestion: clamp(n, 5, 120) })}
          step={5}
          min={5}
          max={120}
        />
      </Field>

      <Field label="🔢 Musobaqadagi savollar soni" hint={`Jami ${max} ta savol bor`}>
        <Chips
          items={[{ value: 0, label: 'Hammasi' }, ...limits.map((n) => ({ value: n, label: String(n) }))]}
          value={limit >= max ? 0 : limit}
          onSelect={(n) => set({ questionLimit: n })}
        />
      </Field>

      <p className="rounded-[12px] bg-muted px-3 py-2 text-[13px] text-muted-foreground">
        ⌛ Musobaqa taxminan <b className="text-foreground">{formatDuration(totalSec)}</b> davom etadi
        ({perRace} savol).
      </p>

      <div className="space-y-4 border-t border-border pt-5">
        <Toggle
          label="🔀 Savollarni aralashtirish"
          hint="Har musobaqada tartib boshqacha bo‘ladi"
          checked={settings.shuffleQuestions}
          onChange={(v) => set({ shuffleQuestions: v })}
        />
        <Toggle
          label="🔁 Variantlarni aralashtirish"
          hint="Javob o‘rnini yodlab olishning oldini oladi"
          checked={settings.shuffleOptions}
          onChange={(v) => set({ shuffleOptions: v })}
        />
        <Toggle
          label="⚡ Tezlik bonusi"
          hint="Tez javob bergan ko‘proq ball oladi (100 + 100 gacha)"
          checked={settings.speedBonus}
          onChange={(v) => set({ speedBonus: v })}
        />
      </div>
    </div>
  );
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec} soniya`;
  const min = Math.round(sec / 60);
  return `${min} daqiqa`;
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
    <div className="space-y-2">
      <div>
        <div className="text-[14.5px] font-bold">{label}</div>
        {hint && <p className="text-[12.5px] text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function Chips({
  items,
  value,
  onSelect,
}: {
  items: { value: number; label: string }[];
  value: number;
  onSelect: (v: number) => void;
}) {
  return (
    <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
      {items.map((it) => (
        <button
          key={it.value}
          onClick={() => onSelect(it.value)}
          className={cn(
            'h-9 shrink-0 rounded-full border px-4 text-[14px] font-semibold transition-colors',
            it.value === value
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-card text-foreground',
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

function Stepper({
  value,
  onChange,
  step,
  min,
  max,
  suffix,
}: {
  value: number;
  onChange: (v: number) => void;
  step: number;
  min: number;
  max: number;
  suffix: string;
}) {
  const btn =
    'flex size-10 items-center justify-center rounded-full bg-card text-foreground active:scale-95 disabled:opacity-40';
  return (
    <div className="flex items-center justify-between rounded-[12px] border border-border px-2 py-1.5">
      <button className={btn} disabled={value <= min} onClick={() => onChange(value - step)} aria-label="Kamaytirish">
        <Minus className="size-4" />
      </button>
      <span className="text-[15px] font-bold tabular-nums">
        {value} <span className="font-medium text-muted-foreground">{suffix}</span>
      </span>
      <button className={btn} disabled={value >= max} onClick={() => onChange(value + step)} aria-label="Ko‘paytirish">
        <Plus className="size-4" />
      </button>
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
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="text-[14.5px] font-semibold">{label}</div>
        {hint && <div className="text-[12.5px] leading-snug text-muted-foreground">{hint}</div>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} className="mt-1 shrink-0" />
    </label>
  );
}
