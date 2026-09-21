import { useState } from 'react';
import { Check, Lightbulb, Trash2 } from 'lucide-react';
import { optionLabel, type Question } from '@testrace/shared';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { selectionTap } from '@/telegram';

/**
 * Bitta savolni ko'rsatish va tahrirlash.
 * Qoralamada ham, shablonda ham shu komponent ishlatiladi.
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
  const [editingText, setEditingText] = useState(false);
  const [editingNote, setEditingNote] = useState(false);
  const needsAnswer = question.correctIndex < 0 || question.options.length < 2;

  return (
    <div
      className={`rounded-lg border bg-card p-4 ${
        needsAnswer ? 'border-[color:var(--warning)]' : 'border-border'
      }`}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[13px] font-semibold text-muted-foreground">{index + 1}-savol</span>
        <div className="flex items-center gap-2">
          {needsAnswer && <Badge variant="warning">javobni belgilang</Badge>}
          {onDelete && (
            <button onClick={onDelete} className="p-1 text-muted-foreground" aria-label="O‘chirish">
              <Trash2 className="size-4" />
            </button>
          )}
        </div>
      </div>

      {editingText ? (
        <Textarea
          autoFocus
          value={question.text}
          onBlur={() => setEditingText(false)}
          onChange={(e) => onChange({ ...question, text: e.target.value })}
          className="mb-3 min-h-[76px] text-[17px] font-bold leading-snug"
        />
      ) : (
        <p
          className="mb-3 text-[17px] font-bold leading-snug"
          onClick={() => setEditingText(true)}
          title="Tahrirlash uchun bosing"
        >
          {question.text}
        </p>
      )}

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
              className={`flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left text-[15px] ${
                correct
                  ? 'border-[color:var(--success)] bg-[color:var(--success)]/10 font-semibold'
                  : 'border-border'
              }`}
            >
              <span
                className={`flex size-7 shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${
                  correct ? 'bg-[color:var(--success)] text-white' : 'bg-muted text-muted-foreground'
                }`}
              >
                {correct ? <Check className="size-4" /> : optionLabel(oi)}
              </span>
              <span className="min-w-0 flex-1">{o.text}</span>
            </button>
          );
        })}
      </div>

      {/* Izoh — musobaqada xato javob berganga ko'rsatiladi */}
      {editingNote ? (
        <Textarea
          autoFocus
          value={question.explanation ?? ''}
          placeholder="Nega shu javob to‘g‘ri? (musobaqada xato javob berganga ko‘rsatiladi)"
          maxLength={180}
          onBlur={() => setEditingNote(false)}
          onChange={(e) => onChange({ ...question, explanation: e.target.value })}
          className="mt-3 min-h-[64px] text-[14px]"
        />
      ) : question.explanation?.trim() ? (
        <button
          onClick={() => setEditingNote(true)}
          className="mt-3 flex w-full items-start gap-2 rounded-md bg-muted px-3 py-2 text-left text-[13.5px] leading-snug text-muted-foreground"
        >
          <Lightbulb className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0 flex-1">{question.explanation}</span>
        </button>
      ) : (
        <button
          onClick={() => setEditingNote(true)}
          className="mt-3 flex items-center gap-1.5 text-[13px] text-muted-foreground"
        >
          <Lightbulb className="size-3.5" /> Izoh qo‘shish
        </button>
      )}
    </div>
  );
}
