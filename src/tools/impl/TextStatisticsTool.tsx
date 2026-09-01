import { useMemo, useState } from "react";
import type { ToolComponentProps } from "../implementations";
import { computeTextStatistics } from "../logic/textStatistics";

export function TextStatisticsTool(_props: ToolComponentProps) {
  const [text, setText] = useState("");
  const stats = useMemo(() => computeTextStatistics(text), [text]);

  const cells: { label: string; value: string | number }[] = [
    { label: "Mots", value: stats.words },
    { label: "Caractères", value: stats.characters },
    { label: "Sans espaces", value: stats.charactersNoSpaces },
    { label: "Phrases", value: stats.sentences },
    { label: "Paragraphes", value: stats.paragraphs },
    { label: "Lignes", value: stats.lines },
    { label: "Temps de lecture", value: stats.readingTime },
  ];

  return (
    <div className="space-y-3">
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Collez ou saisissez votre texte…"
        aria-label="Texte à analyser"
        className="min-h-56 w-full resize-y rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)] p-3 font-mono text-sm outline-none focus:border-[var(--ft-accent)]"
      />
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-7">
        {cells.map((cell) => (
          <div
            key={cell.label}
            className="rounded-md border border-[var(--ft-border)] bg-[var(--ft-surface)] px-2.5 py-2"
          >
            <p className="text-lg font-semibold tabular-nums leading-6">{cell.value}</p>
            <p className="text-[11px] text-[var(--ft-text-muted)]">{cell.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
