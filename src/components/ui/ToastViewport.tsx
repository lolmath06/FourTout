import { useEffect } from "react";
import { useNotifications, type NoticeKind } from "@/features/notifications/store";
import { Icon } from "./Icon";

const ICON_BY_KIND: Record<NoticeKind, string> = {
  success: "CircleCheck",
  error: "CircleAlert",
  warning: "TriangleAlert",
  info: "Info",
  loading: "Loader",
};

/** Filet latéral : la couleur porte l'état sans colorer toute la surface. */
const BORDER_BY_KIND: Record<NoticeKind, string> = {
  success: "var(--ft-ok)",
  error: "var(--ft-danger)",
  warning: "var(--ft-warn)",
  info: "var(--ft-accent)",
  loading: "var(--ft-border-strong)",
};

const COLOR_BY_KIND: Record<NoticeKind, string> = {
  success: "text-[var(--ft-ok)]",
  error: "text-[var(--ft-danger)]",
  warning: "text-[var(--ft-warn)]",
  info: "text-[var(--ft-accent)]",
  loading: "text-[var(--ft-text-muted)]",
};

/**
 * Affichage unique des retours utilisateur. Toute l'application passe par
 * `notify.*` : aucun `alert()` nulle part.
 */
export function ToastViewport() {
  const notices = useNotifications((state) => state.notices);
  const dismiss = useNotifications((state) => state.dismiss);

  useEffect(() => {
    const timers = notices
      .filter((notice) => notice.duration > 0)
      .map((notice) =>
        window.setTimeout(() => dismiss(notice.id), notice.duration),
      );
    return () => timers.forEach(window.clearTimeout);
  }, [notices, dismiss]);

  if (notices.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-3 right-3 z-50 flex w-76 flex-col gap-1.5"
    >
      {notices.map((notice) => (
        <div
          key={notice.id}
          className="ft-rise pointer-events-auto flex items-start gap-2 rounded-[var(--radius-card)] border border-l-2 border-[var(--ft-border)] bg-[var(--ft-surface)] px-2.5 py-2 shadow-[var(--ft-shadow)]"
          style={{ borderLeftColor: BORDER_BY_KIND[notice.kind] }}
        >
          <span className={`mt-px shrink-0 ${COLOR_BY_KIND[notice.kind]}`}>
            <Icon
              name={ICON_BY_KIND[notice.kind]}
              size={14}
              className={notice.kind === "loading" ? "animate-spin" : undefined}
            />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium leading-5">{notice.title}</p>
            {notice.description && (
              <p className="ft-meta mt-0.5 break-words">{notice.description}</p>
            )}
          </div>
          <button
            type="button"
            aria-label="Fermer la notification"
            onClick={() => dismiss(notice.id)}
            className="shrink-0 rounded-[var(--radius-sm)] p-0.5 text-[var(--ft-text-faint)] hover:text-[var(--ft-text)]"
          >
            <Icon name="X" size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
