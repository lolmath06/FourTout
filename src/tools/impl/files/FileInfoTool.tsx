import { useState } from "react";
import { Link } from "react-router-dom";
import { NativeToolShell } from "@/components/files/NativeToolShell";
import { Icon } from "@/components/ui/Icon";
import { formatFileSize, kindOfExtension } from "@/core/files";
import { fileInfo, hashFiles, type FileInfo } from "@/core/files/native";
import { toolRoute } from "@/core/tools/types";
import { toolRegistry } from "@/core/tools/registry";
import type { ToolComponentProps } from "@/tools/implementations";

/**
 * Fiche d'identité d'un fichier.
 *
 * Elle croise deux sources : ce que le nom prétend (extension, type MIME) et
 * ce que les premiers octets révèlent. Un `.jpg` qui commence par `%PDF-` est
 * signalé — c'est exactement le genre de détail qui explique pourquoi un
 * fichier « ne s'ouvre pas ».
 *
 * Pour l'analyse détaillée (durée, codecs, pages, dimensions), l'outil renvoie
 * vers les moteurs déjà en place plutôt que de les réimplémenter.
 */
interface InfoResult {
  info: FileInfo;
  sha256?: string;
}

const RELATED_TOOLS: Partial<Record<string, string[]>> = {
  pdf: ["pdf-metadata", "pdf-extract-text"],
  image: ["image-metadata-read", "image-convert"],
  audio: ["audio-convert", "audio-transcribe"],
  video: ["video-convert", "video-extract-audio"],
  archive: ["archive-extract"],
  document: ["docx-extract"],
  text: ["text-statistics", "text-line-endings"],
};

export function FileInfoTool(_props: ToolComponentProps) {
  const [paths, setPaths] = useState<string[]>([]);
  const [withHash, setWithHash] = useState(true);

  return (
    <NativeToolShell<InfoResult>
      picker={{
        mode: "files",
        paths,
        onChange: setPaths,
        label: "Choisissez un fichier",
      }}
      actionLabel="Analyser le fichier"
      actionIcon="FileSearch"
      run={async (context) => {
        const info = await fileInfo(paths[0]);
        if (!withHash || info.isDir) return { info };
        const [hashes] = await hashFiles([paths[0]], ["sha256"], context);
        return { info, sha256: hashes?.digests[0]?.[1] };
      }}
      renderResult={({ info, sha256 }) => {
        const kind = kindOfExtension(info.extension);
        const related = toolRegistry.resolveMany(RELATED_TOOLS[kind] ?? []);

        return (
          <div className="space-y-3" data-testid="file-info">
            <div className="rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)] p-4">
              <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[12rem_1fr]">
                <Row label="Nom" value={info.name} />
                <Row label="Emplacement" value={info.path} mono />
                <Row label="Type" value={info.isDir ? "Dossier" : "Fichier"} />
                <Row label="Taille" value={`${formatFileSize(info.size)} (${info.size.toLocaleString("fr-FR")} octets)`} />
                <Row label="Extension" value={info.extension || "—"} mono />
                <Row label="Type MIME (d'après l'extension)" value={info.mime} mono />
                <Row
                  label="Type réel (d'après le contenu)"
                  value={info.magic === "inconnu" ? "non reconnu" : info.magic}
                  mono
                />
                <Row label="Modifié le" value={formatDate(info.modified)} />
                <Row label="Créé le" value={formatDate(info.created)} />
                <Row label="Dernier accès" value={formatDate(info.accessed)} />
                <Row label="Lecture seule" value={info.readOnly ? "oui" : "non"} />
                <Row label="Lien symbolique" value={info.isSymlink ? "oui" : "non"} />
                <Row label="Contenu texte" value={info.looksLikeText ? "oui" : "non"} />
                {sha256 && <Row label="SHA-256" value={sha256} mono />}
              </dl>
            </div>

            {!info.extensionMatches && (
              <p className="flex items-start gap-2 rounded-md border border-[var(--ft-warn)] px-3 py-2 text-xs text-[var(--ft-warn)]">
                <Icon name="TriangleAlert" size={14} className="mt-px shrink-0" />
                L'extension annonce « {info.extension || "aucune"} » mais le contenu ressemble à un
                fichier « {info.magic} ». Le fichier a peut-être été renommé, ou il est endommagé.
              </p>
            )}

            {related.length > 0 && (
              <div className="rounded-md border border-[var(--ft-border)] bg-[var(--ft-surface-2)] px-3 py-2">
                <p className="mb-1.5 text-xs font-medium text-[var(--ft-text-muted)]">
                  Pour aller plus loin avec ce type de fichier
                </p>
                <div className="flex flex-wrap gap-2">
                  {related.map((entry) => (
                    <Link
                      key={entry.id}
                      to={toolRoute(entry.id)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-[var(--ft-border)] bg-[var(--ft-surface)] px-2.5 py-1 text-xs hover:border-[var(--ft-accent)]"
                    >
                      <Icon name={entry.icon} size={13} />
                      {entry.name}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      }}
    >
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={withHash}
          onChange={(event) => setWithHash(event.target.checked)}
          className="size-3.5 accent-[var(--ft-accent)]"
        />
        Calculer aussi l'empreinte SHA-256
      </label>
    </NativeToolShell>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="contents">
      <dt className="text-[var(--ft-text-muted)]">{label}</dt>
      <dd className={mono ? "break-all font-mono" : "break-words"}>{value}</dd>
    </div>
  );
}

function formatDate(milliseconds: number): string {
  if (!milliseconds) return "—";
  return new Date(milliseconds).toLocaleString("fr-FR");
}
