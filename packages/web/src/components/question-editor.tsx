import { useState } from 'react';
import { Check, Lightbulb, Pencil, Plus, Trash2, X } from 'lucide-react';
import { optionLabel, type Question } from '@testrace/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cleanQuestion, isQuestionReady, MAX_OPTIONS, newQuestionProblem } from '@/lib/questions';
import { cn } from '@/lib/utils';
import { haptic, selectionTap, tap } from '@/telegram';

/**
 * Bitta savolni ko'rsatish va tahrirlash.
 * Ko'rish rejimida variantni bosish = to'g'ri javobni belgilash.
 * ✏️ tugmasi — savol va variantlar matnini tahrirlash rejimi.
 *
 * `isNew` — ro'yxat oxiriga qo'shilgan yangi savol: darhol tahrirlash rejimida ochiladi,
 * matn, 2 ta variant va to'g'ri javob bo'lmaguncha "Tayyor" yopmaydi;
 * "Bekor qilish" (yoki bo'sh holda "Tayyor") savolni olib tashlaydi.
 */
export function QuestionEditor({
  index,
  question,
  onChange,
  onDelete,
  isNew = false,
  onCreated,
  onDiscard,
}: {
  index: number;
  question: Question;
  onChange: (q: Question) => void;
  onDelete?: () => void;
  isNew?: boolean;
  onCreated?: () => void;
  onDiscard?: () => void;
}) {
  const [editing, setEditing] = useState(isNew);
  const [editingNote, setEditingNote] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const needsAnswer = !isQuestionReady(question);

  function finishEditing() {
    const cleaned = cleanQuestion(question);
    if (isNew) {
      if (!cleaned.text && cleaned.options.length === 0) {
        onDiscard?.();
        return;
      }
      const missing = newQuestionProblem(cleaned);
      if (missing) {
        haptic('error');
        setProblem(missing);
        return;
      }
    }
    tap();
    setProblem(null);
    onChange(cleaned);
    setEditing(false);
    if (isNew) onCreated?.();
  }

  return (
    <div
      className={cn(
        'rounded-xl border bg-card p-4 transition-colors',
        needsAnswer ? 'border-warning bg-warning/5' : 'border-border',
        editing && 'border-primary',
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded-full bg-background px-2 py-0.5 text-[12px] font-bold tabular-nums text-muted-foreground">
          {index + 1}-savol
        </span>
        {isNew && editing && <Badge>yangi</Badge>}
        {needsAnswer && !editing && <Badge variant="warning">javobni belgilang</Badge>}
        <div className="ml-auto flex items-center">
          {!editing && (
            <button
              onClick={() => {
                tap();
                setEditing(true);
              }}
              className="flex size-8 items-center justify-center rounded-full text-muted-foreground active:bg-muted"
              aria-label="Tahrirlash"
            >
              <Pencil className="size-4" />
            </button>
          )}
          {onDelete && !(isNew && editing) && (
            <button
              onClick={onDelete}
              className="flex size-8 items-center justify-center rounded-full text-muted-foreground active:bg-muted"
              aria-label="Savolni o‘chirish"
            >
              <Trash2 className="size-4" />
            </button>
          )}
        </div>
      </div>

      {editing ? (
        <EditForm
          question={question}
          onChange={(q) => {
            setProblem(null);
            onChange(q);
          }}
          onDone={finishEditing}
          onCancel={isNew ? onDiscard : undefined}
          problem={problem}
          doneLabel={isNew ? 'Savolni qo‘shish' : 'Tayyor'}
        />
      ) : (
        <>
          <p
            className="mb-3 whitespace-pre-line text-[16.5px] font-bold leading-snug"
            onClick={() => setEditing(true)}
          >
            {question.text}
          </p>

          <div className="space-y-2">
            {question.options.map((o, oi) => {
              const correct = oi === question.correctIndex;
              return (
                <button
                  key={oi}
                  onClick={() => {
                    selectionTap();
                    onChange({ ...question, correctIndex: oi });
                  }}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-[12px] border px-3 py-2.5 text-left text-[15px] transition-colors active:scale-[.99]',
                    correct
                      ? 'border-success bg-success/10 font-semibold'
                      : 'border-border bg-background',
                  )}
                >
                  <span
                    className={cn(
                      'flex size-7 shrink-0 items-center justify-center rounded-full text-[12px] font-bold',
                      correct ? 'bg-success text-white' : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {correct ? <Check className="size-4" /> : optionLabel(oi)}
                  </span>
                  <span className="min-w-0 flex-1">{o.text}</span>
                </button>
              );
            })}
          </div>

          {needsAnswer && (
            <p className="mt-2 text-[12.5px] text-warning-foreground">
              {question.options.length < 2
                ? '✏️ Kamida 2 ta variant kerak — tahrirlash tugmasini bosing'
                : '👆 To‘g‘ri variantni bosib belgilang'}
            </p>
          )}
        </>
      )}

      {/* Izoh — musobaqada xato javob berganga ko'rsatiladi */}
      {editingNote ? (
        <div className="mt-3">
          <Textarea
            autoFocus
            value={question.explanation ?? ''}
            placeholder="Nega shu javob to‘g‘ri? Qisqa yozing."
            maxLength={180}
            onBlur={() => setEditingNote(false)}
            onChange={(e) => onChange({ ...question, explanation: e.target.value })}
            className="min-h-[64px] text-[14px]"
          />
          <p className="mt-1 flex justify-between text-[12px] text-muted-foreground">
            <span>Musobaqada xato javob berganga chiqadi</span>
            <span className="tabular-nums">{(question.explanation ?? '').length}/180</span>
          </p>
        </div>
      ) : question.explanation?.trim() ? (
        <button
          onClick={() => setEditingNote(true)}
          className="mt-3 flex w-full items-start gap-2 rounded-[12px] bg-primary/5 px-3 py-2 text-left text-[13.5px] leading-snug text-muted-foreground"
        >
          <Lightbulb className="mt-0.5 size-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1">{question.explanation}</span>
        </button>
      ) : (
        !editing && (
          <button
            onClick={() => setEditingNote(true)}
            className="mt-3 flex items-center gap-1.5 rounded-full px-1 text-[13px] font-medium text-primary"
          >
            <Lightbulb className="size-3.5" /> Izoh qo‘shish
          </button>
        )
      )}
    </div>
  );
}

/** Ro'yxat oxiridagi "Yangi savol qo'shish" tugmasi */
export function AddQuestionButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card px-3 py-3.5 text-[15px] font-semibold text-primary active:scale-[.99]"
    >
      <Plus className="size-4" /> Yangi savol qo‘shish
    </button>
  );
}

/** Savol va variantlar matnini tahrirlash */
function EditForm({
  question,
  onChange,
  onDone,
  onCancel,
  problem,
  doneLabel,
}: {
  question: Question;
  onChange: (q: Question) => void;
  onDone: () => void;
  onCancel?: () => void;
  problem?: string | null;
  doneLabel: string;
}) {
  function setOption(i: number, text: string) {
    onChange({
      ...question,
      options: question.options.map((o, oi) => (oi === i ? { text } : o)),
    });
  }

  function removeOption(i: number) {
    tap();
    const options = question.options.filter((_, oi) => oi !== i);
    let correctIndex = question.correctIndex;
    if (i === correctIndex) correctIndex = -1;
    else if (i < correctIndex) correctIndex -= 1;
    onChange({ ...question, options, correctIndex });
  }

  function addOption() {
    tap();
    onChange({ ...question, options: [...question.options, { text: '' }] });
  }

  return (
    <div className="space-y-3">
      <Textarea
        autoFocus
        value={question.text}
        placeholder="Savol matni"
        onChange={(e) => onChange({ ...question, text: e.target.value })}
        className="min-h-[76px] text-[16px] font-semibold leading-snug"
      />

      <div className="space-y-2">
        {question.options.map((o, oi) => {
          const correct = oi === question.correctIndex;
          return (
            <div key={oi} className="flex items-center gap-2">
              <button
                onClick={() => {
                  selectionTap();
                  onChange({ ...question, correctIndex: oi });
                }}
                className={cn(
                  'flex size-9 shrink-0 items-center justify-center rounded-full text-[13px] font-bold',
                  correct ? 'bg-success text-white' : 'bg-muted text-muted-foreground',
                )}
                aria-label={`${optionLabel(oi)} to‘g‘ri javob`}
              >
                {correct ? <Check className="size-4" /> : optionLabel(oi)}
              </button>
              <Input
                value={o.text}
                placeholder={`${optionLabel(oi)} variant`}
                onChange={(e) => setOption(oi, e.target.value)}
                className={cn(correct && 'border-success')}
              />
              {question.options.length > 2 && (
                <button
                  onClick={() => removeOption(oi)}
                  className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground active:bg-muted"
                  aria-label="Variantni o‘chirish"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {problem ? (
        <p className="text-[12.5px] font-semibold text-destructive">⚠️ {problem}</p>
      ) : (
        <p className="text-[12.5px] text-muted-foreground">
          Harfni bosib to‘g‘ri javobni belgilang. Bo‘sh variantlar saqlanmaydi.
        </p>
      )}

      {question.options.length < MAX_OPTIONS && (
        <Button variant="secondary" size="sm" className="w-full" onClick={addOption}>
          <Plus /> Variant qo‘shish
        </Button>
      )}
      <div className="flex gap-2">
        {onCancel && (
          <Button
            variant="ghost"
            size="sm"
            className="flex-1"
            onClick={() => {
              tap();
              onCancel();
            }}
          >
            <X /> Bekor qilish
          </Button>
        )}
        <Button size="sm" className="flex-1" onClick={onDone}>
          <Check /> {doneLabel}
        </Button>
      </div>
    </div>
  );
}
