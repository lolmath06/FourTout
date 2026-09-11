import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { NativeRequired, RunBar } from "@/components/files/NativeRun";
import { isNativeAvailable, useNativeAction } from "@/components/files/useNativeAction";
import { PathPicker } from "@/components/files/PathPicker";
import { Panel, StatGrid } from "@/components/files/Summary";
import { Callout } from "@/components/ui/Callout";
import { Icon } from "@/components/ui/Icon";
import { formatFileSize } from "@/core/files";
import { formatOffset, toHexLines } from "@/core/files/hex";
import {
  fileInfo,
  listArchive,
  readBytes,
  readHex,
  type ArchiveListing,
  type FileInfo,
} from "@/core/files/native";
import { detectEncoding, ENCODING_LABELS } from "@/core/text/encoding";
import { toolRegistry } from "@/core/tools/registry";
import { toolRoute } from "@/core/tools/types";
import type { ToolComponentProps } from "@/tools/implementations";

/**
 * Aperçu universel.
 *
 * Deux règles gouvernent cet outil.
 *
 * **L'aperçu suit le contenu, pas l'extension.** Un `.jpg` qui contient un PNG
 * s'affiche quand même : la famille est décidée par la signature relevée par le
 * moteur d'inspection, pas par le nom du fichier.
 *
 * **Aucun nouveau décodeur.** Les images, l'audio et la vidéo passent par les
 * lecteurs du système déjà présents dans la WebView ; le texte passe par le
 * moteur d'encodage de la phase 8 ; les archives par le moteur de listage
 * natif ; le reste par l'affichage hexadécimal. Écrire un sixième décodeur
 * maison pour un simple aperçu serait du travail en pure perte.
 */
type PreviewKind = "text" | "image" | "pdf" | "audio" | "video" | "archive" | "hex";

interface Preview {
  info: FileInfo;
  kind: PreviewKind;
  /** Objet binaire pour les aperçus qui passent par le lecteur du système. */
  url?: string;
  text?: { content: string; encoding: string; newline: string; truncated: boolean };
  archive?: ArchiveListing;
  hex?: { bytes: number[]; total: number };
}

/** Au-delà, on ne charge que le début du fichier, et on le dit. */
const TEXT_WINDOW = 64 * 1024;
/** Limite au-delà de laquelle un média n'est plus chargé pour l'aperçu. */
const MEDIA_LIMIT = 256 * 1024 * 1024;

const KIND_LABEL: Record<PreviewKind, string> = {
  text: "Texte",
  image: "Image",
  pdf: "Document PDF",
  audio: "Audio",
  video: "Vidéo",
  archive: "Archive",
  hex: "Octets bruts",
};

/** Famille détectée → forme d'aperçu. */
function kindOf(info: FileInfo): PreviewKind {
  if (info.magic === "pdf") return "pdf";
  switch (info.family) {
    case "image":
      return "image";
    case "audio":
      return "audio";
    case "video":
      return "video";
    case "archive":
      return "archive";
    default:
      return info.looksLikeText ? "text" : "hex";
  }
}

const MIME_BY_MAGIC: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  avif: "image/avif",
  tiff: "image/tiff",
  ico: "image/x-icon",
  pdf: "application/pdf",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  flac: "audio/flac",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  mp4: "video/mp4",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
};

export function FilePreviewTool(_props: ToolComponentProps) {
  const [paths, setPaths] = useState<string[]>([]);
  const action = useNativeAction<Preview>();
  const urlRef = useRef<string | undefined>(undefined);

  // Un objet binaire non révoqué garde le fichier entier en mémoire : on le
  // libère au changement d'aperçu comme au démontage.
  const release = useCallback(() => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = undefined;
    }
  }, []);
  useEffect(() => release, [release]);

  if (!isNativeAvailable()) return <NativeRequired />;

  const build = async (context: Parameters<Parameters<typeof action.execute>[0]>[0]): Promise<Preview> => {
    release();
    const path = paths[0];
    const info = await fileInfo(path);
    if (info.isDir) throw new Error("Choisissez un fichier : un dossier n'a pas d'aperçu.");
    const kind = kindOf(info);

    if (kind === "archive") {
      // Le listage lit la table des matières, jamais le contenu.
      try {
        return { info, kind, archive: await listArchive(path) };
      } catch {
        // Un `.gz` ou un `.xz` n'a pas de table des matières : il ne contient
        // qu'un flux. On retombe alors sur l'affichage brut.
        const window = await readHex(path, 0, 2048);
        return { info, kind: "hex", hex: { bytes: window.bytes, total: window.fileSize } };
      }
    }

    if (kind === "text") {
      const window = await readHex(path, 0, Math.min(TEXT_WINDOW, info.size || 1));
      const detection = detectEncoding(Uint8Array.from(window.bytes));
      return {
        info,
        kind,
        text: {
          content: detection.text,
          encoding: ENCODING_LABELS[detection.encoding],
          newline: detection.newline.dominant.toUpperCase(),
          truncated: info.size > window.bytes.length,
        },
      };
    }

    if (kind === "hex") {
      const window = await readHex(path, 0, 2048);
      return { info, kind, hex: { bytes: window.bytes, total: window.fileSize } };
    }

    if (info.size > MEDIA_LIMIT) {
      const window = await readHex(path, 0, 2048);
      return { info, kind: "hex", hex: { bytes: window.bytes, total: window.fileSize } };
    }

    context.report?.({ label: "Chargement de l'aperçu…" });
    const bytes = await readBytes(path, MEDIA_LIMIT);
    const type = MIME_BY_MAGIC[info.magic] ?? "application/octet-stream";
    const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type }));
    urlRef.current = url;
    return { info, kind, url };
  };

  return (
    <div className="space-y-4">
      <PathPicker
        mode="files"
        paths={paths}
        onChange={(next) => {
          release();
          setPaths(next);
          action.setResult(null);
        }}
        label="Choisissez un fichier à prévisualiser"
        hint="l'aperçu suit le contenu réel, pas l'extension"
        disabled={action.job.isRunning}
      />

      {paths.length > 0 && (
        <RunBar
          label="Prévisualiser"
          icon="Eye"
          running={action.job.isRunning}
          progress={action.job.progress}
          status={action.job.status}
          error={action.error}
          cancel={action.job.cancel}
          onRun={() => void action.execute(build)}
        />
      )}

      {action.result && <Rendered preview={action.result} />}
    </div>
  );
}

function Rendered({ preview }: { preview: Preview }) {
  const { info, kind } = preview;
  const inspect = toolRegistry.get("file-info");

  return (
    <div className="space-y-3" data-testid="file-preview">
      <StatGrid
        columns={4}
        stats={[
          { label: "Aperçu", value: KIND_LABEL[kind] },
          { label: "Type détecté", value: info.magicLabel },
          { label: "Taille", value: formatFileSize(info.size) },
          {
            label: "Extension cohérente",
            value: info.extensionMatches ? "oui" : "non",
            tone: info.extensionMatches ? "ok" : "warn",
          },
        ]}
      />

      {!info.extensionMatches && (
        <Callout tone="warning" title="L'extension ne correspond pas au contenu">
          Le fichier s'appelle « .{info.extension || "sans extension"} » mais contient un{" "}
          {info.magicLabel}. L'aperçu suit le contenu réel.
          {inspect && (
            <>
              {" "}
              <Link to={toolRoute(inspect.id)} className="underline underline-offset-2">
                Inspecter le fichier
              </Link>
              .
            </>
          )}
        </Callout>
      )}

      {kind === "image" && preview.url && (
        <Panel title="Image">
          <div className="flex justify-center bg-[var(--ft-surface-2)] p-3">
            <img
              src={preview.url}
              alt={info.name}
              className="max-h-[32rem] max-w-full object-contain"
            />
          </div>
        </Panel>
      )}

      {kind === "pdf" && preview.url && (
        <Panel title="Document PDF">
          <object
            data={preview.url}
            type="application/pdf"
            className="h-[36rem] w-full"
            aria-label={`Aperçu de ${info.name}`}
          >
            <p className="p-3 text-xs text-[var(--ft-text-muted)]">
              L'aperçu intégré n'est pas disponible ici. Les outils PDF de FourTout ouvrent ce
              fichier page par page.
            </p>
          </object>
        </Panel>
      )}

      {kind === "audio" && preview.url && (
        <Panel title="Audio">
          <div className="p-3">
            <audio src={preview.url} controls className="w-full" aria-label={info.name} />
          </div>
        </Panel>
      )}

      {kind === "video" && preview.url && (
        <Panel title="Vidéo">
          <div className="bg-black p-0">
            <video
              src={preview.url}
              controls
              className="max-h-[32rem] w-full"
              aria-label={info.name}
            />
          </div>
        </Panel>
      )}

      {kind === "text" && preview.text && (
        <>
          <Panel
            title={`Texte — ${preview.text.encoding}, fins de ligne ${preview.text.newline}`}
          >
            <pre className="max-h-[32rem] overflow-auto px-3 py-2 font-mono text-[12px] leading-5">
              {preview.text.content}
            </pre>
          </Panel>
          {preview.text.truncated && (
            <Callout tone="info" title="Aperçu partiel">
              Seuls les {formatFileSize(TEXT_WINDOW)} premiers du fichier sont affichés — le reste
              n'a pas été lu. Pour travailler sur le fichier entier, passez par les outils Texte.
            </Callout>
          )}
        </>
      )}

      {kind === "archive" && preview.archive && (
        <>
          <StatGrid
            columns={4}
            stats={[
              { label: "Entrées", value: preview.archive.entries.length },
              { label: "Fichiers", value: preview.archive.files },
              { label: "Taille décompressée", value: formatFileSize(preview.archive.totalSize) },
              {
                label: "Entrées refusées",
                value: preview.archive.rejected,
                tone: preview.archive.rejected > 0 ? "danger" : "neutral",
              },
            ]}
          />
          <Panel title="Contenu de l'archive (rien n'est extrait)" count={preview.archive.entries.length}>
            <ul className="max-h-96 divide-y divide-[var(--ft-rule)] overflow-y-auto text-xs">
              {preview.archive.entries.slice(0, 500).map((entry) => (
                <li key={entry.name} className="flex items-center gap-2 px-3 py-1">
                  <Icon
                    name={entry.isDir ? "FolderTree" : "File"}
                    size={13}
                    className="shrink-0 text-[var(--ft-text-faint)]"
                  />
                  <span className="min-w-0 flex-1 truncate font-mono" title={entry.name}>
                    {entry.name}
                  </span>
                  {entry.rejected && (
                    <span className="shrink-0 text-[var(--ft-danger)]">{entry.rejected}</span>
                  )}
                  {!entry.isDir && (
                    <span className="shrink-0 tabular-nums text-[var(--ft-text-muted)]">
                      {formatFileSize(entry.size)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
        </>
      )}

      {kind === "hex" && preview.hex && (
        <>
          <Panel title={`Octets bruts — ${preview.hex.bytes.length} premiers sur ${preview.hex.total.toLocaleString("fr-FR")}`}>
            <pre className="max-h-[32rem] overflow-auto px-3 py-2 font-mono text-[11px] leading-5">
              {toHexLines(preview.hex.bytes, 0).map((line) => (
                <div key={line.offset}>
                  <span className="text-[var(--ft-text-faint)]">{formatOffset(line.offset)}</span>
                  {"  "}
                  <span>{line.hex.join(" ").padEnd(47, " ")}</span>
                  {"  "}
                  <span className="text-[var(--ft-text-muted)]">{line.ascii}</span>
                </div>
              ))}
            </pre>
          </Panel>
          <Callout tone="neutral" title="Aucun aperçu visuel pour ce format">
            FourTout ne prétend pas savoir afficher ce contenu : il en montre les octets. L'outil
            « Éditer en hexadécimal » permet de le parcourir en entier.
          </Callout>
        </>
      )}
    </div>
  );
}
