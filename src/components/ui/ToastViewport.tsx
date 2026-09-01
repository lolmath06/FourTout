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
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2"
    >
      {notices.map((notice) => (
        <div
          key={notice.id}
          className="ft-rise pointer-events-auto flex items-start gap-2.5 rounded-[var(--radius-card)] border border-[var(--ft-border)] bg-[var(--ft-surface)] p-3 shadow-[var(--ft-shadow)]"
        >
          <span className={`mt-0.5 shrink-0 ${COLOR_BY_KIND[notice.kind]}`}>
            <Icon
              name={ICON_BY_KIND[notice.kind]}
              size={16}
              className={notice.kind === "loading" ? "animate-spin" : undefined}
            />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{notice.title}</p>
            {notice.description && (
              <p className="mt-0.5 text-xs text-[var(--ft-text-muted)]">
                {notice.description}
              </p>
            )}
          </div>
          <button
            type="button"
            aria-label="Fermer la notification"
            onClick={() => dismiss(notice.id)}
            className="shrink-0 rounded p-0.5 text-[var(--ft-text-faint)] hover:text-[var(--ft-text)]"
          >
            <Icon name="X" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
