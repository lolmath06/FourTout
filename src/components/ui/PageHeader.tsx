import type { ReactNode } from "react";
import { Icon } from "./Icon";

export function PageHeader({
  icon,
  title,
  description,
  actions,
}: {
  icon?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex items-start gap-3">
      {icon && (
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md bg-[var(--ft-cat-soft,var(--ft-surface-2))] text-[var(--ft-cat,var(--ft-text-muted))]">
          <Icon name={icon} size={18} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="mt-0.5 text-sm text-[var(--ft-text-muted)]">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Page({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-6xl px-6 py-6">{children}</div>;
}
