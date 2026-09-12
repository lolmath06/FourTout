import { useMemo, useState } from "react";
import { NativeRequired, RunBar } from "@/components/files/NativeRun";
import { isNativeAvailable, useNativeAction } from "@/components/files/useNativeAction";
import { PathPicker } from "@/components/files/PathPicker";
import { EntryDiff } from "@/components/files/EntryDiff";
import { Panel, StatGrid, Warnings } from "@/components/files/Summary";
import { Field, Fieldset, OptionGroup } from "@/components/pdf/Field";
import { CheckOption } from "@/components/text/TextToolShell";
import { Callout } from "@/components/ui/Callout";
import { Icon } from "@/components/ui/Icon";
import { formatFileSize } from "@/core/files";
import { joinPath } from "@/core/files/paths";
import {
  compareFolders,
  DEFAULT_WALK_OPTIONS,
  type CompareEntryStatus,
  type CompareMode,
  type FolderCompareReport,
} from "@/core/files/native";
import type { ToolComponentProps } from "@/tools/implementations";

/**
 * Comparaison de deux arborescences.
 *
 * Le choix du mode est le cœur de l'outil, et l'interface refuse de le rendre
 * invisible : en mode rapide, deux fichiers de même taille sont affichés comme
 * « probablement identiques », pas comme identiques. Dire « identique » sans
 * avoir lu un octet serait une affirmation que l'outil n'a pas les moyens de
 * tenir — et c'est précisément le cas où l'utilisateur se ferait avoir.
 */
const MODES: { value: CompareMode; label: string; hint: string }[] = [
  {
    value: "quick",
    label: "Rapide",
    hint: "Compare type et taille. Aucun octet n'est lu : deux fichiers de même taille ne sont pas départagés.",
  },
  {
    value: "reliable",
    label: "Fiable",
    hint: "Confirme l'égalité par le contenu (SHA-256). Seuls les fichiers de même taille sont relus.",
  },
];

const STATUS_ORDER: CompareEntryStatus[] = [
  "different",
  "left-only",
  "right-only",
  "type-conflict",
  "same",
];

const STATUS_LABEL: Record<CompareEntryStatus, string> = {
  different: "Différent",
  "left-only": "Gauche seulement",
  "right-only": "Droite seulement",
  "type-conflict": "Conflit de type",
  same: "Identique",
};

const STATUS_COLOR: Record<CompareEntryStatus, string> = {
  different: "var(--ft-warn)",
  "left-only": "var(--ft-accent)",
  "right-only": "var(--ft-accent)",
  "type-conflict": "var(--ft-danger)",
  same: "var(--ft-text-faint)",
};

const STATUS_ICON: Record<CompareEntryStatus, string> = {
  different: "FileDiff",
  "left-only": "ArrowLeft",
  "right-only": "ArrowRight",
  "type-conflict": "TriangleAlert",
  same: "Check",
};

export function FolderCompareTool(_props: ToolComponentProps) {
  const [left, setLeft] = useState<string[]>([]);
  const [right, setRight] = useState<string[]>([]);
  const [mode, setMode] = useState<CompareMode>("reliable");
  const [includeHidden, setIncludeHidden] = useState(false);
  const [filter, setFilter] = useState<CompareEntryStatus | "all">("all");
  const action = useNativeAction<FolderCompareReport>();

  if (!isNativeAvailable()) return <NativeRequired />;

  const ready = left.length > 0 && right.length > 0 && left[0] !== right[0];
  const sameFolder = left.length > 0 && right.length > 0 && left[0] === right[0];

  const reset = () => action.setResult(null);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <PathPicker
          mode="directory"
          paths={left}
          onChange={(next) => {
            setLeft(next);
            reset();
          }}
          label="Dossier de gauche"
          hint="la référence"
          disabled={action.job.isRunning}
        />
        <PathPicker
          mode="directory"
          paths={right}
          onChange={(next) => {
            setRight(next);
            reset();
          }}
          label="Dossier de droite"
          hint="celui qu'on compare"
          disabled={action.job.isRunning}
        />
      </div>

      {sameFolder && (
        <Callout tone="warning" title="Les deux dossiers sont le même">
          Choisissez deux dossiers distincts : comparer un dossier à lui-même ne dirait rien.
        </Callout>
      )}

      {ready && (
        <Fieldset columns={2} title="Comparaison">
          <Field label="Mode" hint={MODES.find((entry) => entry.value === mode)?.hint}>
            <OptionGroup
              ariaLabel="Mode de comparaison"
              value={mode}
              onChange={(next) => {
                setMode(next);
                reset();
              }}
              options={MODES}
            />
          </Field>
          <Field label="Portée">
            <CheckOption
              checked={includeHidden}
              onChange={(next) => {
                setIncludeHidden(next);
                reset();
              }}
              label="Inclure les fichiers cachés"
              hint="Les liens symboliques sont toujours signalés, jamais suivis."
            />
          </Field>
        </Fieldset>
      )}

      {ready && (
        <RunBar
          label="Comparer les dossiers"
          icon="GitCompareArrows"
          running={action.job.isRunning}
          progress={action.job.progress}
          status={action.job.status}
          error={action.error}
          cancel={action.job.cancel}
          onRun={() =>
            void action.execute((context) =>
              compareFolders(
                {
                  left: left[0],
                  right: right[0],
                  mode,
                  walk: { ...DEFAULT_WALK_OPTIONS, includeHidden },
                },
                context,
              ),
            )
          }
        />
      )}

      {action.result && (
        <Report report={action.result} filter={filter} onFilter={setFilter} />
      )}
    </div>
  );
}

function Report({
  report,
  filter,
  onFilter,
}: {
  report: FolderCompareReport;
  filter: CompareEntryStatus | "all";
  onFilter: (value: CompareEntryStatus | "all") => void;
}) {
  /** Entrée dont on regarde le détail. Une seule à la fois. */
  const [opened, setOpened] = useState<string | null>(null);

  const visible = useMemo(
    () =>
      report.entries
        .filter((entry) => filter === "all" || entry.status === filter)
        .sort(
          (a, b) =>
            STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) ||
            a.relative.localeCompare(b.relative, "fr"),
        ),
    [report, filter],
  );

  return (
    <div className="space-y-3" data-testid="folder-compare-report">
      <StatGrid
        columns={5}
        stats={[
          { label: "Identiques", value: report.same, tone: "ok" },
          { label: "Différents", value: report.different, tone: report.different > 0 ? "warn" : "neutral" },
          { label: "Gauche seulement", value: report.leftOnly },
          { label: "Droite seulement", value: report.rightOnly },
          {
            label: "Conflits de type",
            value: report.typeConflicts,
            tone: report.typeConflicts > 0 ? "danger" : "neutral",
          },
        ]}
      />

      {report.mode === "quick" ? (
        <Callout tone="warning" title="Mode rapide : l'égalité n'est pas prouvée">
          Les {report.same.toLocaleString("fr-FR")} entrées dites « identiques » ont le même type et
          la même taille, mais leur contenu n'a pas été lu. Deux fichiers de même taille peuvent
          parfaitement différer. Relancez en mode fiable pour confirmer.
        </Callout>
      ) : (
        <Callout tone="info" title="Mode fiable : égalité confirmée par le contenu">
          {formatFileSize(report.hashedBytes)} relus pour départager les fichiers de même taille.
          Les tailles différentes ont conclu sans aucune lecture.
        </Callout>
      )}

      <div className="flex flex-wrap gap-1.5">
        {(["all", ...STATUS_ORDER] as const).map((value) => {
          const count =
            value === "all"
              ? report.entries.length
              : report.entries.filter((entry) => entry.status === value).length;
          return (
            <button
              key={value}
              type="button"
              onClick={() => onFilter(value)}
              aria-pressed={filter === value}
              className={`rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${
                filter === value
                  ? "border-[var(--ft-accent)] bg-[var(--ft-accent-quiet)] text-[var(--ft-text)]"
                  : "border-[var(--ft-border)] text-[var(--ft-text-muted)] hover:bg-[var(--ft-hover)]"
              }`}
            >
              {value === "all" ? "Tout" : STATUS_LABEL[value]} ({count.toLocaleString("fr-FR")})
            </button>
          );
        })}
      </div>

      <Panel title="Entrées" count={visible.length} testId="compare-entries">
        <ul className="max-h-[28rem] divide-y divide-[var(--ft-rule)] overflow-y-auto text-xs">
          {visible.slice(0, 500).map((entry) => {
            // Seules les entrées présentes des deux côtés ont un « pourquoi »
            // à montrer : une entrée d'un seul côté n'a rien à comparer.
            const explainable = entry.status === "different" && !entry.isDir;
            const open = opened === entry.relative;
            const row = (
              <>
                <span className="mt-px shrink-0" style={{ color: STATUS_COLOR[entry.status] }}>
                  <Icon name={STATUS_ICON[entry.status]} size={13} />
                </span>
                <span className="min-w-0 flex-1 text-left">
                  <span className="block truncate font-mono" title={entry.relative}>
                    {entry.relative}
                    {entry.isDir && "/"}
                  </span>
                  <span className="block text-[11px] text-[var(--ft-text-faint)]">
                    {entry.reason}
                    {explainable && (
                      <span className="text-[var(--ft-accent)]">
                        {" "}
                        — {open ? "masquer le détail" : "voir la différence"}
                      </span>
                    )}
                  </span>
                </span>
                <span className="shrink-0 text-right tabular-nums text-[var(--ft-text-muted)]">
                  {entry.leftSize !== null && <span>{formatFileSize(entry.leftSize)}</span>}
                  {entry.leftSize !== null && entry.rightSize !== null && <span> · </span>}
                  {entry.rightSize !== null && <span>{formatFileSize(entry.rightSize)}</span>}
                </span>
                {explainable && (
                  <span className="shrink-0 text-[var(--ft-text-faint)]">
                    <Icon name={open ? "ChevronDown" : "ChevronRight"} size={13} />
                  </span>
                )}
              </>
            );

            return (
              <li key={entry.relative}>
                {explainable ? (
                  <button
                    type="button"
                    onClick={() => setOpened(open ? null : entry.relative)}
                    aria-expanded={open}
                    data-testid={`compare-entry-${entry.relative}`}
                    className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-[var(--ft-hover)]"
                  >
                    {row}
                  </button>
                ) : (
                  <div className="flex items-start gap-2 px-3 py-1.5">{row}</div>
                )}
                {open && (
                  <div className="border-t border-[var(--ft-rule)] bg-[var(--ft-surface-2)] p-2">
                    <EntryDiff
                      relative={entry.relative}
                      leftPath={joinPath(report.left, entry.relative)}
                      rightPath={joinPath(report.right, entry.relative)}
                      onClose={() => setOpened(null)}
                    />
                  </div>
                )}
              </li>
            );
          })}
          {visible.length === 0 && (
            <li className="px-3 py-2 text-[var(--ft-text-faint)]">Aucune entrée dans ce filtre.</li>
          )}
          {visible.length > 500 && (
            <li className="px-3 py-1 text-[var(--ft-text-faint)]">
              … et {(visible.length - 500).toLocaleString("fr-FR")} de plus
            </li>
          )}
        </ul>
      </Panel>

      {report.caseCollisions.length > 0 && (
        <Warnings
          title="Chemins qui ne diffèrent que par la casse — ambigus d'une plateforme à l'autre"
          items={report.caseCollisions}
        />
      )}
      <Warnings
        title="Liens symboliques rencontrés (non suivis)"
        items={[...report.leftNotes.symlinks, ...report.rightNotes.symlinks]}
      />
      <Warnings
        title="Entrées illisibles"
        items={[...report.leftNotes.unreadable, ...report.rightNotes.unreadable]}
      />
    </div>
  );
}
