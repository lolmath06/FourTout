import { useEffect, useState } from "react";
import { PdfToolShell } from "@/components/pdf/PdfToolShell";
import { singleResult } from "@/components/pdf/result";
import { Field, Fieldset, TextInput } from "@/components/pdf/Field";
import { readMetadata, writeMetadata, type MetadataChanges } from "@/core/pdf/operations/metadata";
import { EDITABLE_METADATA_FIELDS, type PdfMetadata, type PdfSource } from "@/core/pdf/types";
import { Icon } from "@/components/ui/Icon";
import type { ToolComponentProps } from "@/tools/implementations";
import { localized, t, tx } from "@/i18n";

const LABELS: Record<string, string> = localized(() => ({
  title: t("Titre"),
  author: t("Auteur"),
  subject: t("Sujet"),
  keywords: t("Mots-clés"),
}));

export function PdfMetadataTool({ tool }: ToolComponentProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [original, setOriginal] = useState<PdfMetadata | null>(null);

  return (
    <PdfToolShell
      tool={tool}
      actionLabel={t("Enregistrer les métadonnées")}
      run={async ({ documents }) => {
        // Seuls les champs réellement modifiés sont transmis : les autres
        // restent tels quels dans le document.
        const changes: MetadataChanges = {};
        for (const field of EDITABLE_METADATA_FIELDS) {
          const next = values[field] ?? "";
          const before = original?.[field] ?? "";
          if (next !== before) changes[field] = next;
        }

        const output = await writeMetadata(documents[0].source, changes);
        const count = Object.keys(changes).length;
        return singleResult(
          output,
          count === 0
            ? t("Aucun champ modifié ; une copie a été créée.")
            : t("{count} {count, plural, one {champ} other {champs}} mis à jour.", { count }),
        );
      }}
    >
      {(documents) => (
        <MetadataForm
          source={documents[0].source}
          values={values}
          onValues={setValues}
          original={original}
          onOriginal={setOriginal}
        />
      )}
    </PdfToolShell>
  );
}

function MetadataForm({
  source,
  values,
  onValues,
  original,
  onOriginal,
}: {
  source: PdfSource;
  values: Record<string, string>;
  onValues: (values: Record<string, string>) => void;
  original: PdfMetadata | null;
  onOriginal: (metadata: PdfMetadata) => void;
}) {
  useEffect(() => {
    let cancelled = false;
    void readMetadata(source).then((metadata) => {
      if (cancelled) return;
      onOriginal(metadata);
      onValues({
        title: metadata.title ?? "",
        author: metadata.author ?? "",
        subject: metadata.subject ?? "",
        keywords: metadata.keywords ?? "",
      });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.name, source.bytes.length]);

  return (
    <div className="space-y-3">
      <Fieldset>
        {EDITABLE_METADATA_FIELDS.map((field) => (
          <Field
            key={field}
            label={tx(LABELS[field])}
            full={field === "subject" || field === "keywords"}
            hint={field === "keywords" ? t("Séparez les mots-clés par des virgules.") : undefined}
          >
            <TextInput
              value={values[field] ?? ""}
              onChange={(event) => onValues({ ...values, [field]: event.target.value })}
              placeholder={t("Aucun {value}", { value: tx(LABELS[field]).toLowerCase() })}
              aria-label={tx(LABELS[field])}
            />
          </Field>
        ))}
      </Fieldset>

      {original && (
        <div className="rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)] p-4">
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--ft-text-muted)]">
            <Icon name="Info" size={13} />
            {t("Informations non modifiables")}
          </h3>
          <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
            <ReadOnly label={t("Créateur")} value={original.creator} />
            <ReadOnly label={t("Producteur")} value={original.producer} />
            <ReadOnly label={t("Créé le")} value={formatDate(original.creationDate)} />
            <ReadOnly label={t("Modifié le")} value={formatDate(original.modificationDate)} />
          </dl>
        </div>
      )}
    </div>
  );
}

function ReadOnly({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-[var(--ft-border)] py-1 last:border-0">
      <dt className="shrink-0 text-[var(--ft-text-muted)]">{tx(label)}</dt>
      <dd className="truncate text-right" title={value}>
        {value ?? "—"}
      </dd>
    </div>
  );
}

function formatDate(date?: Date): string | undefined {
  if (!date || Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat("fr", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
