import { useCallback, useEffect, useRef, useState } from "react";
import {
  NativeRequired,
  RunBar,
} from "@/components/files/NativeRun";
import { isNativeAvailable, useNativeAction } from "@/components/files/useNativeAction";
import { PathPicker } from "@/components/files/PathPicker";
import { Panel, StatGrid } from "@/components/files/Summary";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Icon } from "@/components/ui/Icon";
import { usePdfPage } from "@/components/pdf/usePdfPage";
import { describeFile, formatFileSize, formatSizeWithExact } from "@/core/files";
import { formatOffset, toHexLines } from "@/core/files/hex";
import { baseName } from "@/core/files/paths";
import { inspectPdf } from "@/core/pdf/document";
import type { PdfSource } from "@/core/pdf/types";
import {
  fileInfo,
  listArchive,
  readBytes,
  readHex,
  type ArchiveListing,
  type FileInfo,
} from "@/core/files/native";
import { detectEncoding, ENCODING_LABELS } from "@/core/text/encoding";
import { acceptsPathHandoff, HANDOFF_TARGETS, specialistFor } from "@/features/handoff/targets";
import { toolRegistry } from "@/core/tools/registry";
import { OpenToolButton } from "@/features/handoff/openTool";
import { useHandoffPaths } from "@/features/handoff/usePathHandoff";
import type { ToolComponentProps } from "@/tools/implementations";

/**
 * Aperçu universel.
 *
 * Trois règles gouvernent cet outil.
 *
 * **L'aperçu suit le contenu, pas l'extension.** La famille vient de la
 * signature relevée par le moteur d'inspection ; un `.jpg` qui contient un PNG
 * s'affiche quand même, et le type employé pour le construire est le type
 * réel — un objet binaire étiqueté `image/jpeg` sur des octets PNG ne
 * s'afficherait pas.
 *
 * **Aucun nouveau décodeur.** Les images, l'audio et la vidéo passent par les
 * lecteurs du système déjà présents dans la WebView ; le PDF par le moteur de
 * rendu de FourTout (`usePdfPage`, celui des outils PDF visuels) ; le texte par
 * le moteur d'encodage de la phase 8 ; les archives par le moteur de listage
 * natif ; le reste par l'affichage hexadécimal.
 *
 * **Un aperçu mène quelque part.** Regarder un fichier donne presque toujours
 * envie d'en faire quelque chose : les outils spécialisés sont proposés avec
 * le fichier déjà transmis, pas sous forme de conseil à suivre à la main.
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
  pdf?: { source: PdfSource; pages: number; encrypted: boolean };
  /**
   * Octets déjà lus, conservés tant que l'aperçu est ouvert.
   *
   * Ils servent à passer la main aux outils qui travaillent sur des **fichiers
   * chargés** (PDF, image, média) plutôt que sur des chemins : sans eux, le
   * bouton « Continuer avec » rouvrirait un outil vide, et l'utilisateur
   * devrait redéposer son fichier.
   */
  bytes?: Uint8Array;
}

/** Au-delà, seul le début du fichier est chargé, et l'aperçu le dit. */
const TEXT_WINDOW = 64 * 1024;
/** Limite au-delà de laquelle un média n'est plus chargé pour l'aperçu. */
const MEDIA_LIMIT = 256 * 1024 * 1024;
/** Limite d'un PDF ouvert dans l'aperçu. */
const PDF_LIMIT = 64 * 1024 * 1024;

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
    case "text":
      // Reconnue par sa marque d'ordre des octets : c'est du texte, même si
      // un octet sur deux y est nul.
      return "text";
    default:
      return info.looksLikeText ? "text" : "hex";
  }
}

/**
 * Type de contenu employé pour construire l'objet binaire.
 *
 * Il vient du **type réel**, jamais de l'extension : c'est ce qui permet à un
 * PNG nommé `.jpg` de s'afficher. Un navigateur sait souvent renifler seul,
 * mais pas toujours — et se reposer là-dessus reviendrait à annuler le travail
 * de détection qu'on vient de faire.
 */
const MIME_BY_MAGIC: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  avif: "image/avif",
  heic: "image/heic",
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
  webm: "video/webm",
  avi: "video/x-msvideo",
};

export function FilePreviewTool({ tool }: ToolComponentProps) {
  const received = useHandoffPaths(tool.id);
  const [paths, setPaths] = useState<string[]>(received);
  const action = useNativeAction<Preview>();
  const urlRef = useRef<string | undefined>(undefined);
  const [autoRan, setAutoRan] = useState(false);

  // Un objet binaire non révoqué garde le fichier entier en mémoire : on le
  // libère au changement d'aperçu comme au démontage.
  const release = useCallback(() => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = undefined;
    }
  }, []);
  useEffect(() => release, [release]);

  const build = useCallback(
    async (
      path: string,
      context: { report?: (progress: { label?: string }) => void },
    ): Promise<Preview> => {
      release();
      const info = await fileInfo(path);
      if (info.isDir) throw new Error("Choisissez un fichier : un dossier n'a pas d'aperçu.");
      const kind = kindOf(info);

      if (kind === "archive") {
        try {
          // Le listage lit la table des matières, jamais le contenu.
          return { info, kind, archive: await listArchive(path) };
        } catch {
          // Un `.gz` ou un `.xz` n'a pas de table des matières : il ne contient
          // qu'un flux. On retombe alors sur l'affichage brut.
          const window = await readHex(path, 0, 2048);
          return { info, kind: "hex", hex: { bytes: window.bytes, total: window.fileSize } };
        }
      }

      if (kind === "text") {
        const window = await readHex(path, 0, Math.min(TEXT_WINDOW, Math.max(info.size, 1)));
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

      if (kind === "pdf") {
        if (info.size > PDF_LIMIT) {
          const window = await readHex(path, 0, 2048);
          return { info, kind: "hex", hex: { bytes: window.bytes, total: window.fileSize } };
        }
        context.report?.({ label: "Ouverture du document…" });
        const bytes = await readBytes(path, PDF_LIMIT);
        const source: PdfSource = { name: baseName(path), bytes };
        const description = await inspectPdf(source);
        return {
          info,
          kind,
          bytes,
          pdf: { source, pages: description.pageCount, encrypted: description.encrypted },
        };
      }

      if (kind === "hex" || info.size > MEDIA_LIMIT) {
        const window = await readHex(path, 0, 2048);
        return { info, kind: "hex", hex: { bytes: window.bytes, total: window.fileSize } };
      }

      context.report?.({ label: "Chargement de l'aperçu…" });
      const bytes = await readBytes(path, MEDIA_LIMIT);
      const type = MIME_BY_MAGIC[info.magic] ?? "application/octet-stream";
      const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type }));
      urlRef.current = url;
      return { info, kind, url, bytes };
    },
    [release],
  );

  // Fichier reçu d'un autre outil : on l'ouvre sans faire recliquer.
  useEffect(() => {
    if (autoRan || received.length === 0) return;
    setAutoRan(true);
    void action.execute((context) => build(received[0], context));
  }, [autoRan, received, action, build]);

  if (!isNativeAvailable()) return <NativeRequired />;

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
          onRun={() => void action.execute((context) => build(paths[0], context))}
        />
      )}

      {action.result && <Rendered preview={action.result} />}
    </div>
  );
}

function Rendered({ preview }: { preview: Preview }) {
  const { info, kind } = preview;
  const specialist = specialistFor(info.family, info.magic);

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
          {info.magicLabel}. L'aperçu ci-dessous suit le contenu réel.
        </Callout>
      )}

      {/* Les outils qui savent faire quelque chose de ce fichier, avec le
          fichier déjà transmis. */}
      <div className="flex flex-wrap items-center gap-2" data-testid="preview-handoffs">
        <span className="ft-label">Continuer avec</span>
        <Relay toolId={HANDOFF_TARGETS.inspect} preview={preview} />
        {specialist && <Relay toolId={specialist} preview={preview} variant="primary" />}
        {kind === "archive" && (
          <Relay toolId={HANDOFF_TARGETS.archiveExtract} preview={preview} />
        )}
        {kind === "pdf" && <Relay toolId={HANDOFF_TARGETS.pdfExtractText} preview={preview} />}
        <Relay toolId={HANDOFF_TARGETS.hexEdit} preview={preview} />
      </div>

      {kind === "image" && preview.url && <ImagePanel url={preview.url} info={info} />}

      {kind === "pdf" && preview.pdf && <PdfPanel pdf={preview.pdf} />}

      {kind === "audio" && preview.url && (
        <Panel title="Audio">
          <div className="p-3">
            <audio src={preview.url} controls className="w-full" aria-label={info.name} />
          </div>
        </Panel>
      )}

      {kind === "video" && preview.url && (
        <Panel title="Vidéo">
          <div className="bg-black">
            <video src={preview.url} controls className="max-h-[32rem] w-full" aria-label={info.name} />
          </div>
        </Panel>
      )}

      {kind === "text" && preview.text && (
        <>
          <Panel title={`Texte — ${preview.text.encoding}, fins de ligne ${preview.text.newline}`}>
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

      {kind === "archive" && preview.archive && <ArchivePanel listing={preview.archive} />}

      {kind === "hex" && preview.hex && (
        <>
          <Panel
            title={`Octets bruts — ${preview.hex.bytes.length} premiers sur ${preview.hex.total.toLocaleString("fr-FR")}`}
          >
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
            FourTout ne prétend pas savoir afficher ce contenu : il en montre les octets. L'éditeur
            hexadécimal permet de le parcourir en entier.
          </Callout>
        </>
      )}
    </div>
  );
}

/**
 * Panneau image.
 *
 * Le fond en damier et le cadre sont là pour une raison précise : sans eux,
 * une image très petite ou transparente est indiscernable d'un panneau vide,
 * et l'on ne sait pas si l'aperçu a échoué. Les dimensions réelles sont
 * affichées dès que le navigateur les connaît.
 */
function ImagePanel({ url, info }: { url: string; info: FileInfo }) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [failed, setFailed] = useState(false);

  return (
    <Panel
      title={size ? `Image — ${size.width} × ${size.height} pixels` : "Image"}
      testId="preview-image"
    >
      {failed ? (
        <div className="p-3">
          <Callout tone="error" title="Ce contenu n'a pas pu être affiché">
            Les octets ont bien été lus ({formatSizeWithExact(info.size)}) et reconnus comme{" "}
            {info.magicLabel}, mais le moteur d'affichage du système n'en a rien fait. Le fichier
            est probablement endommagé — l'éditeur hexadécimal permet de le vérifier.
          </Callout>
        </div>
      ) : (
        <div
          className="flex min-h-40 items-center justify-center p-4"
          style={{
            // Damier discret : une image transparente reste visible dessus.
            backgroundImage:
              "linear-gradient(45deg, var(--ft-surface-2) 25%, transparent 25%), linear-gradient(-45deg, var(--ft-surface-2) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--ft-surface-2) 75%), linear-gradient(-45deg, transparent 75%, var(--ft-surface-2) 75%)",
            backgroundSize: "16px 16px",
            backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0",
          }}
        >
          <img
            src={url}
            alt={info.name}
            data-testid="preview-image-element"
            onLoad={(event) =>
              setSize({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              })
            }
            onError={() => setFailed(true)}
            className="max-h-[32rem] max-w-full border border-[var(--ft-border)] bg-white object-contain"
            style={{
              // Une image minuscule doit rester visible : on lui donne un
              // plancher d'affichage, sans jamais agrandir au-delà du raisonnable.
              minWidth: 48,
              minHeight: 48,
              imageRendering:
                size && Math.max(size.width, size.height) < 64 ? "pixelated" : undefined,
            }}
          />
        </div>
      )}
    </Panel>
  );
}

/**
 * Panneau PDF : la page est rendue par le **moteur de FourTout**, celui des
 * outils PDF visuels. Aucun second moteur, et aucun renvoi vers un aperçu
 * intégré qui n'existe pas dans cette WebView.
 */
function PdfPanel({ pdf }: { pdf: { source: PdfSource; pages: number; encrypted: boolean } }) {
  const [page, setPage] = useState(1);
  const rendered = usePdfPage(pdf.encrypted ? undefined : pdf.source, page, 900);

  if (pdf.encrypted) {
    return (
      <Callout tone="warning" title="Document protégé par mot de passe">
        Le contenu ne peut pas être rendu sans le mot de passe. L'outil « Déverrouiller un PDF »
        s'en charge.
      </Callout>
    );
  }

  return (
    <Panel
      title={`Document PDF — page ${page} sur ${pdf.pages}`}
      testId="preview-pdf"
      actions={
        pdf.pages > 1 && (
          <span className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page <= 1}
              aria-label="Page précédente"
            >
              <Icon name="ArrowLeft" size={13} />
            </Button>
            <span className="ft-meta tabular-nums">
              {page} / {pdf.pages}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setPage((current) => Math.min(pdf.pages, current + 1))}
              disabled={page >= pdf.pages}
              aria-label="Page suivante"
            >
              <Icon name="ArrowRight" size={13} />
            </Button>
          </span>
        )
      }
    >
      <div className="flex min-h-64 items-center justify-center bg-[var(--ft-surface-2)] p-4">
        {rendered.loading && <p className="ft-meta">Rendu de la page…</p>}
        {rendered.error && (
          <Callout tone="error" title="Page illisible">
            {rendered.error}
          </Callout>
        )}
        {rendered.url && (
          <img
            src={rendered.url}
            alt={`Page ${page} de ${pdf.source.name}`}
            data-testid="preview-pdf-page"
            className="max-h-[36rem] max-w-full border border-[var(--ft-border)] bg-white object-contain shadow-sm"
          />
        )}
      </div>
    </Panel>
  );
}


/**
 * Bouton de passage de relais qui choisit **la bonne forme de transfert**.
 *
 * Les outils Fichiers reçoivent un chemin ; les outils PDF, image et média
 * reçoivent un fichier déjà lu. Se tromper de forme donne un lien qui navigue
 * bien mais ouvre un écran vide — le défaut qui a justement été signalé.
 */
function Relay({
  toolId,
  preview,
  variant,
}: {
  toolId: string;
  preview: Preview;
  variant?: "primary" | "secondary";
}) {
  const target = toolRegistry.get(toolId);
  if (!target) return null;

  if (acceptsPathHandoff(target)) {
    return <OpenToolButton toolId={toolId} paths={[preview.info.path]} variant={variant} />;
  }
  // Outil qui attend un fichier chargé : sans octets en main, mieux vaut ne
  // rien proposer que proposer un bouton qui ouvre le vide.
  if (!preview.bytes) return null;
  const file = new File([preview.bytes as unknown as BlobPart], preview.info.name, {
    type: MIME_BY_MAGIC[preview.info.magic] ?? "application/octet-stream",
  });
  return (
    <OpenToolButton toolId={toolId} files={[describeFile(file)]} variant={variant} />
  );
}

function ArchivePanel({ listing }: { listing: ArchiveListing }) {
  return (
    <>
      <StatGrid
        columns={4}
        stats={[
          { label: "Entrées", value: listing.entries.length },
          { label: "Fichiers", value: listing.files },
          { label: "Taille décompressée", value: formatFileSize(listing.totalSize) },
          {
            label: "Entrées refusées",
            value: listing.rejected,
            tone: listing.rejected > 0 ? "danger" : "neutral",
          },
        ]}
      />
      <Panel
        title="Contenu de l'archive (rien n'est extrait)"
        count={listing.entries.length}
        testId="preview-archive"
      >
        <ul className="max-h-96 divide-y divide-[var(--ft-rule)] overflow-y-auto text-xs">
          {listing.entries.slice(0, 500).map((entry) => (
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
  );
}
