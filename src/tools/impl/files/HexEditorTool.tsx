import { useCallback, useEffect, useMemo, useState } from "react";
import { NativeRequired, RunBar } from "@/components/files/NativeRun";
import { isNativeAvailable, useNativeAction } from "@/components/files/useNativeAction";
import { PathPicker } from "@/components/files/PathPicker";
import { Panel } from "@/components/files/Summary";
import { Field, Fieldset, OptionGroup, TextInput } from "@/components/pdf/Field";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Icon } from "@/components/ui/Icon";
import { formatExactBytes, formatFileSize } from "@/core/files";
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
  findAllHex,
  pickSavePath,
  readHex,
  writeHex,
  type HexWindow,
  type HexWriteSummary,
} from "@/core/files/native";
import { baseName, stemOf } from "@/core/files/paths";
import { notify } from "@/features/notifications/store";
import { revealFile } from "@/core/output/save";
import { HANDOFF_TARGETS } from "@/features/handoff/targets";
import { OpenToolButton } from "@/features/handoff/openTool";
import { useHandoffPaths } from "@/features/handoff/usePathHandoff";
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
 * - la recherche porte sur **tout le fichier**, pas sur la fenêtre affichée :
 *   elle est faite en flux côté natif, en une passe, et rend toutes les
 *   occurrences d'un coup — ce qui permet d'annoncer « 3 sur 17 » plutôt qu'un
 *   « suivante » aveugle ;
 * - la séquence trouvée est surlignée **en entier**, y compris à cheval sur
 *   deux lignes, et la fenêtre qui la contient est chargée s'il le faut ;
 * - l'enregistrement produit par défaut un **nouveau fichier**.
 *
 * La taille du fichier ne change jamais : une insertion décalerait toutes les
 * structures du fichier et produirait, neuf fois sur dix, un fichier cassé.
 */
const PAGE_SIZE = 512;

interface Search {
  /** Séquence effectivement cherchée, en octets. */
  pattern: number[];
  /** Décalages de toutes les occurrences, dans l'ordre. */
  offsets: number[];
  /** Occurrence courante, index dans `offsets`. */
  index: number;
  /** La liste a-t-elle été écourtée par la limite ? */
  truncated: boolean;
}

const FIND_LIMIT = 5000;

export function HexEditorTool({ tool }: ToolComponentProps) {
  const received = useHandoffPaths(tool.id);
  const [paths, setPaths] = useState<string[]>(received);
  const [offset, setOffset] = useState(0);
  const [window, setWindow] = useState<HexWindow | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  /** Octets modifiés mais pas encore enregistrés, par décalage absolu. */
  const [edits, setEdits] = useState<Map<number, number>>(new Map());
  const [selected, setSelected] = useState<number | null>(null);

  const [searchMode, setSearchMode] = useState<"hex" | "text">("hex");
  const [needle, setNeedle] = useState("");
  const [search, setSearch] = useState<Search | null>(null);
  const [overwrite, setOverwrite] = useState(false);

  const finding = useNativeAction<number[]>();
  const writing = useNativeAction<HexWriteSummary>();

  const path = paths[0];

  const load = useCallback(async (target: string, at: number) => {
    setLoading(true);
    setError(undefined);
    try {
      const next = await readHex(target, at, PAGE_SIZE);
      setWindow(next);
      setOffset(next.offset);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (path) void load(path, 0);
  }, [path, load]);

  /** Plage actuellement mise en évidence par la recherche. */
  const highlight = useMemo(() => {
    if (!search || search.offsets.length === 0) return null;
    const start = search.offsets[search.index];
    return { start, end: start + search.pattern.length };
  }, [search]);

  const lines = useMemo(() => {
    if (!window) return [];
    const rows: {
      offset: number;
      bytes: { offset: number; value: number; edited: boolean; matched: boolean }[];
    }[] = [];
    for (let index = 0; index < window.bytes.length; index += BYTES_PER_LINE) {
      const slice = window.bytes.slice(index, index + BYTES_PER_LINE);
      rows.push({
        offset: window.offset + index,
        bytes: slice.map((value, position) => {
          const absolute = window.offset + index + position;
          const edited = edits.has(absolute);
          return {
            offset: absolute,
            value: edited ? edits.get(absolute)! : value,
            edited,
            // Toute la séquence est surlignée, pas seulement son premier octet,
            // et le surlignage survit au passage à la ligne suivante.
            matched: highlight !== null && absolute >= highlight.start && absolute < highlight.end,
          };
        }),
      });
    }
    return rows;
  }, [window, edits, highlight]);

  if (!isNativeAvailable()) return <NativeRequired />;

  const pendingPatches = groupPatches(edits);
  const parsedNeedle = searchMode === "hex" ? parseHexBytes(needle) : asciiToBytes(needle);
  const looksHexadecimal =
    searchMode === "text" && needle.length >= 4 && /^[0-9a-f\s:,-]+$/i.test(needle);

  const jump = (to: number) => {
    if (!path || !window) return;
    const clamped = Math.max(0, Math.min(to, Math.max(0, window.fileSize - 1)));
    // On aligne sur la ligne pour que la position visée soit lisible en place.
    void load(path, clamped - (clamped % BYTES_PER_LINE));
  };

  /** Affiche l'occurrence `index`, en chargeant la fenêtre qui la contient. */
  const showOccurrence = (state: Search, index: number) => {
    const next = { ...state, index };
    setSearch(next);
    const target = state.offsets[index];
    setSelected(target);
    if (!window || target < window.offset || target >= window.offset + window.bytes.length) {
      jump(target);
    }
  };

  const runSearch = async () => {
    if (!path || !parsedNeedle || parsedNeedle.length === 0) return;
    const offsets = await finding.execute((context) =>
      findAllHex(path, parsedNeedle, FIND_LIMIT, context),
    );
    if (offsets === undefined) return;
    if (offsets.length === 0) {
      setSearch(null);
      notify.error(
        "Séquence introuvable",
        "Aucune occurrence dans l'ensemble du fichier.",
      );
      return;
    }
    showOccurrence(
      {
        pattern: parsedNeedle,
        offsets,
        index: 0,
        truncated: offsets.length >= FIND_LIMIT,
      },
      0,
    );
  };

  const step = (direction: 1 | -1) => {
    if (!search || search.offsets.length === 0) return;
    const count = search.offsets.length;
    // Le retour au début est explicite : il est annoncé, pas subi.
    const next = (search.index + direction + count) % count;
    if (direction === 1 && next === 0) notify.info("Retour au début du fichier");
    if (direction === -1 && next === count - 1) notify.info("Retour à la fin du fichier");
    showOccurrence(search, next);
  };

  const save = async () => {
    if (!path || pendingPatches.length === 0) return;
    let destination = path;
    if (!overwrite) {
      const name = baseName(path);
      const extension = name.includes(".") ? `.${name.split(".").pop()}` : "";
      const chosen = await pickSavePath(`${stemOf(name)}-modifie${extension}`);
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

  const selectedValue =
    selected !== null && window ? (edits.get(selected) ?? byteAt(window, selected)) : undefined;

  return (
    <div className="space-y-4">
      <PathPicker
        mode="files"
        paths={paths}
        onChange={(next) => {
          setPaths(next);
          setEdits(new Map());
          setSelected(null);
          setSearch(null);
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
          <Fieldset columns={3} title="Navigation et recherche">
            <Field label="Aller au décalage" hint="Décimal (1024) ou hexadécimal (0x400, 400h)">
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
            </Field>
            <Field
              label="Chercher"
              hint={
                searchMode === "hex"
                  ? "Une suite d'octets : DE AD BE EF."
                  : "Une chaîne de caractères, prise telle quelle."
              }
            >
              <OptionGroup
                ariaLabel="Nature de la séquence recherchée"
                value={searchMode}
                onChange={(next) => {
                  setSearchMode(next);
                  setSearch(null);
                }}
                options={[
                  { value: "hex", label: "Octets (hex)" },
                  { value: "text", label: "Texte" },
                ]}
              />
            </Field>
            <Field
              label="Séquence"
              hint={
                searchMode === "hex" && needle.length > 0 && !parsedNeedle
                  ? "Séquence hexadécimale incomplète ou invalide : il faut un nombre pair de chiffres."
                  : "La recherche parcourt tout le fichier, pas seulement la partie affichée."
              }
            >
              <TextInput
                value={needle}
                onChange={(event) => {
                  setNeedle(event.target.value);
                  setSearch(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void runSearch();
                }}
                placeholder={searchMode === "hex" ? "DE AD BE EF" : "FourTout"}
                aria-label="Séquence recherchée"
              />
            </Field>
          </Fieldset>

          {looksHexadecimal && (
            <Callout tone="info" title="Recherche en mode Texte">
              « {needle} » sera cherché comme une suite de caractères, pas comme des octets. Pour
              chercher les octets correspondants, basculez sur « Octets (hex) ».
            </Callout>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => jump(0)} disabled={offset === 0}>
              <Icon name="ArrowLeft" size={13} /> Début
            </Button>
            <Button
              size="sm"
              onClick={() => jump(Math.max(0, offset - PAGE_SIZE))}
              disabled={offset === 0}
            >
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
              variant="primary"
              onClick={() => void runSearch()}
              disabled={!parsedNeedle || parsedNeedle.length === 0 || finding.job.isRunning}
            >
              <Icon name="Search" size={13} />
              {finding.job.isRunning ? "Recherche…" : "Chercher dans tout le fichier"}
            </Button>
            <span className="ft-meta ml-auto tabular-nums">
              Position {formatOffset(offset)} · {formatFileSize(window.fileSize)}
            </span>
          </div>

          {search && (
            <div
              className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--ft-border)] bg-[var(--ft-surface)] px-3 py-2"
              data-testid="hex-occurrences"
            >
              <Icon name="Search" size={13} className="text-[var(--ft-accent)]" />
              <span className="text-[13px] tabular-nums">
                Occurrence <strong>{search.index + 1}</strong> sur{" "}
                <strong>{search.offsets.length}</strong>
                {search.truncated && " (liste écourtée)"} — décalage{" "}
                <code className="font-mono">{formatOffset(search.offsets[search.index])}</code>
              </span>
              <div className="ml-auto flex items-center gap-1">
                <Button
                  size="sm"
                  onClick={() => step(-1)}
                  disabled={search.offsets.length < 2}
                  aria-label="Occurrence précédente"
                >
                  <Icon name="ArrowLeft" size={13} /> Précédente
                </Button>
                <Button
                  size="sm"
                  onClick={() => step(1)}
                  disabled={search.offsets.length < 2}
                  aria-label="Occurrence suivante"
                >
                  Suivante <Icon name="ArrowRight" size={13} />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSearch(null)}>
                  Effacer
                </Button>
              </div>
            </div>
          )}

          {finding.error && (
            <Callout tone="error" title="Recherche impossible">
              {finding.error}
            </Callout>
          )}

          {/*
            L'éditeur se tient **au-dessus** de la table, à portée immédiate de
            l'octet qu'on vient de cliquer. Sous la table, il se trouvait à
            plusieurs écrans de la sélection, et personne ne le voyait.
          */}
          {selected !== null && selectedValue !== undefined ? (
            <ByteEditor
              offset={selected}
              value={selectedValue}
              original={byteAt(window, selected)}
              onChange={(value) => {
                const original = byteAt(window, selected);
                setEdits((current) => {
                  const next = new Map(current);
                  if (original === value) next.delete(selected);
                  else next.set(selected, value);
                  return next;
                });
              }}
              onClear={() => setSelected(null)}
            />
          ) : (
            <Callout tone="neutral" title="Cliquez sur un octet pour le modifier">
              La valeur choisie s'édite ici même, en hexadécimal ou en décimal. Rien n'est écrit
              sur le disque avant que vous ne l'enregistriez.
            </Callout>
          )}

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
                            data-testid={`hex-byte-${byte.offset}`}
                            data-matched={byte.matched ? "true" : undefined}
                            className={`mr-1 rounded px-0.5 ${
                              selected === byte.offset
                                ? "bg-[var(--ft-accent)] text-white"
                                : byte.matched
                                  ? "bg-[color-mix(in_oklch,var(--ft-accent)_32%,transparent)]"
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

          <p className="ft-meta tabular-nums">
            {formatExactBytes(window.fileSize)} au total · fenêtre de {window.bytes.length} octets à
            partir de {formatOffset(offset)}
          </p>

          {edits.size > 0 && (
            <>
              <Callout
                tone="warning"
                title={`${edits.size} octet(s) modifié(s), pas encore enregistré(s)`}
              >
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

          {path && (
            <div className="flex flex-wrap items-center gap-2" data-testid="hex-handoffs">
              <span className="ft-label">Continuer avec</span>
              <OpenToolButton toolId={HANDOFF_TARGETS.inspect} paths={[path]} />
              <OpenToolButton toolId={HANDOFF_TARGETS.preview} paths={[path]} />
              <OpenToolButton toolId={HANDOFF_TARGETS.hash} paths={[path]} />
            </div>
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
  original,
  onChange,
  onClear,
}: {
  offset: number;
  value: number;
  original?: number;
  onChange: (value: number) => void;
  onClear: () => void;
}) {
  const modified = original !== undefined && original !== value;
  return (
    <div
      className="rounded-[var(--radius-card)] border border-[var(--ft-accent)] bg-[var(--ft-accent-quiet)]"
      data-testid="hex-byte-editor"
    >
      <header className="flex items-center gap-2 border-b border-[var(--ft-rule)] px-3 py-1.5">
        <Icon name="Binary" size={14} className="text-[var(--ft-accent)]" />
        <h3 className="ft-section">Octet {formatOffset(offset)}</h3>
        {modified && (
          <span className="ft-meta text-[var(--ft-warn)]">
            modifié — valeur d'origine {toHexByte(original!)}
          </span>
        )}
        <div className="flex-1" />
        {modified && original !== undefined && (
          <Button size="sm" variant="ghost" onClick={() => onChange(original)}>
            Rétablir
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onClear} aria-label="Fermer l'éditeur d'octet">
          <Icon name="X" size={13} />
        </Button>
      </header>
      <div className="grid gap-x-4 gap-y-3 p-3 sm:grid-cols-3">
        <Field label="Valeur hexadécimale" hint="Deux chiffres, de 00 à FF">
          <HexByteField value={value} onChange={onChange} />
        </Field>
        <Field label="Décimal" hint="0 à 255">
          <TextInput
            value={String(value)}
            onChange={(event) => {
              const parsed = Number.parseInt(event.target.value, 10);
              if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 255) onChange(parsed);
            }}
            aria-label="Valeur décimale de l'octet"
          />
        </Field>
        <Field label="Caractère ASCII" hint="Un point quand l'octet n'est pas imprimable">
          <TextInput value={toAscii([value])} readOnly aria-label="Caractère ASCII de l'octet" />
        </Field>
      </div>
    </div>
  );
}

/**
 * Saisie hexadécimale d'un octet.
 *
 * Le champ garde sa propre chaîne le temps de la frappe : un champ entièrement
 * contrôlé sur la valeur remettrait « 1F » à chaque caractère tapé, et il
 * deviendrait impossible d'effacer pour retaper. La valeur ne remonte que
 * lorsque la saisie forme un octet complet.
 */
function HexByteField({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(() => toHexByte(value));
  const [lastSeen, setLastSeen] = useState(value);

  // La valeur a changé ailleurs (clic sur un autre octet, « Rétablir ») : la
  // saisie en cours n'a plus lieu d'être.
  if (value !== lastSeen) {
    setLastSeen(value);
    setDraft(toHexByte(value));
  }

  return (
    <TextInput
      value={draft}
      onChange={(event) => {
        const next = event.target.value.replace(/[^0-9a-fA-F]/g, "").slice(0, 2).toUpperCase();
        setDraft(next);
        const parsed = parseHexBytes(next);
        if (parsed && parsed.length === 1) {
          setLastSeen(parsed[0]);
          onChange(parsed[0]);
        }
      }}
      onBlur={() => setDraft(toHexByte(value))}
      inputMode="text"
      aria-label="Valeur hexadécimale de l'octet"
    />
  );
}
