import { useState } from "react";
import { formatFileSize } from "@/core/files";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import type { LoadedPdf } from "./usePdfSources";

/**
 * Liste des documents chargés : nom, nombre de pages, taille, et le cas
 * échéant la demande de mot de passe ou le motif du rejet.
 */
export function PdfSourceList({
  documents,
  onMove,
  onRemove,
  onUnlock,
}: {
  documents: LoadedPdf[];
  onMove?: (id: string, direction: -1 | 1) => void;
  onRemove?: (id: string) => void;
  onUnlock?: (id: string, password: string) => Promise<boolean>;
}) {
  return (
    <ul className="flex flex-col gap-1.5">
      {documents.map((document, index) => (
        <li
          key={document.id}
          className="rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)]"
        >
          <div className="flex items-center gap-2.5 px-3 py-2.5">
            <span
              className={
                document.error
                  ? "text-[var(--ft-danger)]"
                  : document.needsPassword
                    ? "text-[var(--ft-warn)]"
                    : "text-[var(--ft-text-faint)]"
              }
            >
              <Icon
                name={document.needsPassword ? "Lock" : document.error ? "CircleAlert" : "FileText"}
                size={16}
              />
            </span>

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{document.name}</p>
              <p className="text-xs text-[var(--ft-text-muted)]">
                {document.error ? (
                  <span className="text-[var(--ft-danger)]">{document.error}</span>
                ) : document.needsPassword ? (
                  <span className="text-[var(--ft-warn)]">Protégé par un mot de passe</span>
                ) : (
                  <>
                    {document.info?.pageCount} page{(document.info?.pageCount ?? 0) > 1 ? "s" : ""}
                    {document.info?.firstPageSize && (
                      <>
                        {" · "}
                        {Math.round(document.info.firstPageSize.width)} ×{" "}
                        {Math.round(document.info.firstPageSize.height)} pt
                      </>
                    )}
                    {" · "}
                    {formatFileSize(document.source.bytes.length)}
                  </>
                )}
              </p>
            </div>

            {onMove && (
              <span className="flex shrink-0 items-center">
                <button
                  type="button"
                  aria-label={`Monter ${document.name}`}
                  disabled={index === 0}
                  onClick={() => onMove(document.id, -1)}
                  className="rounded p-1 text-[var(--ft-text-faint)] hover:text-[var(--ft-text)] disabled:opacity-30"
                >
                  <Icon name="ArrowUpDown" size={14} />
                </button>
              </span>
            )}
            {onMove && (
              <span className="shrink-0 text-[11px] tabular-nums text-[var(--ft-text-faint)]">
                {index + 1}
              </span>
            )}
            {onMove && (
              <button
                type="button"
                aria-label={`Descendre ${document.name}`}
                disabled={index === documents.length - 1}
                onClick={() => onMove(document.id, 1)}
                className="shrink-0 rotate-180 rounded p-1 text-[var(--ft-text-faint)] hover:text-[var(--ft-text)] disabled:opacity-30"
              >
                <Icon name="ArrowUpDown" size={14} />
              </button>
            )}

            {onRemove && (
              <button
                type="button"
                aria-label={`Retirer ${document.name}`}
                onClick={() => onRemove(document.id)}
                className="shrink-0 rounded p-1 text-[var(--ft-text-faint)] hover:text-[var(--ft-danger)]"
              >
                <Icon name="X" size={14} />
              </button>
            )}
          </div>

          {document.needsPassword && onUnlock && (
            <PasswordPrompt documentId={document.id} onUnlock={onUnlock} />
          )}
        </li>
      ))}
    </ul>
  );
}

function PasswordPrompt({
  documentId,
  onUnlock,
}: {
  documentId: string;
  onUnlock: (id: string, password: string) => Promise<boolean>;
}) {
  const [password, setPassword] = useState("");
  const [checking, setChecking] = useState(false);

  const submit = async () => {
    if (password.length === 0) return;
    setChecking(true);
    await onUnlock(documentId, password);
    setChecking(false);
  };

  return (
    <div className="flex items-center gap-2 border-t border-[var(--ft-border)] px-3 py-2.5">
      <input
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") void submit();
        }}
        placeholder="Mot de passe du document"
        aria-label="Mot de passe du document"
        className="h-8 min-w-0 flex-1 rounded-md border border-[var(--ft-border)] bg-[var(--ft-bg)] px-2.5 text-sm outline-none focus:border-[var(--ft-accent)]"
      />
      <Button size="sm" onClick={submit} disabled={password.length === 0 || checking}>
        {checking ? "Vérification…" : "Déverrouiller"}
      </Button>
    </div>
  );
}
