import { useState } from 'react';
import { Check, Lightbulb, Pencil, Plus, Trash2, X } from 'lucide-react';
import { optionLabel, type Question } from '@testrace/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cleanQuestion, isQuestionReady, MAX_OPTIONS } from '@/lib/questions';
import { cn } from '@/lib/utils';
import { selectionTap, tap } from '@/telegram';

/**
 * Bitta savolni ko'rsatish va tahrirlash.
 * Ko'rish rejimida variantni bosish = to'g'ri javobni belgilash.
 * ✏️ tugmasi — savol va variantlar matnini tahrirlash rejimi.
 */
export function QuestionEditor({
  index,
  question,
  onChange,
  onDelete,
}: {
  index: number;
  question: Question;
  onChange: (q: Question) => void;
  onDelete?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editingNote, setEditingNote] = useState(false);
  const needsAnswer = !isQuestionReady(question);

  function finishEditing() {
    tap();
    onChange(cleanQuestion(question));
    setEditing(false);
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
          {onDelete && (
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
        <EditForm question={question} onChange={onChange} onDone={finishEditing} />
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

/** Savol va variantlar matnini tahrirlash */
function EditForm({
  question,
  onChange,
  onDone,
}: {
  question: Question;
  onChange: (q: Question) => void;
  onDone: () => void;
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

      <p className="text-[12.5px] text-muted-foreground">
        Harfni bosib to‘g‘ri javobni belgilang. Bo‘sh variantlar saqlanmaydi.
      </p>

      <div className="flex gap-2">
        {question.options.length < MAX_OPTIONS && (
          <Button variant="secondary" size="sm" className="flex-1" onClick={addOption}>
            <Plus /> Variant qo‘shish
          </Button>
        )}
        <Button size="sm" className="flex-1" onClick={onDone}>
          <Check /> Tayyor
        </Button>
      </div>
    </div>
  );
}
