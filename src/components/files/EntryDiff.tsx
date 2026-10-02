import { useEffect, useState } from "react";
import { Panel, StatGrid } from "@/components/files/Summary";
import { DiffSideBySide, DiffUnified } from "@/components/text/DiffView";
import { OptionGroup } from "@/components/pdf/Field";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Icon } from "@/components/ui/Icon";
import { formatFileSize, formatSizeWithExact } from "@/core/files";
import { formatOffset } from "@/core/files/hex";
import {
  binaryDiff,
  compareFiles,
  readTextFile,
  type BinaryDiff,
  type CompareResult,
} from "@/core/files/native";
import { diffLines, type DiffResult } from "@/core/text/diff";
import { Trans, formatNumber, t, tx } from "@/i18n";

/**
 * « Pourquoi ces deux fichiers diffèrent-ils ? »
 *
 * Savoir qu'une entrée est différente ne sert à rien si on ne peut pas
 * regarder en quoi. Ce panneau répond à la question sans quitter la
 * comparaison de dossiers, et sans réinventer quoi que ce soit :
 *
 * - pour deux fichiers texte, il réutilise le moteur de diff de FourTout
 *   (`diffLines`) et ses vues côte à côte / unifiée ;
 * - pour deux binaires, il montre ce qui a du sens à leur échelle — tailles,
 *   empreintes, premier octet divergent, premières plages — obtenues en flux
 *   côté natif, sans jamais charger les fichiers en mémoire.
 */
const TEXT_LIMIT = 2 * 1024 * 1024;

interface Loaded {
  compare: CompareResult;
  binary?: BinaryDiff;
  diff?: DiffResult;
  /** Les textes ont-ils été tronqués faute de tenir dans la limite ? */
  tooLarge?: boolean;
  error?: string;
}

export function EntryDiff({
  relative,
  leftPath,
  rightPath,
  leftLabel = "gauche",
  rightLabel = "droite",
  onClose,
}: {
  relative: string;
  leftPath: string;
  rightPath: string;
  leftLabel?: string;
  rightLabel?: string;
  onClose?: () => void;
}) {
  const [state, setState] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"side" | "unified">("side");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setState(null);

    (async () => {
      try {
        const compare = await compareFiles(leftPath, rightPath);
        if (cancelled) return;

        if (compare.bothText && Math.max(compare.sizeA, compare.sizeB) <= TEXT_LIMIT) {
          const [left, right] = await Promise.all([
            readTextFile(leftPath, TEXT_LIMIT),
            readTextFile(rightPath, TEXT_LIMIT),
          ]);
          if (cancelled) return;
          setState({ compare, diff: diffLines(left, right) });
        } else {
          const binary = await binaryDiff(leftPath, rightPath, 24);
          if (cancelled) return;
          setState({
            compare,
            binary,
            tooLarge: compare.bothText && Math.max(compare.sizeA, compare.sizeB) > TEXT_LIMIT,
          });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            compare: {
              identical: false,
              sizeA: 0,
              sizeB: 0,
              firstDifference: null,
              bothText: false,
              sha256A: "",
              sha256B: "",
            },
            error: error instanceof Error ? error.message : String(error),
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [leftPath, rightPath]);

  return (
    <Panel
      title={relative}
      testId="entry-diff"
      actions={
        onClose && (
          <Button size="sm" variant="ghost" onClick={onClose} aria-label={t("Fermer le détail")}>
            <Icon name="X" size={13} />
          </Button>
        )
      }
    >
      <div className="space-y-3 p-3">
        {loading && <p className="ft-meta">{t("Lecture des deux fichiers…")}</p>}

        {state?.error && (
          <Callout tone="error" title={t("Comparaison impossible")}>
            {tx(state.error)}
          </Callout>
        )}

        {state && !state.error && (
          <>
            <StatGrid
              columns={4}
              stats={[
                { label: t("Taille {leftLabel}", { leftLabel }), value: formatFileSize(state.compare.sizeA) },
                { label: t("Taille {rightLabel}", { rightLabel }), value: formatFileSize(state.compare.sizeB) },
                {
                  label: t("Premier octet différent"),
                  value:
                    state.compare.firstDifference === null
                      ? "—"
                      : formatOffset(state.compare.firstDifference),
                  tone: "warn",
                },
                {
                  label: t("Contenu"),
                  value: state.compare.identical ? "identique" : t("différent"),
                  tone: state.compare.identical ? "ok" : "warn",
                },
              ]}
            />

            <dl className="grid gap-x-4 gap-y-1 text-[11px] sm:grid-cols-[9rem_1fr]">
              <dt className="text-[var(--ft-text-muted)]">SHA-256 {leftLabel}</dt>
              <dd className="break-all font-mono">{state.compare.sha256A}</dd>
              <dt className="text-[var(--ft-text-muted)]">SHA-256 {rightLabel}</dt>
              <dd className="break-all font-mono">{state.compare.sha256B}</dd>
            </dl>

            {state.diff && (
              <>
                <div className="flex items-center gap-3">
                  <OptionGroup
                    ariaLabel={t("Présentation de la différence")}
                    value={view}
                    onChange={setView}
                    options={[
                      { value: "side", label: t("Côte à côte") },
                      { value: "unified", label: t("Unifié") },
                    ]}
                  />
                  <Trans source={"<0>{added} ajoutée(s) · {removed} retirée(s) · {modified} modifiée(s) · {unchanged} inchangée(s)</0>"} values={{ added: state.diff.stats.added, removed: state.diff.stats.removed, modified: state.diff.stats.modified, unchanged: state.diff.stats.unchanged }} components={[<span className="ft-meta tabular-nums" />]} />
                </div>
                <div className="max-h-96 overflow-auto rounded-md border border-[var(--ft-border)]">
                  {view === "side" ? (
                    <DiffSideBySide rows={state.diff.rows} />
                  ) : (
                    <DiffUnified rows={state.diff.rows} />
                  )}
                </div>
              </>
            )}

            {state.tooLarge && (
              <Callout tone="info" title={t("Fichiers texte trop volumineux pour un diff ligne à ligne")}>
                {t("Au-delà de {size}, FourTout ne charge pas les deux fichiers en mémoire pour les aligner. Les plages divergentes ci-dessous ont été trouvées en flux.", { size: formatFileSize(TEXT_LIMIT) })}
              </Callout>
            )}

            {state.binary && (
              <>
                <p className="ft-meta">
                  {t("{value} octet(s) différent(s) sur la partie commune, en {count} plage(s){value2}.", { value: formatNumber(state.binary.differingBytes), count: state.binary.ranges.length, value2: state.binary.truncated && " (liste écourtée)" })}
                </p>
                {state.binary.ranges.length > 0 ? (
                  <div className="overflow-x-auto rounded-md border border-[var(--ft-border)]">
                    <table className="w-full border-collapse text-[11px]">
                      <thead>
                        <tr className="border-b border-[var(--ft-rule)] text-left text-[var(--ft-text-muted)]">
                          <th className="px-3 py-1 font-medium">{t("Décalage")}</th>
                          <th className="px-3 py-1 font-medium">{t("Longueur")}</th>
                          <th className="px-3 py-1 font-medium">{t("Fin")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {state.binary.ranges.map((range) => (
                          <tr key={range.offset} className="border-t border-[var(--ft-rule)]">
                            <td className="px-3 py-1 font-mono">{formatOffset(range.offset)}</td>
                            <td className="px-3 py-1 tabular-nums">
                              {formatSizeWithExact(range.length)}
                            </td>
                            <td className="px-3 py-1 font-mono text-[var(--ft-text-muted)]">
                              {formatOffset(range.offset + range.length)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Callout tone="neutral" title={t("Aucune plage divergente")}>
                    {t("Les deux fichiers ont le même contenu sur toute leur longueur commune.")}
                  </Callout>
                )}
              </>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}
