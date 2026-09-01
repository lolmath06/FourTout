import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { notify } from "@/features/notifications/store";
import type { ToolComponentProps } from "../implementations";
import { decodeBase64, encodeBase64 } from "../logic/base64";

type Direction = "encode" | "decode";

export function Base64Tool(_props: ToolComponentProps) {
  const [direction, setDirection] = useState<Direction>("encode");
  const [urlSafe, setUrlSafe] = useState(false);
  const [input, setInput] = useState("");

  const output = useMemo(() => {
    if (input.length === 0) return { value: "", error: null as string | null };
    try {
      return {
        value: direction === "encode" ? encodeBase64(input, urlSafe) : decodeBase64(input),
        error: null,
      };
    } catch {
      return { value: "", error: "Entrée Base64 invalide." };
    }
  }, [direction, input, urlSafe]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(output.value);
      notify.success("Résultat copié");
    } catch {
      notify.error("Copie impossible", "Le presse-papiers n'est pas accessible.");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex h-8 items-center gap-0.5 rounded-lg border border-[var(--ft-border)] bg-[var(--ft-surface)] p-0.5">
          {(["encode", "decode"] as Direction[]).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={direction === value}
              onClick={() => setDirection(value)}
              className={
                direction === value
                  ? "rounded-md bg-[var(--ft-accent-soft)] px-2.5 py-1 text-xs font-medium text-[var(--ft-accent-text)]"
                  : "rounded-md px-2.5 py-1 text-xs font-medium text-[var(--ft-text-muted)]"
              }
            >
              {value === "encode" ? "Encoder" : "Décoder"}
            </button>
          ))}
        </div>
        {direction === "encode" && (
          <label className="flex items-center gap-1.5 text-xs text-[var(--ft-text-muted)]">
            <input
              type="checkbox"
              checked={urlSafe}
              onChange={(event) => setUrlSafe(event.target.checked)}
            />
            base64url (compatible URL)
          </label>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={direction === "encode" ? "Texte à encoder…" : "Base64 à décoder…"}
          aria-label="Entrée"
          className="min-h-56 w-full resize-y rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)] p-3 font-mono text-sm outline-none focus:border-[var(--ft-accent)]"
        />
        <textarea
          readOnly
          value={output.error ?? output.value}
          placeholder="Résultat…"
          aria-label="Résultat"
          className={`min-h-56 w-full resize-y rounded-[var(--radius-card)] border bg-[var(--ft-surface-2)] p-3 font-mono text-sm outline-none ${
            output.error ? "border-[var(--ft-danger)] text-[var(--ft-danger)]" : "border-[var(--ft-border)]"
          }`}
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => setInput("")} disabled={!input}>
          Effacer
        </Button>
        <Button size="sm" variant="primary" onClick={copy} disabled={!output.value}>
          Copier le résultat
        </Button>
      </div>
    </div>
  );
}
