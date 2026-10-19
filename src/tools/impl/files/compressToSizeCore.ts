import type { OperationOutcome } from "@/components/pdf/ResultPanel";
import { type SelectedFile } from "@/core/files";
import { fitToSize, scaledSize } from "@/core/budget/fit";
import { decodeOriented, readSelectedFile } from "@/core/image/codec";
import { readBytes } from "@/core/media/client";
import { compressPdf, type CompressionLevel } from "@/core/pdf/operations/compress";
import { outputName } from "@/core/pdf/filenames";
import { getRasterBackend } from "@/core/pdf/raster/types";
import { formatDecimalSize, t } from "@/i18n";

/** Compression d'une image ou d'un PDF vers une taille cible, sans moteur natif. */
export async function compressImage(
  file: SelectedFile,
  target: number,
  format: "jpeg" | "webp" | "png",
  context: { report: (p: { ratio?: number; label?: string }) => void; signal: AbortSignal },
): Promise<OperationOutcome> {
  const backend = getRasterBackend();
  if (!backend) throw new Error(t("Le rendu d'image n'est pas disponible."));
  const { canvas } = await decodeOriented(await readSelectedFile(file), file.extension);
  const lossy = format === "jpeg";
  let step = 0;
  const result = await fitToSize(
    async (quality, scale) => {
      const size = scaledSize(canvas.width, canvas.height, scale);
      const resized = scale >= 1 ? canvas : backend.resize(canvas, size.width, size.height);
      // JPEG n'a pas de transparence : le canvas est déjà aplati par l'encodeur.
      const data = await resized.encode(format, quality);
      if (resized !== canvas) resized.release?.();
      step += 1;
      context.report({ ratio: Math.min(0.95, step / 10), label: t("Essai {value}", { value: step }) });
      return { data, bytes: data.length };
    },
    target,
    { lossy, signal: context.signal },
  );
  const extension = format === "jpeg" ? "jpg" : format;
  const size = scaledSize(canvas.width, canvas.height, result.best.scale);
  return {
    files: [{ name: outputName(file.name, "taille", extension), bytes: result.best.data, mimeType: `image/${format}` }],
    summary: result.reached
      ? t("{size} pour une cible de {target} — {width} × {height} px{quality}.", {
          size: formatDecimalSize(result.best.bytes),
          target: formatDecimalSize(target),
          width: size.width,
          height: size.height,
          quality: lossy ? `, ${t("qualité {value} %", { value: Math.round(result.best.quality * 100) })}` : "",
        })
      : t("La cible n'a pas pu être atteinte : le plus petit résultat fait {size}.", { size: formatDecimalSize(result.best.bytes) }),
    warning: result.reached ? undefined : t("Même à définition très réduite, ce format ne passe pas sous {target}. Essayez JPEG ou une cible plus grande.", { target: formatDecimalSize(target) }),
  };
}

export async function compressPdfToSize(
  file: SelectedFile,
  target: number,
  context: { report: (p: { ratio?: number; label?: string }) => void; signal: AbortSignal },
): Promise<OperationOutcome> {
  const source = { name: file.name, bytes: await readBytes(file) };
  const levels: CompressionLevel[] = ["light", "balanced", "strong"];
  let best: Awaited<ReturnType<typeof compressPdf>> | undefined;
  for (const [index, level] of levels.entries()) {
    const result = await compressPdf(source, level, {
      signal: context.signal,
      report: (p) => context.report({ ratio: (index + (p.ratio ?? 0)) / levels.length, label: p.label }),
    });
    if (!best || result.compressedSize < best.compressedSize) best = result;
    if (result.compressedSize <= target) break;
  }
  const result = best as NonNullable<typeof best>;
  const reached = result.compressedSize <= target;
  return {
    files: [result.output],
    summary: reached
      ? t("{size} pour une cible de {target}.", { size: formatDecimalSize(result.compressedSize), target: formatDecimalSize(target) })
      : t("La cible n'a pas pu être atteinte : le plus petit résultat fait {size}.", { size: formatDecimalSize(result.compressedSize) }),
    warning: reached
      ? undefined
      : t("Les images du PDF sont déjà réduites au maximum du niveau « forte », et le texte ne se compresse pas davantage. FourTout ne transforme pas les pages en images pour gagner de la place.", {}),
  };
}
