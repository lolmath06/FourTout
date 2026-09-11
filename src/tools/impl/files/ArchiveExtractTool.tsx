import { useEffect, useState } from "react";
import { NativeToolShell } from "@/components/files/NativeToolShell";
import { CheckOption } from "@/components/text/TextToolShell";
import { Field, Fieldset } from "@/components/pdf/Field";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { formatFileSize } from "@/core/files";
import {
  extractArchive,
  listArchive,
  pickDirectory,
  type ArchiveListing,
  type ExtractSummary,
} from "@/core/files/native";
import { directoryName, joinPath, stemOf, baseName } from "@/core/files/paths";
import { openFolder } from "@/core/output/save";
import { notify } from "@/features/notifications/store";
import type { ToolComponentProps } from "@/tools/implementations";

/**
 * Extraction d'archives ZIP, 7z, TAR, TAR.GZ et TAR.XZ.
 *
 * Le contenu est **inspecté avant** toute écriture : nombre de fichiers, taille
 * décompressée, et surtout entrées refusées. Une archive contenant
 * `../../evil.txt` ou un chemin absolu ne peut rien écrire hors du dossier
 * choisi : ces entrées sont ignorées et listées.
 */
export function ArchiveExtractTool(_props: ToolComponentProps) {
  const [paths, setPaths] = useState<string[]>([]);
  const [listing, setListing] = useState<ArchiveListing | null>(null);
  const [listingError, setListingError] = useState<string | undefined>();
  const [destination, setDestination] = useState("");
  const [subfolder, setSubfolder] = useState(true);
  const [overwrite, setOverwrite] = useState(false);

  useEffect(() => {
    setListing(null);
    setListingError(undefined);
    if (paths.length === 0) return;
    let cancelled = false;
    listArchive(paths[0])
      .then((result) => {
        if (!cancelled) setListing(result);
      })
      .catch((error: unknown) => {
        if (!cancelled) setListingError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [paths]);

  const parent = destination || (paths[0] ? directoryName(paths[0]) : "");
  const target =
    parent && subfolder && paths[0]
      ? joinPath(parent, stemOf(baseName(paths[0])).replace(/\.tar$/i, ""))
      : parent;

  return (
    <NativeToolShell<ExtractSummary>
      picker={{
        mode: "files",
        paths,
        onChange: (next) => {
          setPaths(next.slice(-1));
          setDestination("");
        },
        label: "Choisissez l'archive à extraire",
        filters: [{ name: "Archives", extensions: ["zip", "7z", "tar", "gz", "tgz", "xz", "txz"] }],
        hint: "ZIP, 7z, TAR, TAR.GZ et TAR.XZ",
      }}
      actionLabel="Extraire l'archive"
      actionIcon="PackageOpen"
      actionDisabled={target.length === 0 || listing === null}
      run={(context) => extractArchive(paths[0], target, overwrite, context)}
      successMessage={(summary) => `${summary.extracted} fichier(s) extrait(s)`}
      renderResult={(summary) => (
        <div className="rounded-[var(--radius-card)] border border-[color-mix(in_oklch,var(--ft-ok)_45%,var(--ft-border))] bg-[color-mix(in_oklch,var(--ft-ok)_6%,transparent)] p-4">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Icon name="CircleCheck" size={17} className="text-[var(--ft-ok)]" />
            {summary.extracted} fichier(s) extrait(s) — {formatFileSize(summary.bytes)}
          </p>
          <p className="mt-1 break-all text-xs text-[var(--ft-text-muted)]">{summary.destination}</p>
          {summary.skipped.length > 0 && (
            <div className="mt-2 rounded-md border border-[var(--ft-warn)] px-2.5 py-2 text-xs text-[var(--ft-warn)]">
              <p className="font-medium">{summary.skipped.length} entrée(s) refusée(s) par sécurité</p>
              <ul className="mt-1 max-h-32 overflow-y-auto font-mono">
                {summary.skipped.map((entry) => (
                  <li key={entry} className="truncate">
                    {entry}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-3">
            <Button size="sm" onClick={() => openFolder(summary.destination)}>
              <Icon name="FolderTree" size={14} /> Ouvrir le dossier
            </Button>
          </div>
        </div>
      )}
    >
      {listingError && (
        <p className="flex items-center gap-2 rounded-md border border-[var(--ft-danger)] px-3 py-2 text-sm text-[var(--ft-danger)]">
          <Icon name="CircleAlert" size={16} /> {listingError}
        </p>
      )}

      {listing && (
        <div className="rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface-2)] p-3 text-sm">
          <p className="tabular-nums">
            Archive {listing.format.toUpperCase()} · <strong>{listing.files}</strong> fichier(s) ·{" "}
            {formatFileSize(listing.archiveSize)} compressés →{" "}
            <strong>{formatFileSize(listing.totalSize)}</strong> décompressés
          </p>
          {listing.suspicious && (
            <p className="mt-1.5 flex items-start gap-1.5 text-xs text-[var(--ft-warn)]">
              <Icon name="TriangleAlert" size={13} className="mt-px shrink-0" />
              Rapport de compression inhabituel : cette archive occupera beaucoup plus de place une
              fois extraite. Vérifiez que c'est attendu avant de continuer.
            </p>
          )}
          {listing.rejected > 0 && (
            <p className="mt-1.5 flex items-start gap-1.5 text-xs text-[var(--ft-danger)]">
              <Icon name="ShieldCheck" size={13} className="mt-px shrink-0" />
              {listing.rejected} entrée(s) seront ignorées : leur chemin sortirait du dossier de
              destination (remontée « .. », chemin absolu ou lien symbolique).
            </p>
          )}
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-[var(--ft-text-muted)]">
              Voir le contenu ({listing.entries.length} entrée(s))
            </summary>
            <ul className="mt-1.5 max-h-56 overflow-y-auto font-mono text-[11px]">
              {listing.entries.slice(0, 500).map((entry) => (
                <li
                  key={entry.name}
                  className={`flex gap-2 ${entry.rejected ? "text-[var(--ft-danger)]" : ""}`}
                >
                  <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                  {!entry.isDir && (
                    <span className="shrink-0 tabular-nums text-[var(--ft-text-faint)]">
                      {formatFileSize(entry.size)}
                    </span>
                  )}
                  {entry.rejected && <span className="shrink-0">refusé</span>}
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}

      <Fieldset columns={2}>
        <Field label="Dossier de destination">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate rounded-md border border-[var(--ft-border)] bg-[var(--ft-bg)] px-2.5 py-2 text-xs">
              {target || "—"}
            </span>
            <Button
              size="sm"
              onClick={async () => {
                const chosen = await pickDirectory("Dossier de destination");
                if (chosen) setDestination(chosen);
                else notify.info("Destination inchangée");
              }}
            >
              Choisir…
            </Button>
          </div>
        </Field>
        <Field label="Options" full>
          <div className="grid gap-0.5 sm:grid-cols-2">
            <CheckOption
              checked={subfolder}
              onChange={setSubfolder}
              label="Créer un sous-dossier au nom de l'archive"
            />
            <CheckOption
              checked={overwrite}
              onChange={setOverwrite}
              label="Écraser les fichiers existants"
              hint="Sinon, ils sont écrits à côté sous un nom libre"
            />
          </div>
        </Field>
      </Fieldset>
    </NativeToolShell>
  );
}
