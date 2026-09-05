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
    <div className="flex flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] border border-dashed border-[var(--ft-border)] px-6 py-8 text-center">
      <span className="text-[var(--ft-text-faint)]">
        <Icon name={icon} size={18} />
      </span>
      <div className="space-y-0.5">
        <p className="text-[13px] font-medium text-[var(--ft-text)]">{title}</p>
        {description && (
          <p className="ft-meta max-w-md">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}
