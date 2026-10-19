import { useEffect, useMemo, useState } from "react";
import { toolName } from "@/core/tools/localized";
import { toolRegistry } from "@/core/tools/registry";
import { useNavigate } from "react-router-dom";
import { FileDropZone } from "@/components/files/FileDropZone";
import { PathPicker } from "@/components/files/PathPicker";
import { Callout } from "@/components/ui/Callout";
import { Icon } from "@/components/ui/Icon";
import { EmptyState } from "@/components/ui/EmptyState";
import { describeFile, extensionOf, formatFileSize, type SelectedFile } from "@/core/files";
import { KIND_LABELS } from "@/core/convert/graph";
import {
  NOTE_LABELS,
  NO_CAPABILITIES,
  planActions,
  type Capabilities,
  type ConversionAction,
  type MediaFacts,
  type PlanNote,
} from "@/core/convert/actions";
import { identifyFile, identifyPath, identityFromExtension, UNKNOWN_FORMAT, type Identity } from "@/core/convert/identity";
import { fileInfo, readBytes } from "@/core/files/native";
import { baseName } from "@/core/files/paths";
import { nativeImageFormats, probeMediaPath } from "@/core/internet/native";
import { availableEncoders } from "@/core/media/client";
import { parseProbe } from "@/core/media/types";
import { isTauri } from "@/core/platform";
import { setHandoff } from "@/features/handoff/store";
import { toolRoute, type DataKind } from "@/core/tools/types";
import type { ToolComponentProps } from "@/tools/implementations";
import { localized, t, tx } from "@/i18n";

/**
 * Convertisseur universel.
 *
 * Il **ne convertit rien lui-même**. Il établit ce qu'est le fichier — d'après
 * son **contenu**, jamais seulement son nom —, demande ce que FourTout sait
 * réellement en faire (registre, flux présents, capacités vérifiées de cette
 * machine), puis ouvre l'outil spécialisé avec le fichier déjà chargé et la
 * destination déjà choisie. Un seul chemin de code par conversion : celui de
 * l'outil dédié.
 */
interface Source {
  name: string;
  size: number;
  extension: string;
  path?: string;
  file?: File;
}

const NOTE_ICONS = localized(() => ({
  "extension-mismatch": "TriangleAlert",
  animated: "Images",
  sequence: "TriangleAlert",
  "avif-unavailable": "Info",
  "heic-unavailable": "Info",
  "no-ffmpeg": "Info",
  "no-video-stream": "Info",
  "no-audio-stream": "Info",
}));

function noteText(note: PlanNote): string {
  if (note.kind === "extension-mismatch") {
    return t("Ce fichier se nomme « .{named} » mais contient {actual} : FourTout se fie au contenu.", { named: note.named, actual: note.actual });
  }
  return tx(NOTE_LABELS[note.kind]);
}

export function UniversalConverterTool(_props: ToolComponentProps) {
  const native = isTauri();
  const [source, setSource] = useState<Source | null>(null);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [facts, setFacts] = useState<MediaFacts | undefined>();
  const [caps, setCaps] = useState<Capabilities>(NO_CAPABILITIES);
  const [error, setError] = useState<string | undefined>();
  const navigate = useNavigate();

  // Capacités de cette machine, vérifiées une fois (décodage réel d'échantillons).
  useEffect(() => {
    if (!native) return;
    let alive = true;
    void Promise.all([nativeImageFormats(), availableEncoders()]).then(([formats, encoders]) => {
      if (!alive) return;
      setCaps({
        native: true,
        ffmpeg: formats.ffmpeg,
        avif: formats.avif,
        heic: formats.heic,
        webpAnimated: encoders.includes("libwebp_anim") || encoders.includes("libwebp"),
      });
    });
    return () => {
      alive = false;
    };
  }, [native]);

  // Identité (contenu) puis flux (ffprobe) du fichier retenu.
  useEffect(() => {
    setIdentity(null);
    setFacts(undefined);
    setError(undefined);
    if (!source) return;
    let alive = true;
    (async () => {
      const found = source.path
        ? await identifyPath(source.path, source.extension)
        : source.file
          ? await identifyFile(source.file, source.extension)
          : identityFromExtension(source.extension);
      if (!alive) return;
      setIdentity(found);
      if (native && source.path && (found.family === "video" || found.family === "audio")) {
        try {
          const info = parseProbe(await probeMediaPath(source.path));
          if (alive) setFacts({ hasVideo: info.hasVideo, hasAudio: info.hasAudio });
        } catch {
          /* ffprobe indisponible : on propose ce que l'extension permet */
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [source, native]);

  const plan = useMemo(
    () => (identity && source ? planActions(identity, source.extension, facts, caps) : null),
    [identity, source, facts, caps],
  );
  const grouped = useMemo(() => groupByKind(plan?.actions ?? []), [plan]);

  const choose = (next: SelectedFile[]) => {
    const file = next[0];
    setSource(file ? { name: file.name, size: file.size, extension: file.extension, file: file.file } : null);
  };

  const choosePath = async (paths: string[]) => {
    const path = paths[0];
    if (!path) {
      setSource(null);
      return;
    }
    try {
      const info = await fileInfo(path);
      setSource({ name: info.name, size: info.size, extension: info.extension || extensionOf(baseName(path)), path });
    } catch (e) {
      setSource(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const open = async (action: ConversionAction) => {
    if (!source) return;
    setError(undefined);
    try {
      if (action.transport === "path") {
        if (!source.path) throw new Error(t("Cette conversion lit le fichier directement sur le disque : choisissez-le avec l'explorateur de l'application."));
        setHandoff({ toolId: action.toolId, paths: [source.path], preset: action.preset });
      } else {
        let selected: SelectedFile;
        if (source.file) {
          selected = describeFile(source.file);
        } else if (source.path) {
          const bytes = await readBytes(source.path);
          selected = describeFile(new File([bytes as BlobPart], source.name));
        } else {
          throw new Error(t("Fichier illisible."));
        }
        setHandoff({ toolId: action.toolId, files: [selected], preset: action.preset });
      }
      navigate(toolRoute(action.toolId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="space-y-4">
      {native ? (
        <PathPicker
          mode="files"
          paths={source?.path ? [source.path] : []}
          onChange={(paths) => void choosePath(paths)}
          label={t("Déposez un fichier")}
          hint={t("FourTout regarde le contenu du fichier, pas seulement son nom, et propose les conversions réellement disponibles.")}
        />
      ) : (
        <FileDropZone
          constraints={{ inputs: [], maxFiles: 1 }}
          files={source?.file ? [describeFile(source.file)] : []}
          onChange={choose}
          label={t("Déposez un fichier")}
          hint={t("FourTout identifie le format et propose les conversions réellement disponibles.")}
          // La ligne de détection ci-dessous décrit déjà le fichier retenu.
          showFileList={false}
        />
      )}

      {source && (
        <div
          data-testid="converter-detection"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface-2)] px-2.5 py-1.5 text-[13px]"
        >
          <span className="flex items-center gap-1.5 font-medium">
            <Icon name="FileSearch" size={14} />
            {identity && identity.basis === "content" ? tx(identity.label) : source.extension ? source.extension.toUpperCase() : tx(UNKNOWN_FORMAT)}
          </span>
          <span className="text-[var(--ft-text-muted)]">{source.name}</span>
          <span className="ft-value text-[var(--ft-text-muted)]">{formatFileSize(source.size)}</span>
          <span className="ft-value text-[var(--ft-text-faint)]">{identity?.mime ?? source.file?.type ?? ""}</span>
          {identity && (
            <span className="ft-value text-[var(--ft-text-faint)]">
              {identity.basis === "content" ? t("identifié par son contenu") : t("identifié par son nom")}
            </span>
          )}
        </div>
      )}

      {error && <Callout tone="error" title={t("Ouverture impossible")}>{error}</Callout>}

      {plan?.notes.map((note) => (
        <Callout key={note.kind} tone={note.kind === "extension-mismatch" || note.kind === "sequence" ? "warning" : "neutral"} icon={tx(NOTE_ICONS[note.kind])} data-testid={`note-${note.kind}`}>
          {noteText(note)}
        </Callout>
      ))}

      {source && identity && plan && plan.actions.length === 0 && (
        <EmptyState
          icon="Shuffle"
          title={t("Aucune conversion disponible pour ce format")}
          description={t("FourTout ne propose pour l'instant aucune conversion depuis « {value} ». Les outils encore prévus n'apparaissent jamais ici : seule une conversion réellement implémentée est proposée.", {
            value: source.extension || (identity.basis === "content" ? tx(identity.label) : t("ce type de fichier")),
          })}
        />
      )}

      {plan && plan.actions.length > 0 && (
        <div className="space-y-4">
          <p className="text-sm font-medium">{identity?.id === "iso" ? t("Que faire de cette image") : t("Convertir vers")}</p>
          {grouped.map(([kind, entries]) => (
            <div key={kind}>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-[var(--ft-text-faint)]">
                {tx(KIND_LABELS[kind])}
              </p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {entries.map((action) => {
                  const tool = toolRegistry.get(action.toolId);
                  return (
                    <button
                      key={action.key}
                      type="button"
                      data-testid={`convert-to-${action.to}`}
                      onClick={() => void open(action)}
                      className="flex items-start gap-2.5 rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)] px-3 py-2.5 text-left transition-colors hover:border-[var(--ft-accent)]"
                    >
                      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-[var(--ft-surface-2)] text-[var(--ft-text-muted)]">
                        <Icon name={tool?.icon ?? "Shuffle"} size={16} />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{actionLabel(action)}</span>
                        <span className="block truncate text-xs text-[var(--ft-text-muted)]">{tool ? toolName(tool) : action.toolId}</span>
                      </span>
                      <Icon name="ArrowRight" size={15} className="ml-auto mt-1 shrink-0 text-[var(--ft-text-faint)]" />
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <p className="flex items-start gap-2 text-xs text-[var(--ft-text-muted)]">
            <Icon name="Info" size={13} className="mt-px shrink-0" />
            {t("Le bouton ouvre l'outil spécialisé avec votre fichier déjà chargé et le format présélectionné : les réglages fins (qualité, codec, résolution) restent disponibles.")}
          </p>
        </div>
      )}
    </div>
  );
}

const SPECIAL_LABELS = localized(() => ({
  inspect: t("Inspecter"),
  extract: t("Extraire"),
  frames: t("Images (PNG)"),
}));

function actionLabel(action: ConversionAction): string {
  const special = SPECIAL_LABELS[action.to as keyof typeof SPECIAL_LABELS];
  return special ? tx(special) : action.to.toUpperCase();
}

function groupByKind(actions: ConversionAction[]): [DataKind, ConversionAction[]][] {
  const order: DataKind[] = ["image", "video", "audio", "pdf", "document", "text", "data", "archive", "folder", "url", "none"];
  const groups = new Map<DataKind, ConversionAction[]>();
  for (const action of actions) {
    const list = groups.get(action.kind);
    if (list) list.push(action);
    else groups.set(action.kind, [action]);
  }
  return [...groups.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
}
