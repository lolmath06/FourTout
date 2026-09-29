import { useEffect, useState } from "react";
import { TextPane } from "@/components/text/TextToolShell";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { hashText, isLegacyAlgorithm, TEXT_HASH_ALGORITHMS } from "@/core/hash";
import { notify } from "@/features/notifications/store";
import type { ToolComponentProps } from "@/tools/implementations";

/**
 * Empreinte d'une chaîne de caractères.
 *
 * Le texte est encodé en UTF-8 avant hachage : c'est ce que font les autres
 * outils du marché, et c'est ce qui permet de retrouver la même empreinte
 * ailleurs. Les algorithmes dépassés sont affichés comme tels.
 */
export function HashTextTool(_props: ToolComponentProps) {
  const [input, setInput] = useState("");
  const [digests, setDigests] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next: Record<string, string> = {};
      for (const algorithm of TEXT_HASH_ALGORITHMS) {
        next[algorithm] = input.length === 0 ? "" : await hashText(input, algorithm);
      }
      if (!cancelled) setDigests(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [input]);

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      notify.success("Empreinte copiée");
    } catch {
      notify.error("Copie impossible");
    }
  };

  return (
    <div className="space-y-4">
      <TextPane
        label="Texte à hacher"
        value={input}
        onChange={setInput}
        placeholder="Saisissez ou collez le texte…"
        minHeight="10rem"
      />

      <div className="flex flex-col gap-2">
        {TEXT_HASH_ALGORITHMS.map((algorithm) => (
          <div
            key={algorithm}
            className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--ft-border)] bg-[var(--ft-surface)] px-3 py-2"
          >
            <span className="w-20 shrink-0 text-xs font-medium">
              {algorithm}
              {isLegacyAlgorithm(algorithm) && (
                <span className="block text-[10px] font-normal text-[var(--ft-warn)]">obsolète</span>
              )}
            </span>
            <code className="min-w-0 flex-1 break-all font-mono text-xs text-[var(--ft-text-muted)]">
              {digests[algorithm] || "—"}
            </code>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => copy(digests[algorithm])}
              disabled={!digests[algorithm]}
              aria-label={`Copier ${algorithm}`}
            >
              <Icon name="Copy" size={14} />
            </Button>
          </div>
        ))}
      </div>

      <p className="flex items-start gap-2 rounded-md border border-[var(--ft-border)] bg-[var(--ft-surface-2)] px-3 py-2 text-xs text-[var(--ft-warn)]">
        <Icon name="TriangleAlert" size={14} className="mt-px shrink-0" />
        MD5 et SHA-1 ne sont plus adaptés à un usage cryptographique : ils restent utiles comme
        sommes de contrôle, jamais pour protéger un mot de passe ou signer un document.
      </p>
    </div>
  );
}
