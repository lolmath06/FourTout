import type { ReactNode } from "react";
import { Icon } from "./Icon";

export function EmptyState({
  icon = "Inbox",
  title,
  description,
  action,
}: {
  icon?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-[var(--radius-card)] border border-dashed border-[var(--ft-border)] px-6 py-12 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-[var(--ft-surface-2)] text-[var(--ft-text-faint)]">
        <Icon name={icon} size={20} />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-medium text-[var(--ft-text)]">{title}</p>
        {description && (
          <p className="max-w-md text-xs text-[var(--ft-text-muted)]">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}
