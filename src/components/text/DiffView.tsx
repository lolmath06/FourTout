import clsx from "clsx";
import type { DiffRow, WordPart } from "@/core/text/diff";

/**
 * Affichage d'une comparaison.
 *
 * Extrait de « Comparer deux textes » pour être partagé avec « Comparer deux
 * documents » : les deux outils calculent la même chose avec le même moteur, et
 * doivent donc la montrer exactement de la même façon. Ces composants ne
 * connaissent que des lignes de différence — d'où elles viennent (texte collé,
 * PDF, Word) ne les regarde pas.
 */

const DIFF_ROW_BACKGROUND: Record<string, string> = {
  add: "bg-[color-mix(in_oklch,var(--ft-ok)_12%,transparent)]",
  remove: "bg-[color-mix(in_oklch,var(--ft-danger)_12%,transparent)]",
  change: "bg-[color-mix(in_oklch,var(--ft-warn)_12%,transparent)]",
  equal: "",
};

export function DiffWords({
  parts,
  text,
  tone,
}: {
  parts?: WordPart[];
  text?: string;
  tone: "add" | "remove";
}) {
  if (!parts) return <>{text}</>;
  const highlight =
    tone === "add"
      ? "bg-[color-mix(in_oklch,var(--ft-ok)_28%,transparent)]"
      : "bg-[color-mix(in_oklch,var(--ft-danger)_28%,transparent)]";
  return (
    <>
      {parts.map((part, index) => (
        <span key={index} className={part.changed ? `rounded-sm ${highlight}` : undefined}>
          {part.text}
        </span>
      ))}
    </>
  );
}

export function DiffSideBySide({ rows }: { rows: DiffRow[] }) {
  return (
    <table className="w-full border-collapse font-mono text-xs">
      <tbody>
        {rows.map((row, index) => (
          <tr key={index} className={DIFF_ROW_BACKGROUND[row.op]}>
            <td className="w-10 select-none border-r border-[var(--ft-border)] px-1.5 py-0.5 text-right align-top text-[var(--ft-text-faint)]">
              {row.left ?? ""}
            </td>
            <td className="w-1/2 whitespace-pre-wrap break-words px-2 py-0.5 align-top">
              {row.op === "add" ? "" : <DiffWords parts={row.leftWords} text={row.leftText} tone="remove" />}
            </td>
            <td className="w-10 select-none border-x border-[var(--ft-border)] px-1.5 py-0.5 text-right align-top text-[var(--ft-text-faint)]">
              {row.right ?? ""}
            </td>
            <td className="w-1/2 whitespace-pre-wrap break-words px-2 py-0.5 align-top">
              {row.op === "remove" ? "" : <DiffWords parts={row.rightWords} text={row.rightText} tone="add" />}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function DiffUnified({ rows }: { rows: DiffRow[] }) {
  const lines: { sign: string; text: string; op: string }[] = [];
  for (const row of rows) {
    if (row.op === "equal") lines.push({ sign: " ", text: row.leftText ?? "", op: "equal" });
    else if (row.op === "remove") lines.push({ sign: "-", text: row.leftText ?? "", op: "remove" });
    else if (row.op === "add") lines.push({ sign: "+", text: row.rightText ?? "", op: "add" });
    else {
      lines.push({ sign: "-", text: row.leftText ?? "", op: "remove" });
      lines.push({ sign: "+", text: row.rightText ?? "", op: "add" });
    }
  }
  return (
    <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed">
      {lines.map((line, index) => (
        <div key={index} className={clsx("whitespace-pre-wrap break-words", DIFF_ROW_BACKGROUND[line.op])}>
          {line.sign}
          {line.text}
        </div>
      ))}
    </pre>
  );
}

/** Bandeau de statistiques d'une comparaison. */
export function DiffStatsBar({
  stats,
  identical,
  children,
}: {
  stats: { added: number; removed: number; modified: number; unchanged: number };
  identical: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div
      data-testid="diff-summary"
      className="flex flex-wrap items-center gap-3 rounded-md border border-[var(--ft-border)] bg-[var(--ft-surface-2)] px-3 py-2 text-sm"
    >
      {identical ? (
        <span className="flex items-center gap-1.5 text-[var(--ft-ok)]">Les deux documents sont identiques</span>
      ) : (
        <>
          <span className="tabular-nums text-[var(--ft-ok)]">+{stats.added} ajoutée(s)</span>
          <span className="tabular-nums text-[var(--ft-danger)]">−{stats.removed} supprimée(s)</span>
          <span className="tabular-nums text-[var(--ft-warn)]">~{stats.modified} modifiée(s)</span>
          <span className="tabular-nums text-[var(--ft-text-muted)]">{stats.unchanged} inchangée(s)</span>
        </>
      )}
      <div className="flex-1" />
      {children}
    </div>
  );
}
