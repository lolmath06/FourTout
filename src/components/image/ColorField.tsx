import { parseHexColor, rgbToHex, type Rgb } from "@/core/image/types";
import { localized, t, tx } from "@/i18n";

/** Choix d'une couleur : nuancier rapide + saisie hexadécimale + pipette native. */
const PRESETS: { label: string; hex: string }[] = localized(() => [
  { label: t("Blanc"), hex: "#ffffff" },
  { label: t("Noir"), hex: "#000000" },
  { label: t("Gris"), hex: "#808080" },
  { label: t("Transparent clair"), hex: "#f5f5f5" },
]);

export function ColorField({
  value,
  onChange,
  presets = PRESETS,
}: {
  value: Rgb;
  onChange: (color: Rgb) => void;
  presets?: { label: string; hex: string }[];
}) {
  const hex = rgbToHex(value);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="color"
        aria-label={t("Choisir une couleur")}
        value={hex}
        onChange={(event) => {
          const parsed = parseHexColor(event.target.value);
          if (parsed) onChange(parsed);
        }}
        className="h-9 w-12 cursor-pointer rounded-md border border-[var(--ft-border)] bg-transparent p-0.5"
      />
      <input
        type="text"
        aria-label={t("Code hexadécimal")}
        value={hex}
        onChange={(event) => {
          const parsed = parseHexColor(event.target.value);
          if (parsed) onChange(parsed);
        }}
        className="h-9 w-28 rounded-md border border-[var(--ft-border)] bg-[var(--ft-bg)] px-2.5 font-mono text-sm outline-none focus:border-[var(--ft-accent)]"
      />
      <div className="flex gap-1">
        {presets.map((preset) => (
          <button
            key={preset.hex}
            type="button"
            title={tx(preset.label)}
            onClick={() => {
              const parsed = parseHexColor(preset.hex);
              if (parsed) onChange(parsed);
            }}
            className={`size-7 rounded-md border ${
              hex.toLowerCase() === preset.hex.toLowerCase()
                ? "border-[var(--ft-accent)] ring-1 ring-[var(--ft-accent)]"
                : "border-[var(--ft-border)]"
            }`}
            style={{ background: preset.hex }}
          />
        ))}
      </div>
    </div>
  );
}
