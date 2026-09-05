import { useMemo, useState } from "react";
import { TextPane } from "@/components/text/TextToolShell";
import { Icon } from "@/components/ui/Icon";
import {
  computeStatistics,
  describeReadability,
  formatDuration,
  READING_WPM,
  SPEAKING_WPM,
} from "@/core/text/stats";
import type { ToolComponentProps } from "../implementations";

/**
 * Compteur de mots et statistiques de texte.
 *
 * Les durées et les indices de lisibilité sont annoncés comme des estimations :
 * ils reposent sur des moyennes (200 mots/min en lecture, 130 à voix haute) et
 * sur une approximation des syllabes. Mieux vaut le dire que laisser croire à
 * une mesure exacte.
 */
export function TextStatisticsTool(_props: ToolComponentProps) {
  const [text, setText] = useState("");
  const stats = useMemo(() => computeStatistics(text), [text]);

  const cells: { label: string; value: string | number }[] = [
    { label: "Mots", value: stats.words },
    { label: "Caractères", value: stats.characters },
    { label: "Sans espaces", value: stats.charactersNoSpaces },
    { label: "Phrases", value: stats.sentences },
    { label: "Paragraphes", value: stats.paragraphs },
    { label: "Lignes", value: stats.lines },
    { label: "Lecture", value: formatDuration(stats.readingSeconds) },
    { label: "À voix haute", value: formatDuration(stats.speakingSeconds) },
  ];

  const details: { label: string; value: string }[] = [
    { label: "Longueur moyenne des mots", value: `${stats.averageWordLength.toFixed(1)} caractères` },
    { label: "Mots par phrase", value: stats.averageSentenceLength.toFixed(1) },
    { label: "Syllabes par mot (estimation)", value: stats.averageSyllables.toFixed(2) },
    {
      label: "Lisibilité française (Kandel & Moles)",
      value: `${stats.readabilityFr} — ${describeReadability(stats.readabilityFr)}`,
    },
    {
      label: "Lisibilité anglaise (Flesch)",
      value: `${stats.readabilityEn} — ${describeReadability(stats.readabilityEn)}`,
    },
  ];

  return (
    <div className="space-y-4">
      <TextPane
        label="Texte à analyser"
        value={text}
        onChange={setText}
        placeholder="Collez votre texte, ou déposez un fichier .txt / .md ici…"
      />

      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
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

      {stats.words > 0 && (
        <div className="rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)] p-3">
          <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[18rem_1fr]">
            {details.map((detail) => (
              <div key={detail.label} className="contents">
                <dt className="text-xs text-[var(--ft-text-muted)]">{detail.label}</dt>
                <dd className="text-xs tabular-nums">{detail.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <p className="flex items-start gap-2 text-xs text-[var(--ft-text-faint)]">
        <Icon name="Info" size={13} className="mt-px shrink-0" />
        Estimations : {READING_WPM} mots/minute en lecture silencieuse, {SPEAKING_WPM} à voix haute.
        Les indices de lisibilité comptent les syllabes par approximation et donnent un ordre de
        grandeur, pas une mesure.
      </p>
    </div>
  );
}
