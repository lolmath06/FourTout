import { useEffect, useMemo, useState } from "react";
import { constraintsForTool, type SelectedFile } from "@/core/files";
import { FileDropZone } from "@/components/files/FileDropZone";
import { Field, Fieldset, NumberInput, OptionGroup } from "@/components/pdf/Field";
import { ResultPanel, type OperationOutcome } from "@/components/pdf/ResultPanel";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Icon } from "@/components/ui/Icon";
import { readSelectedFile } from "@/core/image/codec";
import {
  conversionWarnings,
  cueDuration,
  mergeCues,
  MERGE_ORDERS,
  normalizeCues,
  parseSubtitles,
  shiftCues,
  serialize,
  subtitleOutputName,
  SUBTITLE_MIME,
  type MergeOrder,
  type SubtitleCue,
  type SubtitleDocument,
  type SubtitleFormat,
  type SubtitleReport,
} from "@/core/subtitles";
import { decodeText, detectEncoding, ENCODING_LABELS } from "@/core/text/encoding";
import { formatTimecode } from "@/core/media/types";
import { presetString, useHandoff } from "@/features/handoff/store";
import { notify } from "@/features/notifications/store";
import type { ToolComponentProps } from "@/tools/implementations";

/**
 * Modifier des sous-titres : convertir, décaler, fusionner, vérifier.
 *
 * Quatre gestes du même travail, et on passe de l'un à l'autre sans arrêt —
 * on décale, on vérifie que ça tombe juste, on convertit. En faire quatre
 * outils obligerait à redéposer le fichier à chaque étape.
 *
 * Le fichier déposé n'est jamais modifié : chaque action produit un nouveau
 * fichier à enregistrer.
 */

type Mode = "convert" | "shift" | "merge" | "check";

const MODES: { value: Mode; label: string }[] = [
  { value: "convert", label: "Convertir" },
  { value: "shift", label: "Décaler" },
  { value: "merge", label: "Fusionner" },
  { value: "check", label: "Vérifier" },
];

export function SubtitleEditTool({ tool }: ToolComponentProps) {
  const handoff = useHandoff(tool.id);
  const [mode, setMode] = useState<Mode>("convert");
  const [files, setFiles] = useState<SelectedFile[]>(() => handoff?.files ?? []);
  const [documents, setDocuments] = useState<SubtitleDocument[]>([]);
  const [encodings, setEncodings] = useState<string[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [outcome, setOutcome] = useState<OperationOutcome | null>(null);

  const [format, setFormat] = useState<SubtitleFormat>(() => {
    const preset = presetString(handoff, "format");
    return preset === "vtt" || preset === "srt" ? preset : "vtt";
  });
  const [offsetMs, setOffsetMs] = useState(0);
  const [mergeOrder, setMergeOrder] = useState<MergeOrder>("chronological");
  const [normalizeOptions, setNormalizeOptions] = useState({
    sort: true,
    removeEmpty: true,
    removeDuplicates: true,
    removeInvalid: false,
  });

  // Lecture des fichiers déposés : les deux formats passent par le même modèle
  // interne, donc le reste de l'outil n'a plus à savoir d'où vient le fichier.
  useEffect(() => {
    let cancelled = false;
    setOutcome(null);
    if (files.length === 0) {
      setDocuments([]);
      return;
    }
    (async () => {
      try {
        const read: SubtitleDocument[] = [];
        const seen: string[] = [];
        for (const file of files) {
          const bytes = await readSelectedFile(file);
          // Un SRT venu de Windows est souvent en UTF-16 ou en Windows-1252 :
          // le décoder en UTF-8 d'office ne lèverait aucune erreur, il
          // remplacerait simplement tous les accents par des losanges. On
          // réutilise donc la détection d'encodage de la phase 8, et on dit ce
          // qu'on a lu — la sortie, elle, est toujours écrite en UTF-8.
          const detection = detectEncoding(bytes);
          seen.push(detection.encoding);
          read.push(parseSubtitles(decodeText(bytes, detection.encoding), file.extension));
        }
        if (!cancelled) {
          setDocuments(read);
          setEncodings(seen);
          setError(undefined);
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [files]);

  const primary = documents[0];

  /** Répliques telles que l'action en cours les produirait. */
  const resulting = useMemo<SubtitleCue[]>(() => {
    if (!primary) return [];
    switch (mode) {
      case "shift":
        return shiftCues(primary.cues, offsetMs).cues;
      case "merge":
        return documents[1] ? mergeCues(primary.cues, documents[1].cues, mergeOrder) : primary.cues;
      case "check":
        return normalizeCues(primary.cues, normalizeOptions).cues;
      default:
        return primary.cues;
    }
  }, [primary, documents, mode, offsetMs, mergeOrder, normalizeOptions]);

  const shifted = primary && mode === "shift" ? shiftCues(primary.cues, offsetMs) : undefined;
  const normalized = primary && mode === "check" ? normalizeCues(primary.cues, normalizeOptions) : undefined;

  const outputFormat = mode === "convert" ? format : (primary?.format ?? "srt");

  const produce = async () => {
    if (!primary || !files[0]) return;
    const text = serialize(resulting, outputFormat);
    const suffix =
      mode === "shift" ? "decale" : mode === "merge" ? "fusion" : mode === "check" ? "normalise" : undefined;
    const warnings = conversionWarnings(resulting, outputFormat);
    setOutcome({
      files: [
        {
          name: subtitleOutputName(files[0].name, outputFormat, suffix),
          bytes: new TextEncoder().encode(text),
          mimeType: SUBTITLE_MIME[outputFormat],
        },
      ],
      summary: `${resulting.length} réplique${resulting.length > 1 ? "s" : ""} écrite${
        resulting.length > 1 ? "s" : ""
      } en ${outputFormat.toUpperCase()}.`,
      warning: warnings[0]?.message,
    });
    notify.success("Sous-titres prêts", "Enregistrez le fichier depuis le panneau de résultat.");
  };

  return (
    <div className="space-y-4">
      <Fieldset columns={1}>
        <Field label="Que voulez-vous faire ?">
          <OptionGroup
            ariaLabel="Action"
            value={mode}
            onChange={(value) => setMode(value as Mode)}
            options={MODES}
          />
        </Field>
      </Fieldset>

      <FileDropZone
        constraints={{ ...constraintsForTool(tool), maxFiles: mode === "merge" ? 2 : 1 }}
        files={files}
        onChange={setFiles}
        label={mode === "merge" ? "Déposez les deux fichiers à fusionner" : "Déposez un fichier SRT ou WebVTT"}
        hint={mode === "merge" ? "Le premier fichier est A, le second B." : undefined}
      />

      {error && (
        <Callout tone="error" title="Fichier illisible">
          {error}
        </Callout>
      )}

      {primary && (
        <>
          <p className="text-xs text-[var(--ft-text-muted)]">
            {files[0].name} — {primary.format.toUpperCase()}, {primary.cues.length} réplique
            {primary.cues.length > 1 ? "s" : ""}
            {encodings[0] && encodings[0] !== "utf-8" &&
              ` · lu en ${ENCODING_LABELS[encodings[0] as keyof typeof ENCODING_LABELS] ?? encodings[0]}, réécrit en UTF-8`}
            {documents[1] &&
              ` · ${files[1].name} — ${documents[1].format.toUpperCase()}, ${documents[1].cues.length} répliques`}
          </p>

          {primary.warnings.length > 0 && (
            <Callout tone="warning" title="Anomalies relevées à la lecture">
              <ul className="ml-4 list-disc space-y-0.5">
                {primary.warnings.slice(0, 6).map((warning, index) => (
                  <li key={index}>
                    {warning.line ? `Ligne ${warning.line} : ` : ""}
                    {warning.message}
                  </li>
                ))}
              </ul>
            </Callout>
          )}

          {mode === "convert" && (
            <Fieldset columns={1}>
              <Field label="Format de sortie">
                <OptionGroup
                  ariaLabel="Format"
                  value={format}
                  onChange={(value) => setFormat(value as SubtitleFormat)}
                  options={[
                    { value: "srt", label: "SubRip (.srt)" },
                    { value: "vtt", label: "WebVTT (.vtt)" },
                  ]}
                />
              </Field>
            </Fieldset>
          )}

          {mode === "shift" && (
            <>
              <Fieldset columns={2}>
                <Field
                  label="Décalage (millisecondes)"
                  hint="Positif pour retarder les sous-titres, négatif pour les avancer."
                >
                  <NumberInput
                    value={offsetMs}
                    step={100}
                    onChange={(event) => setOffsetMs(Number(event.target.value) || 0)}
                  />
                </Field>
                <Field label="Raccourcis">
                  <div className="flex flex-wrap gap-1">
                    {[-5000, -1000, -500, 500, 1000, 5000].map((step) => (
                      <button
                        key={step}
                        onClick={() => setOffsetMs((current) => current + step)}
                        className="rounded border border-[var(--ft-border)] px-2 py-1 text-xs hover:border-[var(--ft-accent)]"
                      >
                        {step > 0 ? "+" : ""}
                        {step / 1000} s
                      </button>
                    ))}
                  </div>
                </Field>
              </Fieldset>
              {shifted && (shifted.clamped > 0 || shifted.dropped > 0) && (
                <Callout tone="warning" title="Bornes atteintes">
                  {shifted.clamped > 0 &&
                    `${shifted.clamped} réplique${shifted.clamped > 1 ? "s" : ""} commencerai${
                      shifted.clamped > 1 ? "ent" : "t"
                    } avant zéro : ramenée${shifted.clamped > 1 ? "s" : ""} à 0 en conservant sa durée. `}
                  {shifted.dropped > 0 &&
                    `${shifted.dropped} réplique${shifted.dropped > 1 ? "s" : ""} tomberai${
                      shifted.dropped > 1 ? "ent" : "t"
                    } entièrement avant zéro et ne peu${shifted.dropped > 1 ? "vent" : "t"} pas être conservée${
                      shifted.dropped > 1 ? "s" : ""
                    }.`}
                </Callout>
              )}
            </>
          )}

          {mode === "merge" && (
            <>
              <Fieldset columns={1}>
                <Field
                  label="Ordre"
                  hint={MERGE_ORDERS.find((entry) => entry.value === mergeOrder)?.hint}
                >
                  <OptionGroup
                    ariaLabel="Ordre"
                    value={mergeOrder}
                    onChange={(value) => setMergeOrder(value as MergeOrder)}
                    options={MERGE_ORDERS.map((entry) => ({ value: entry.value, label: entry.label }))}
                  />
                </Field>
              </Fieldset>
              {!documents[1] && (
                <Callout tone="info" title="Il manque le second fichier">
                  Déposez un deuxième fichier de sous-titres pour la fusion.
                </Callout>
              )}
              <Callout tone="neutral" title="Ce que « fusionner » veut dire ici">
                Les répliques des deux fichiers sont réunies sur une seule ligne de temps. Deux
                répliques qui se chevauchent restent deux répliques : rien n'est recollé ni
                supprimé.
              </Callout>
            </>
          )}

          {mode === "check" && normalized && (
            <>
              <Fieldset columns={2}>
                {(
                  [
                    ["sort", "Trier chronologiquement"],
                    ["removeEmpty", "Retirer les répliques vides"],
                    ["removeDuplicates", "Retirer les doublons exacts"],
                    ["removeInvalid", "Retirer les répliques inaffichables"],
                  ] as const
                ).map(([key, label]) => (
                  <Field key={key} label={label}>
                    <OptionGroup
                      ariaLabel={label}
                      value={normalizeOptions[key] ? "yes" : "no"}
                      onChange={(value) =>
                        setNormalizeOptions((current) => ({ ...current, [key]: value === "yes" }))
                      }
                      options={[
                        { value: "yes", label: "Oui" },
                        { value: "no", label: "Non" },
                      ]}
                    />
                  </Field>
                ))}
              </Fieldset>
              <Reports before={normalized.before} after={normalized.after} />
              {normalized.remaining.map((issue, index) => (
                <Callout key={index} tone="warning" title="Signalé, mais pas corrigé">
                  {issue.message}
                </Callout>
              ))}
            </>
          )}

          <div className="flex items-center justify-between gap-3 border-t border-[var(--ft-border)] pt-4">
            <p className="text-xs text-[var(--ft-text-muted)]">
              Résultat : {resulting.length} réplique{resulting.length > 1 ? "s" : ""} en{" "}
              {outputFormat.toUpperCase()}
            </p>
            <Button
              size="md"
              variant="primary"
              onClick={produce}
              disabled={resulting.length === 0 || (mode === "merge" && !documents[1])}
            >
              <Icon name="Play" size={15} />
              Produire le fichier
            </Button>
          </div>

          <CueTable cues={resulting} />
        </>
      )}

      {outcome && <ResultPanel outcome={outcome} />}
    </div>
  );
}

/* ---------------------------------------------------------------- affichage */

function Reports({ before, after }: { before: SubtitleReport; after: SubtitleReport }) {
  const rows: [string, number | string, number | string][] = [
    ["Répliques", before.cues, after.cues],
    ["Vides", before.empty, after.empty],
    ["Doublons exacts", before.duplicates, after.duplicates],
    ["Hors ordre", before.outOfOrder, after.outOfOrder],
    ["Chevauchements", before.overlaps, after.overlaps],
    ["Fin avant début", before.endBeforeStart, after.endBeforeStart],
    [
      "Première / dernière",
      before.firstStartMs === undefined ? "—" : formatTimecode(before.firstStartMs),
      after.lastEndMs === undefined ? "—" : formatTimecode(after.lastEndMs),
    ],
  ];

  return (
    <div className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--ft-border)]">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-[10px] uppercase tracking-wide text-[var(--ft-text-faint)]">
            <th className="px-3 py-1.5 text-left font-normal">Constat</th>
            <th className="px-3 py-1.5 text-right font-normal">Avant</th>
            <th className="px-3 py-1.5 text-right font-normal">Après</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--ft-border)]">
          {rows.map(([label, a, b]) => (
            <tr key={label}>
              <td className="px-3 py-1.5">{label}</td>
              <td className="px-3 py-1.5 text-right font-mono">{a}</td>
              <td className="px-3 py-1.5 text-right font-mono">{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Aperçu du résultat. Au-delà de deux cents répliques, on n'en montre que le début. */
const PREVIEW_LIMIT = 200;

function CueTable({ cues }: { cues: readonly SubtitleCue[] }) {
  if (cues.length === 0) return null;
  const shown = cues.slice(0, PREVIEW_LIMIT);

  return (
    <div className="space-y-1">
      <div className="max-h-[380px] overflow-auto rounded-[var(--radius-card)] border border-[var(--ft-border)]">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-[var(--ft-surface)]">
            <tr className="text-[10px] uppercase tracking-wide text-[var(--ft-text-faint)]">
              <th className="px-2 py-1.5 text-left font-normal">#</th>
              <th className="px-2 py-1.5 text-left font-normal">Début</th>
              <th className="px-2 py-1.5 text-left font-normal">Fin</th>
              <th className="px-2 py-1.5 text-left font-normal">Durée</th>
              <th className="px-2 py-1.5 text-left font-normal">Texte</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--ft-border)]">
            {shown.map((cue, index) => (
              <tr key={index}>
                <td className="px-2 py-1 font-mono text-[var(--ft-text-faint)]">{index + 1}</td>
                <td className="px-2 py-1 font-mono">{formatTimecode(cue.startMs)}</td>
                <td className="px-2 py-1 font-mono">{formatTimecode(cue.endMs)}</td>
                <td className="px-2 py-1 font-mono text-[var(--ft-text-muted)]">
                  {(cueDuration(cue) / 1000).toFixed(1)} s
                </td>
                <td className="px-2 py-1 whitespace-pre-wrap">{cue.text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {cues.length > shown.length && (
        <p className="text-xs text-[var(--ft-text-muted)]">
          {shown.length} premières répliques affichées sur {cues.length}. Le fichier produit les
          contient toutes.
        </p>
      )}
    </div>
  );
}
