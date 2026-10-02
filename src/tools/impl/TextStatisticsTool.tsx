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
import { t, tx } from "@/i18n";

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
    { label: t("Mots"), value: stats.words },
    { label: t("Caractères"), value: stats.characters },
    { label: t("Sans espaces"), value: stats.charactersNoSpaces },
    { label: t("Phrases"), value: stats.sentences },
    { label: t("Paragraphes"), value: stats.paragraphs },
    { label: t("Lignes"), value: stats.lines },
    { label: t("Lecture"), value: formatDuration(stats.readingSeconds) },
    { label: t("À voix haute"), value: formatDuration(stats.speakingSeconds) },
  ];

  const details: { label: string; value: string }[] = [
    { label: t("Longueur moyenne des mots"), value: t("{value} caractères", { value: stats.averageWordLength.toFixed(1) }) },
    { label: t("Mots par phrase"), value: stats.averageSentenceLength.toFixed(1) },
    { label: t("Syllabes par mot (estimation)"), value: stats.averageSyllables.toFixed(2) },
    {
      label: t("Lisibilité française (Kandel & Moles)"),
      value: `${stats.readabilityFr} — ${describeReadability(stats.readabilityFr)}`,
    },
    {
      label: t("Lisibilité anglaise (Flesch)"),
      value: `${stats.readabilityEn} — ${describeReadability(stats.readabilityEn)}`,
    },
  ];

  return (
    <div className="space-y-4">
      <TextPane
        label={t("Texte à analyser")}
        value={text}
        onChange={setText}
        placeholder={t("Collez votre texte, ou déposez un fichier .txt / .md ici…")}
      />

      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {cells.map((cell) => (
          <div
            key={cell.label}
            className="rounded-md border border-[var(--ft-border)] bg-[var(--ft-surface)] px-2.5 py-2"
          >
            <p className="text-lg font-semibold tabular-nums leading-6">{cell.value}</p>
            <p className="text-[11px] text-[var(--ft-text-muted)]">{tx(cell.label)}</p>
          </div>
        ))}
      </div>

      {stats.words > 0 && (
        <div className="rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)] p-3">
          <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[18rem_1fr]">
            {details.map((detail) => (
              <div key={detail.label} className="contents">
                <dt className="text-xs text-[var(--ft-text-muted)]">{tx(detail.label)}</dt>
                <dd className="text-xs tabular-nums">{detail.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <p className="flex items-start gap-2 text-xs text-[var(--ft-text-faint)]">
        <Icon name="Info" size={13} className="mt-px shrink-0" />
        {t("Estimations : {READING_WPM} mots/minute en lecture silencieuse, {SPEAKING_WPM} à voix haute. Les indices de lisibilité comptent les syllabes par approximation et donnent un ordre de grandeur, pas une mesure.", { READING_WPM, SPEAKING_WPM })}
      </p>
    </div>
  );
}
