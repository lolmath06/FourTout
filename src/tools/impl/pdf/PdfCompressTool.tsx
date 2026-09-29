import { useState } from "react";
import { PdfToolShell } from "@/components/pdf/PdfToolShell";
import { Field, Fieldset, OptionGroup } from "@/components/pdf/Field";
import { Icon } from "@/components/ui/Icon";
import { formatFileSize } from "@/core/files";
import {
  COMPRESSION_LEVELS,
  compressPdf,
  type CompressionLevel,
} from "@/core/pdf/operations/compress";
import type { ToolComponentProps } from "@/tools/implementations";

export function PdfCompressTool({ tool }: ToolComponentProps) {
  const [level, setLevel] = useState<CompressionLevel>("balanced");
  const [report, setReport] = useState<{
    original: number;
    compressed: number;
    percent: number;
  } | null>(null);

  const hint = COMPRESSION_LEVELS.find((entry) => entry.value === level)?.hint;

  return (
    <div className="space-y-4">
      <p className="flex items-start gap-2 rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface-2)] px-3 py-2.5 text-xs text-[var(--ft-text-muted)]">
        <Icon name="Info" size={14} className="mt-px shrink-0" />
        Le gain dépend entièrement du contenu. Un document rempli de photos ou de pages scannées
        peut perdre beaucoup de poids ; un document uniquement textuel, déjà bien optimisé, ne
        gagnera presque rien. Le texte reste du texte : il demeure sélectionnable.
      </p>

      <PdfToolShell
        tool={tool}
        actionLabel="Compresser"
        run={async ({ documents, context }) => {
          const result = await compressPdf(documents[0].source, level, context);
          setReport({
            original: result.originalSize,
            compressed: result.compressedSize,
            percent: result.savedPercent,
          });

          const summary = result.improved
            ? `${formatFileSize(result.originalSize)} → ${formatFileSize(result.compressedSize)} (${result.savedPercent.toFixed(1)} % de gain).`
            : `${formatFileSize(result.originalSize)} → ${formatFileSize(result.compressedSize)} : aucun gain sur ce document.`;

          const details: string[] = [];
          if (result.imagesRecompressed > 0) {
            details.push(`${result.imagesRecompressed} image(s) réencodée(s)`);
          }
          if (result.imagesSkipped > 0) {
            details.push(`${result.imagesSkipped} image(s) laissée(s) telle(s) quelle(s)`);
          }

          return {
            files: [result.output],
            summary: [summary, details.join(", ")].filter(Boolean).join(" "),
            warning: result.improved
              ? undefined
              : "Le fichier produit n'est pas plus petit que l'original : conservez plutôt votre document de départ.",
          };
        }}
      >
        {() => (
          <Fieldset columns={1}>
            <Field label="Niveau de compression" hint={hint}>
              <OptionGroup
                ariaLabel="Niveau de compression"
                value={level}
                onChange={setLevel}
                options={COMPRESSION_LEVELS.map((entry) => ({
                  value: entry.value,
                  label: entry.label,
                  hint: entry.hint,
                }))}
              />
            </Field>
          </Fieldset>
        )}
      </PdfToolShell>

      {report && (
        <div className="grid gap-1.5 sm:grid-cols-3">
          <Metric label="Taille d'origine" value={formatFileSize(report.original)} />
          <Metric label="Après compression" value={formatFileSize(report.compressed)} />
          <Metric
            label="Gain"
            value={`${report.percent > 0 ? "−" : "+"}${Math.abs(report.percent).toFixed(1)} %`}
            tone={report.percent > 0 ? "good" : "bad"}
          />
        </div>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "bad";
}) {
  const color =
    tone === "good"
      ? "text-[var(--ft-ok)]"
      : tone === "bad"
        ? "text-[var(--ft-warn)]"
        : "text-[var(--ft-text)]";
  return (
    <div className="rounded-md border border-[var(--ft-border)] bg-[var(--ft-surface)] px-3 py-2">
      <p className={`text-lg font-semibold tabular-nums leading-6 ${color}`}>{value}</p>
      <p className="text-[11px] text-[var(--ft-text-muted)]">{label}</p>
    </div>
  );
}
