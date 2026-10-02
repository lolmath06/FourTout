import clsx from "clsx";
import { toolName } from "@/core/tools/localized";
import { useFavorites } from "@/features/favorites/store";
import { notify } from "@/features/notifications/store";
import { toolRegistry } from "@/core/tools/registry";
import { Icon } from "@/components/ui/Icon";
import { t, tx } from "@/i18n";

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

  const label = isFavorite ? t("Retirer des favoris") : t("Ajouter aux favoris");

  return (
    <button
      type="button"
      aria-label={tx(label)}
      aria-pressed={isFavorite}
      title={tx(label)}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        toggle(toolId);
        const tool = toolRegistry.get(toolId);
        const name = tool ? toolName(tool) : t("Outil");
        if (isFavorite) notify.info(t("{name} retiré des favoris", { name }));
        else notify.success(t("{name} ajouté aux favoris", { name }));
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
          {isFavorite ? t("Dans les favoris") : t("Ajouter aux favoris")}
        </span>
      )}
    </button>
  );
}
