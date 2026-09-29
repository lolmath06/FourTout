import clsx from "clsx";
import type { ReactNode } from "react";

/**
 * Marqueur d'état, réduit au strict nécessaire.
 *
 * Les pastilles arrondies et colorées sont ce qui donne le plus vite un air de
 * tableau de bord générique. Celles qui restent sont basses, peu contrastées,
 * à angles serrés — et n'apparaissent que quand l'information change vraiment
 * la décision de l'utilisateur.
 */
export function Badge({
  children,
  className,
  title,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={clsx(
        "inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] px-1.5",
        "h-4 text-[10.5px] font-medium leading-none tracking-wide",
        className,
      )}
    >
      {children}
    </span>
  );
}
