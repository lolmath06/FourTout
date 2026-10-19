import { useMemo, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { TextInput } from "@/components/pdf/Field";
import type { IsoEntry } from "@/core/internet/native";
import { formatDate, formatDecimalSize, t } from "@/i18n";

/**
 * Liste de l'arborescence d'une image ISO : indentée, filtrable, avec une
 * sélection facultative (cases à cocher) pour l'extraction partielle.
 *
 * L'image peut contenir des dizaines de milliers d'entrées : seules les
 * `LIMIT` premières correspondant au filtre sont dessinées.
 */
const LIMIT = 1500;

export function IsoTree({
  entries,
  selectable = false,
  selected,
  onToggle,
  onPick,
  picked,
}: {
  entries: IsoEntry[];
  selectable?: boolean;
  selected?: ReadonlySet<string>;
  onToggle?: (path: string) => void;
  /** Ligne mise en avant (copie de métadonnées). */
  onPick?: (entry: IsoEntry) => void;
  picked?: string;
}) {
  const [filter, setFilter] = useState("");
  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const list = needle ? entries.filter((e) => e.path.toLowerCase().includes(needle)) : entries;
    return list;
  }, [entries, filter]);

  return (
    <div className="space-y-2">
      <TextInput
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder={t("Filtrer par nom ou chemin")}
        aria-label={t("Filtrer par nom ou chemin")}
      />
      <div className="max-h-[420px] overflow-y-auto rounded-[var(--radius-card)] border border-[var(--ft-border)]" data-testid="iso-tree">
        <ul className="divide-y divide-[var(--ft-rule)] text-[12.5px]">
          {shown.slice(0, LIMIT).map((entry) => {
            const depth = entry.path.split("/").length - 1;
            const active = picked === entry.path;
            return (
              <li
                key={entry.path}
                className={`flex items-center gap-2 px-2 py-1 ${active ? "bg-[var(--ft-surface-2)]" : ""}`}
                style={{ paddingLeft: 8 + depth * 14 }}
                onClick={() => onPick?.(entry)}
              >
                {selectable && (
                  <input
                    type="checkbox"
                    aria-label={entry.path}
                    checked={selected?.has(entry.path) ?? false}
                    onChange={() => onToggle?.(entry.path)}
                    onClick={(e) => e.stopPropagation()}
                    className="size-3.5 accent-[var(--ft-accent)]"
                  />
                )}
                <Icon name={entry.isDir ? "FolderTree" : "FileText"} size={13} className="shrink-0 text-[var(--ft-text-faint)]" />
                <span className="min-w-0 flex-1 truncate font-mono" title={entry.path}>{entry.name}</span>
                {entry.symlink && <span className="text-[10px] text-[var(--ft-text-faint)]">{t("lien")}</span>}
                {!entry.isDir && <span className="shrink-0 tabular-nums text-[var(--ft-text-faint)]">{formatDecimalSize(entry.size)}</span>}
                {entry.modified > 0 && (
                  <span className="hidden shrink-0 tabular-nums text-[var(--ft-text-faint)] sm:inline">{formatDate(new Date(entry.modified * 1000))}</span>
                )}
              </li>
            );
          })}
        </ul>
        {shown.length === 0 && <p className="ft-meta p-3">{t("Aucune entrée ne correspond.")}</p>}
      </div>
      {shown.length > LIMIT && (
        <p className="ft-meta">{t("{shown} entrées affichées sur {total} : affinez le filtre pour voir les autres.", { shown: LIMIT, total: shown.length })}</p>
      )}
    </div>
  );
}
