import { useMemo, useState } from "react";
import clsx from "clsx";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Callout } from "@/components/ui/Callout";
import { Field, Fieldset, OptionGroup } from "@/components/pdf/Field";
import { CheckOption, TextPane } from "@/components/text/TextToolShell";
import { diffLines, toUnifiedDiff, type DiffRow } from "@/core/text/diff";
import { notify } from "@/features/notifications/store";
import { saveFile } from "@/core/output/save";
import type { ToolComponentProps } from "@/tools/implementations";

/**
 * Comparaison de deux extraits de code.
 *
 * **Le moteur de diff est celui de « Comparer deux textes »** : dupliquer un
 * algorithme de plus longue sous-séquence commune, c'est se garantir deux
 * comportements différents pour la même question.
 *
 * Ce que cet outil ajoute, et qui justifie une carte à part : la normalisation
 * propre au code (indentation, espaces en fin de ligne, fins de ligne CRLF) et
 * une sortie au format `diff` unifié directement collable dans un ticket.
 */
type View = "side" | "unified";

interface Normalization {
  ignoreIndent: boolean;
  ignoreTrailing: boolean;
  ignoreCase: boolean;
  ignoreBlank: boolean;
}

/**
 * Normalise avant comparaison.
 *
 * Un reformatage automatique produit des centaines de lignes « modifiées » qui
 * ne changent rien au programme : pouvoir les écarter est ce qui rend un diff
 * de code lisible.
 */
function normalize(text: string, options: Normalization): string {
  // Les fins de ligne Windows sont toujours ramenées : sinon deux fichiers
  // identiques venant de deux systèmes apparaissent entièrement différents.
  let lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (options.ignoreIndent) lines = lines.map((line) => line.replace(/^[ \t]+/, ""));
  if (options.ignoreTrailing) lines = lines.map((line) => line.replace(/[ \t]+$/, ""));
  if (options.ignoreBlank) lines = lines.filter((line) => line.trim().length > 0);
  const joined = lines.join("\n");
  return options.ignoreCase ? joined.toLowerCase() : joined;
}

const SAMPLE_LEFT = `function total(panier) {
  let somme = 0;
  for (const article of panier) {
    somme += article.prix;
  }
  return somme;
}`;

const SAMPLE_RIGHT = `function total(panier, remise = 0) {
  let somme = 0;
  for (const article of panier) {
    somme += article.prix * article.quantite;
  }
  return somme * (1 - remise);
}`;

export function CodeDiffTool(_props: ToolComponentProps) {
  const [left, setLeft] = useState("");
  const [right, setRight] = useState("");
  const [view, setView] = useState<View>("side");
  const [onlyChanges, setOnlyChanges] = useState(true);
  const [options, setOptions] = useState<Normalization>({
    ignoreIndent: false,
    ignoreTrailing: true,
    ignoreCase: false,
    ignoreBlank: false,
  });

  const result = useMemo(
    () => diffLines(normalize(left, options), normalize(right, options)),
    [left, right, options],
  );
  const rows = onlyChanges ? result.rows.filter((row) => row.op !== "equal") : result.rows;
  const empty = left.length === 0 && right.length === 0;

  const copyUnified = async () => {
    try {
      await navigator.clipboard.writeText(toUnifiedDiff(result));
      notify.success("Diff copié");
    } catch {
      notify.error("Copie impossible", "Le presse-papiers n'est pas accessible.");
    }
  };

  const downloadUnified = async () => {
    const bytes = new TextEncoder().encode(toUnifiedDiff(result));
    const saved = await saveFile({ name: "comparaison.diff", bytes, mimeType: "text/plain" });
    if (saved.saved) notify.success("Fichier enregistré", saved.path);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 lg:flex-row">
        <TextPane
          label="Version d'origine"
          value={left}
          onChange={setLeft}
          placeholder="Collez ou déposez le code d'origine…"
          minHeight="16rem"
        />
        <TextPane
          label="Version modifiée"
          value={right}
          onChange={setRight}
          placeholder="Collez ou déposez le code modifié…"
          minHeight="16rem"
        />
      </div>

      {empty && (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setLeft(SAMPLE_LEFT);
              setRight(SAMPLE_RIGHT);
            }}
          >
            <Icon name="Sparkles" size={13} /> Exemple
          </Button>
        </div>
      )}

      <Fieldset columns={2}>
        <Field label="Affichage">
          <OptionGroup
            ariaLabel="Affichage"
            value={view}
            onChange={setView}
            options={[
              { value: "side", label: "Côte à côte" },
              { value: "unified", label: "Diff unifié" },
            ]}
          />
        </Field>
        <Field label="Filtre">
          <OptionGroup
            ariaLabel="Filtre"
            value={onlyChanges ? "changes" : "all"}
            onChange={(value) => setOnlyChanges(value === "changes")}
            options={[
              { value: "changes", label: "Différences seules" },
              { value: "all", label: "Tout le code" },
            ]}
          />
        </Field>
        <Field label="Ignorer" full>
          <div className="grid gap-1 sm:grid-cols-2">
            <CheckOption
              checked={options.ignoreIndent}
              onChange={(value) => setOptions((current) => ({ ...current, ignoreIndent: value }))}
              label="L'indentation"
              hint="Utile après un reformatage automatique."
            />
            <CheckOption
              checked={options.ignoreTrailing}
              onChange={(value) => setOptions((current) => ({ ...current, ignoreTrailing: value }))}
              label="Les espaces en fin de ligne"
            />
            <CheckOption
              checked={options.ignoreBlank}
              onChange={(value) => setOptions((current) => ({ ...current, ignoreBlank: value }))}
              label="Les lignes vides"
            />
            <CheckOption
              checked={options.ignoreCase}
              onChange={(value) => setOptions((current) => ({ ...current, ignoreCase: value }))}
              label="La casse"
            />
          </div>
        </Field>
      </Fieldset>

      {!empty && (
        <div
          data-testid="code-diff-summary"
          className="ft-num flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface-2)] px-3 py-2 text-[13px]"
        >
          {result.identical ? (
            <span className="flex items-center gap-1.5 text-[var(--ft-ok)]">
              <Icon name="CircleCheck" size={14} /> Aucune différence
            </span>
          ) : (
            <>
              <span className="text-[var(--ft-ok)]">+{result.stats.added}</span>
              <span className="text-[var(--ft-danger)]">−{result.stats.removed}</span>
              <span className="text-[var(--ft-warn)]">~{result.stats.modified}</span>
              <span className="text-[var(--ft-text-muted)]">{result.stats.unchanged} inchangées</span>
            </>
          )}
          <div className="flex-1" />
          <Button size="sm" onClick={() => void downloadUnified()} disabled={result.identical}>
            <Icon name="Download" size={13} /> Télécharger .diff
          </Button>
          <Button size="sm" variant="primary" onClick={() => void copyUnified()} disabled={result.identical}>
            <Icon name="Copy" size={13} /> Copier le diff
          </Button>
        </div>
      )}

      {result.truncated && (
        <Callout tone="warning" title="Comparaison simplifiée">
          Les deux extraits sont très longs : la comparaison est faite ligne à ligne, sans
          alignement fin. Le résultat reste juste, mais les blocs déplacés apparaîtront comme
          supprimés puis rajoutés.
        </Callout>
      )}

      {!empty && (
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--ft-border)]">
          {view === "side" ? <SideBySide rows={rows} /> : <Unified rows={rows} />}
        </div>
      )}
    </div>
  );
}

const ROW_BACKGROUND: Record<string, string> = {
  add: "bg-[color-mix(in_oklch,var(--ft-ok)_12%,transparent)]",
  remove: "bg-[color-mix(in_oklch,var(--ft-danger)_12%,transparent)]",
  change: "bg-[color-mix(in_oklch,var(--ft-warn)_12%,transparent)]",
  equal: "",
};

function SideBySide({ rows }: { rows: DiffRow[] }) {
  return (
    <table className="w-full border-collapse font-mono text-xs">
      <tbody>
        {rows.map((row, index) => (
          <tr key={index} className={ROW_BACKGROUND[row.op]}>
            <td className="ft-num w-12 select-none border-r border-[var(--ft-border)] px-1.5 py-0.5 text-right align-top text-[var(--ft-text-faint)]">
              {row.left ?? ""}
            </td>
            <td className="w-1/2 whitespace-pre-wrap break-words px-2 py-0.5 align-top">
              {row.op === "add" ? "" : row.leftText}
            </td>
            <td className="ft-num w-12 select-none border-x border-[var(--ft-border)] px-1.5 py-0.5 text-right align-top text-[var(--ft-text-faint)]">
              {row.right ?? ""}
            </td>
            <td className="w-1/2 whitespace-pre-wrap break-words px-2 py-0.5 align-top">
              {row.op === "remove" ? "" : row.rightText}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Unified({ rows }: { rows: DiffRow[] }) {
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
        <div key={index} className={clsx("whitespace-pre-wrap break-words", ROW_BACKGROUND[line.op])}>
          {line.sign}
          {line.text}
        </div>
      ))}
    </pre>
  );
}
