/**
 * Sous-titres SRT et WebVTT.
 *
 * Les deux formats partagent la même structure ; seuls le séparateur décimal,
 * l'en-tête et la numérotation changent. Les segments viennent de la
 * transcription et restent modifiables par l'utilisateur avant export : le
 * texte exporté est donc toujours celui affiché, aux horodatages d'origine.
 */

/** Un passage transcrit, en millisecondes depuis le début du média. */
export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

function clamp(ms: number): number {
  return Number.isFinite(ms) && ms > 0 ? Math.round(ms) : 0;
}

function parts(ms: number): { h: number; m: number; s: number; msec: number } {
  const total = clamp(ms);
  return {
    h: Math.floor(total / 3_600_000),
    m: Math.floor(total / 60_000) % 60,
    s: Math.floor(total / 1000) % 60,
    msec: total % 1000,
  };
}

const pad = (value: number, size = 2) => String(value).padStart(size, "0");

/** `00:00:02,350` — horodatage SRT (virgule décimale). */
export function formatSrtTime(ms: number): string {
  const { h, m, s, msec } = parts(ms);
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(msec, 3)}`;
}

/** `00:00:02.350` — horodatage WebVTT (point décimal). */
export function formatVttTime(ms: number): string {
  const { h, m, s, msec } = parts(ms);
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(msec, 3)}`;
}

/**
 * Ne garde que les passages exportables : texte non vide, horodatages
 * croissants. Un segment dont la fin précède le début reçoit une durée
 * minimale plutôt que d'être rejeté (le lecteur refuserait le fichier).
 */
export function exportableSegments(segments: readonly TranscriptSegment[]): TranscriptSegment[] {
  return segments
    .map((segment) => {
      const start = clamp(segment.start);
      const end = clamp(segment.end);
      return { start, end: end > start ? end : start + 500, text: segment.text.trim() };
    })
    .filter((segment) => segment.text.length > 0);
}

/** Génère un fichier SRT complet (UTF-8, accents conservés tels quels). */
export function toSrt(segments: readonly TranscriptSegment[]): string {
  return exportableSegments(segments)
    .map((segment, index) =>
      [
        String(index + 1),
        `${formatSrtTime(segment.start)} --> ${formatSrtTime(segment.end)}`,
        segment.text,
        "",
      ].join("\n"),
    )
    .join("\n");
}

/** Génère un fichier WebVTT complet. */
export function toVtt(segments: readonly TranscriptSegment[]): string {
  const blocks = exportableSegments(segments).map((segment) =>
    [`${formatVttTime(segment.start)} --> ${formatVttTime(segment.end)}`, segment.text, ""].join("\n"),
  );
  return ["WEBVTT", "", ...blocks].join("\n");
}

/** Texte brut de la transcription, un passage par ligne. */
export function toPlainText(segments: readonly TranscriptSegment[]): string {
  return exportableSegments(segments)
    .map((segment) => segment.text)
    .join("\n");
}
