import clsx from "clsx";
import { useFavorites } from "@/features/favorites/store";
import { notify } from "@/features/notifications/store";
import { toolRegistry } from "@/core/tools/registry";
import { Icon } from "@/components/ui/Icon";

export function FavoriteButton({
  toolId,
  size = 15,
  className,
  withLabel = false,
}: {
  toolId: string;
  size?: number;
  className?: string;
  withLabel?: boolean;
}) {
  const ids = useFavorites((state) => state.ids);
  const toggle = useFavorites((state) => state.toggle);
  const isFavorite = ids.includes(toolId);

  const label = isFavorite ? "Retirer des favoris" : "Ajouter aux favoris";

  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={isFavorite}
      title={label}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        toggle(toolId);
        const name = toolRegistry.get(toolId)?.name ?? "Outil";
        if (isFavorite) notify.info(`${name} retiré des favoris`);
        else notify.success(`${name} ajouté aux favoris`);
      }}
      className={clsx(
        "inline-flex shrink-0 items-center gap-1.5 rounded-md p-1.5 transition-colors",
        isFavorite
          ? "text-[var(--ft-warn)]"
          : "text-[var(--ft-text-faint)] hover:text-[var(--ft-text)]",
        className,
      )}
    >
      <Icon name="Star" size={size} className={isFavorite ? "fill-current" : undefined} />
      {withLabel && (
        <span className="text-xs font-medium">
          {isFavorite ? "Dans les favoris" : "Ajouter aux favoris"}
        </span>
      )}
    </button>
  );
}
