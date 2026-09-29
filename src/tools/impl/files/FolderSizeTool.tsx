import { useState } from "react";
import { NativeToolShell } from "@/components/files/NativeToolShell";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { formatExactBytes, formatFileSize, formatSizeWithExact } from "@/core/files";
import { folderStats, type FolderStats } from "@/core/files/native";
import { revealFile } from "@/core/output/save";
import type { ToolComponentProps } from "@/tools/implementations";

/**
 * Analyse de la taille d'un dossier.
 *
 * Trois tables suffisent à répondre à « qu'est-ce qui prend de la place ? » :
 * les sous-dossiers par poids, les plus gros fichiers, et la répartition par
 * extension. L'analyse est annulable ; les dossiers illisibles sont signalés
 * plutôt que comptés à zéro en silence.
 */
export function FolderSizeTool(_props: ToolComponentProps) {
  const [paths, setPaths] = useState<string[]>([]);

  return (
    <NativeToolShell<FolderStats>
      picker={{
        mode: "directory",
        paths,
        onChange: setPaths,
        label: "Choisissez le dossier à analyser",
      }}
      actionLabel="Analyser le dossier"
      actionIcon="HardDrive"
      run={(context) => folderStats(paths[0], context)}
      successMessage={(stats) => `${formatSizeWithExact(stats.totalBytes)} · ${stats.files} fichiers`}
      renderResult={(stats) => (
        <div className="space-y-3" data-testid="folder-stats">
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {[
              { label: "Taille totale", value: formatFileSize(stats.totalBytes) },
              { label: "Fichiers", value: stats.files.toLocaleString("fr-FR") },
              { label: "Dossiers", value: stats.directories.toLocaleString("fr-FR") },
              { label: "Liens symboliques", value: stats.symlinks.toLocaleString("fr-FR") },
            ].map((cell) => (
              <div
                key={cell.label}
                className="rounded-md border border-[var(--ft-border)] bg-[var(--ft-surface)] px-2.5 py-2"
              >
                <p className="text-lg font-semibold tabular-nums leading-6">{cell.value}</p>
                <p className="text-[11px] text-[var(--ft-text-muted)]">{cell.label}</p>
              </div>
            ))}
          </div>

          <p className="ft-meta tabular-nums" data-testid="folder-total-exact">
            Total exact : {formatExactBytes(stats.totalBytes)}. Les tailles sont comptées en
            multiples binaires (1 Kio = 1024 octets), comme le système de fichiers.
          </p>

          {stats.children.length > 0 && (
            <Table
              title="Sous-dossiers, du plus lourd au plus léger"
              rows={stats.children.slice(0, 15).map((child) => ({
                key: child.path,
                name: child.name,
                size: child.size,
                path: child.path,
              }))}
              total={stats.totalBytes}
            />
          )}

          {stats.largest.length > 0 && (
            <Table
              title="Fichiers les plus volumineux"
              rows={stats.largest.map((file) => ({
                key: file.path,
                name: file.name,
                size: file.size,
                path: file.path,
              }))}
              total={stats.totalBytes}
            />
          )}

          {stats.byExtension.length > 0 && (
            <div className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--ft-border)]">
              <table className="w-full border-collapse text-xs">
                <caption className="px-3 py-2 text-left text-xs font-medium text-[var(--ft-text-muted)]">
                  Répartition par extension
                </caption>
                <tbody>
                  {stats.byExtension.slice(0, 15).map((entry) => (
                    <tr key={entry.extension} className="border-t border-[var(--ft-border)]">
                      <td className="px-3 py-1 font-mono">{entry.extension}</td>
                      <td className="px-3 py-1 tabular-nums text-[var(--ft-text-muted)]">
                        {entry.files} fichier(s)
                      </td>
                      <td
                        className="px-3 py-1 text-right tabular-nums"
                        title={formatExactBytes(entry.bytes)}
                      >
                        {formatFileSize(entry.bytes)}
                      </td>
                      <td className="w-1/3 px-3 py-1">
                        <Bar ratio={stats.totalBytes > 0 ? entry.bytes / stats.totalBytes : 0} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {stats.unreadable.length > 0 && (
            <div className="rounded-md border border-[var(--ft-border)] bg-[var(--ft-surface-2)] px-3 py-2 text-xs text-[var(--ft-warn)]">
              <p className="flex items-center gap-1.5 font-medium">
                <Icon name="TriangleAlert" size={13} />
                {stats.unreadable.length} dossier(s) illisible(s) — non comptés dans le total
              </p>
              <ul className="mt-1 max-h-32 overflow-y-auto">
                {stats.unreadable.slice(0, 20).map((entry) => (
                  <li key={entry} className="truncate font-mono">
                    {entry}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    />
  );
}

function Bar({ ratio }: { ratio: number }) {
  return (
    <span className="block h-1.5 overflow-hidden rounded-full bg-[var(--ft-surface-2)]">
      <span
        className="block h-full rounded-full bg-[var(--ft-accent)]"
        style={{ width: `${Math.max(2, Math.round(ratio * 100))}%` }}
      />
    </span>
  );
}

function Table({
  title,
  rows,
  total,
}: {
  title: string;
  rows: { key: string; name: string; size: number; path: string }[];
  total: number;
}) {
  return (
    <div className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--ft-border)]">
      <table className="w-full border-collapse text-xs">
        <caption className="px-3 py-2 text-left text-xs font-medium text-[var(--ft-text-muted)]">
          {title}
        </caption>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-t border-[var(--ft-border)]">
              <td className="max-w-0 truncate px-3 py-1" title={row.path}>
                {row.name}
              </td>
              <td
                className="px-3 py-1 text-right tabular-nums"
                title={formatExactBytes(row.size)}
              >
                {formatFileSize(row.size)}
              </td>
              <td className="w-1/3 px-3 py-1">
                <Bar ratio={total > 0 ? row.size / total : 0} />
              </td>
              <td className="px-1 py-1">
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Ouvrir l'emplacement de ${row.name}`}
                  onClick={() => revealFile(row.path)}
                >
                  <Icon name="FolderTree" size={13} />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
