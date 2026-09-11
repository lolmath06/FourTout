import { useCallback, useEffect, useMemo, useState } from "react";
import { NativeRequired, RunBar } from "@/components/files/NativeRun";
import { isNativeAvailable, useNativeAction } from "@/components/files/useNativeAction";
import { PathPicker } from "@/components/files/PathPicker";
import { Panel } from "@/components/files/Summary";
import { Field, Fieldset, OptionGroup, TextInput } from "@/components/pdf/Field";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Icon } from "@/components/ui/Icon";
import { formatFileSize } from "@/core/files";
import {
  asciiToBytes,
  BYTES_PER_LINE,
  formatOffset,
  groupPatches,
  parseHexBytes,
  parseOffset,
  toAscii,
  toHexByte,
} from "@/core/files/hex";
import {
  findHex,
  pickSavePath,
  readHex,
  writeHex,
  type HexWindow,
  type HexWriteSummary,
} from "@/core/files/native";
import { baseName, stemOf } from "@/core/files/paths";
import { notify } from "@/features/notifications/store";
import { revealFile } from "@/core/output/save";
import type { ToolComponentProps } from "@/tools/implementations";

/**
 * Éditeur hexadécimal **borné**.
 *
 * Ce n'est pas un éditeur binaire professionnel, et l'outil ne prétend pas
 * l'être : ni modèles de structure, ni script, ni désassemblage, ni insertion
 * d'octets. Ce qu'il fait, il le fait entièrement :
 *
 * - le fichier est lu **par fenêtres** — un fichier de 20 Go se parcourt sans
 *   que rien ne soit chargé en mémoire ;
 * - la recherche d'une séquence traverse le fichier en flux, et s'annule ;
 * - l'enregistrement produit par défaut un **nouveau fichier**. Écraser
 *   l'original est une case à cocher distincte, et une confirmation.
 *
 * La taille du fichier ne change jamais : corriger des octets se fait en place.
 * Une insertion décalerait toutes les structures du fichier et produirait, neuf
 * fois sur dix, un fichier cassé.
 */
const PAGE_SIZE = 512;

export function HexEditorTool(_props: ToolComponentProps) {
  const [paths, setPaths] = useState<string[]>([]);
  const [offset, setOffset] = useState(0);
  const [window, setWindow] = useState<HexWindow | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  /** Octets modifiés mais pas encore enregistrés, par décalage absolu. */
  const [edits, setEdits] = useState<Map<number, number>>(new Map());
  const [selected, setSelected] = useState<number | null>(null);

  const [searchMode, setSearchMode] = useState<"hex" | "text">("hex");
  const [needle, setNeedle] = useState("");
  const [overwrite, setOverwrite] = useState(false);

  const search = useNativeAction<number | null>();
  const writing = useNativeAction<HexWriteSummary>();

  const path = paths[0];

  const load = useCallback(
    async (target: string, at: number) => {
      setLoading(true);
      setError(undefined);
      try {
        setWindow(await readHex(target, at, PAGE_SIZE));
        setOffset(at);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (path) void load(path, 0);
  }, [path, load]);

  const lines = useMemo(() => {
    if (!window) return [];
    const rows: { offset: number; bytes: { offset: number; value: number; edited: boolean }[] }[] = [];
    for (let index = 0; index < window.bytes.length; index += BYTES_PER_LINE) {
      const slice = window.bytes.slice(index, index + BYTES_PER_LINE);
      rows.push({
        offset: window.offset + index,
        bytes: slice.map((value, position) => {
          const absolute = window.offset + index + position;
          const edited = edits.has(absolute);
          return { offset: absolute, value: edited ? edits.get(absolute)! : value, edited };
        }),
      });
    }
    return rows;
  }, [window, edits]);

  if (!isNativeAvailable()) return <NativeRequired />;

  const pendingPatches = groupPatches(edits);
  const parsedNeedle = searchMode === "hex" ? parseHexBytes(needle) : asciiToBytes(needle);

  const jump = (to: number) => {
    if (!path || !window) return;
    const clamped = Math.max(0, Math.min(to, Math.max(0, window.fileSize - 1)));
    void load(path, clamped - (clamped % BYTES_PER_LINE));
  };

  const runSearch = async () => {
    if (!path || !parsedNeedle || parsedNeedle.length === 0) return;
    const found = await search.execute((context) =>
      findHex(path, parsedNeedle, offset + 1, context),
    );
    if (found === undefined) return;
    if (found === null) {
      notify.error("Séquence introuvable", "Aucune occurrence après la position actuelle.");
      return;
    }
    jump(found);
    setSelected(found);
  };

  const save = async () => {
    if (!path || pendingPatches.length === 0) return;
    let destination = path;
    if (!overwrite) {
      const suggestion = `${stemOf(baseName(path))}-modifie${
        baseName(path).includes(".") ? `.${baseName(path).split(".").pop()}` : ""
      }`;
      const chosen = await pickSavePath(suggestion);
      if (!chosen) return;
      destination = chosen;
    }
    const summary = await writing.execute((context) =>
      writeHex(path, destination, pendingPatches, context),
    );
    if (!summary) return;
    setEdits(new Map());
    notify.success(
      summary.inPlace ? "Fichier modifié" : "Fichier enregistré",
      `${summary.patchedBytes} octet(s) écrit(s)`,
    );
    if (summary.inPlace) void load(path, offset);
  };

  return (
    <div className="space-y-4">
      <PathPicker
        mode="files"
        paths={paths}
        onChange={(next) => {
          setPaths(next);
          setEdits(new Map());
          setSelected(null);
          setWindow(null);
          writing.setResult(null);
        }}
        label="Choisissez un fichier"
        hint="lu par fenêtres : la taille du fichier n'a aucune importance"
      />

      {error && (
        <Callout tone="error" title="Lecture impossible">
          {error}
        </Callout>
      )}

      {window && (
        <>
          <Fieldset columns={3} title="Navigation">
            <Field label="Aller au décalage" hint="Décimal (1024) ou hexadécimal (0x400, 400h)">
              <div className="flex items-center gap-2">
                <TextInput
                  defaultValue={String(offset)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    const parsed = parseOffset((event.target as HTMLInputElement).value);
                    if (parsed !== null) jump(parsed);
                  }}
                  placeholder="0x0"
                  aria-label="Aller au décalage"
                />
              </div>
            </Field>
            <Field label="Chercher une séquence">
              <OptionGroup
                ariaLabel="Type de séquence recherchée"
                value={searchMode}
                onChange={setSearchMode}
                options={[
                  { value: "hex", label: "Hex", hint: "DE AD BE EF" },
                  { value: "text", label: "Texte", hint: "FourTout" },
                ]}
              />
            </Field>
            <Field
              label="Séquence"
              hint={
                searchMode === "hex" && needle.length > 0 && !parsedNeedle
                  ? "Séquence hexadécimale incomplète ou invalide."
                  : "La recherche part de la position actuelle."
              }
            >
              <TextInput
                value={needle}
                onChange={(event) => setNeedle(event.target.value)}
                placeholder={searchMode === "hex" ? "DE AD BE EF" : "FourTout"}
                aria-label="Séquence recherchée"
              />
            </Field>
          </Fieldset>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => jump(0)} disabled={offset === 0}>
              <Icon name="ArrowLeft" size={13} /> Début
            </Button>
            <Button size="sm" onClick={() => jump(Math.max(0, offset - PAGE_SIZE))} disabled={offset === 0}>
              Précédent
            </Button>
            <Button
              size="sm"
              onClick={() => jump(offset + PAGE_SIZE)}
              disabled={offset + PAGE_SIZE >= window.fileSize}
            >
              Suivant
            </Button>
            <Button
              size="sm"
              onClick={() => jump(Math.max(0, window.fileSize - PAGE_SIZE))}
              disabled={offset + PAGE_SIZE >= window.fileSize}
            >
              Fin <Icon name="ArrowRight" size={13} />
            </Button>
            <Button
              size="sm"
              onClick={() => void runSearch()}
              disabled={!parsedNeedle || parsedNeedle.length === 0 || search.job.isRunning}
            >
              <Icon name="Search" size={13} />
              {search.job.isRunning ? "Recherche…" : "Chercher la suivante"}
            </Button>
            <span className="ft-meta ml-auto tabular-nums">
              Position {formatOffset(offset)} · {formatFileSize(window.fileSize)} (
              {window.fileSize.toLocaleString("fr-FR")} octets)
            </span>
          </div>

          <Panel title="Octets" testId="hex-view">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse font-mono text-[11px] leading-5">
                <tbody>
                  {lines.map((line) => (
                    <tr key={line.offset} className="border-t border-[var(--ft-rule)]">
                      <td className="whitespace-nowrap px-3 py-0.5 text-[var(--ft-text-faint)]">
                        {formatOffset(line.offset)}
                      </td>
                      <td className="whitespace-nowrap px-2 py-0.5">
                        {line.bytes.map((byte) => (
                          <button
                            key={byte.offset}
                            type="button"
                            onClick={() => setSelected(byte.offset)}
                            aria-label={`Octet ${byte.offset}, valeur ${toHexByte(byte.value)}`}
                            className={`mr-1 rounded px-0.5 ${
                              selected === byte.offset
                                ? "bg-[var(--ft-accent)] text-white"
                                : byte.edited
                                  ? "bg-[color-mix(in_oklch,var(--ft-warn)_28%,transparent)]"
                                  : "hover:bg-[var(--ft-hover)]"
                            }`}
                          >
                            {toHexByte(byte.value)}
                          </button>
                        ))}
                      </td>
                      <td className="whitespace-pre px-3 py-0.5 text-[var(--ft-text-muted)]">
                        {toAscii(line.bytes.map((byte) => byte.value))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          {selected !== null && (
            <ByteEditor
              offset={selected}
              value={edits.get(selected) ?? byteAt(window, selected) ?? 0}
              onChange={(value) => {
                const original = byteAt(window, selected);
                setEdits((current) => {
                  const next = new Map(current);
                  if (original === value) next.delete(selected);
                  else next.set(selected, value);
                  return next;
                });
              }}
            />
          )}

          {edits.size > 0 && (
            <>
              <Callout tone="warning" title={`${edits.size} octet(s) modifié(s), pas encore enregistré(s)`}>
                Rien n'a été écrit sur le disque. Les modifications tiennent en{" "}
                {pendingPatches.length} plage(s) contiguë(s).
              </Callout>

              <Fieldset columns={1} title="Enregistrement">
                <Field
                  label="Destination"
                  hint={
                    overwrite
                      ? "L'original sera modifié sur place. Il n'y aura pas de retour en arrière."
                      : "Le fichier d'origine reste intact : vous choisirez où écrire la copie modifiée."
                  }
                >
                  <OptionGroup
                    ariaLabel="Destination de l'enregistrement"
                    value={overwrite ? "in-place" : "copy"}
                    onChange={(value) => setOverwrite(value === "in-place")}
                    options={[
                      { value: "copy", label: "Enregistrer sous…" },
                      { value: "in-place", label: "Écraser l'original" },
                    ]}
                  />
                </Field>
              </Fieldset>

              {overwrite && (
                <Callout tone="error" title="L'original sera écrasé">
                  Les {edits.size} octet(s) seront réécrits directement dans{" "}
                  <code className="font-mono">{path}</code>. Aucune copie de secours n'est faite.
                </Callout>
              )}

              <RunBar
                label={overwrite ? "Écraser l'original" : "Enregistrer sous…"}
                icon="Save"
                danger={overwrite}
                running={writing.job.isRunning}
                progress={writing.job.progress}
                status={writing.job.status}
                error={writing.error}
                cancel={writing.job.cancel}
                onRun={() => void save()}
                secondary={
                  <button
                    type="button"
                    onClick={() => setEdits(new Map())}
                    className="text-xs text-[var(--ft-text-muted)] underline-offset-2 hover:underline"
                  >
                    Annuler toutes les modifications
                  </button>
                }
              />
            </>
          )}

          {search.error && (
            <Callout tone="error" title="Recherche impossible">
              {search.error}
            </Callout>
          )}

          {writing.result && (
            <Callout
              tone="success"
              title={writing.result.inPlace ? "Original modifié" : "Copie modifiée enregistrée"}
              actions={
                <Button size="sm" onClick={() => revealFile(writing.result!.path)}>
                  <Icon name="FolderTree" size={13} /> Ouvrir l'emplacement
                </Button>
              }
            >
              {writing.result.patchedBytes} octet(s) écrit(s) dans{" "}
              <code className="font-mono">{writing.result.path}</code>. La taille du fichier est
              inchangée ({formatFileSize(writing.result.size)}).
            </Callout>
          )}
        </>
      )}

      {loading && !window && <p className="ft-meta">Lecture…</p>}
    </div>
  );
}

function byteAt(window: HexWindow, absolute: number): number | undefined {
  const index = absolute - window.offset;
  return index >= 0 && index < window.bytes.length ? window.bytes[index] : undefined;
}

function ByteEditor({
  offset,
  value,
  onChange,
}: {
  offset: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <Fieldset columns={3} title={`Octet ${formatOffset(offset)}`}>
      <Field label="Valeur hexadécimale" hint="Deux chiffres, de 00 à FF">
        <TextInput
          value={toHexByte(value)}
          onChange={(event) => {
            const parsed = parseHexBytes(event.target.value);
            if (parsed && parsed.length === 1) onChange(parsed[0]);
          }}
          maxLength={2}
          aria-label="Valeur hexadécimale de l'octet"
        />
      </Field>
      <Field label="Décimal">
        <TextInput value={String(value)} readOnly aria-label="Valeur décimale de l'octet" />
      </Field>
      <Field label="Caractère ASCII">
        <TextInput value={toAscii([value])} readOnly aria-label="Caractère ASCII de l'octet" />
      </Field>
    </Fieldset>
  );
}
