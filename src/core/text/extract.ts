/** Extraction d'éléments repérables dans un texte (liens, e-mails, nombres). */

const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"'()]+[^\s<>"'().,;:!?]/gi;
const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const NUMBER_PATTERN = /-?\d{1,3}(?:[\u0020\u00A0\u202F]\d{3})+(?:[.,]\d+)?|-?\d+(?:[.,]\d+)?/g;

export interface ExtractionResult {
  values: string[];
  /** Occurrences retirées parce qu'elles étaient déjà présentes. */
  duplicates: number;
}

function dedupe(values: string[], unique: boolean): ExtractionResult {
  if (!unique) return { values, duplicates: 0 };
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    kept.push(value);
  }
  return { values: kept, duplicates: values.length - kept.length };
}

export function extractUrls(text: string, unique = true): ExtractionResult {
  return dedupe(text.match(URL_PATTERN) ?? [], unique);
}

export function extractEmails(text: string, unique = true): ExtractionResult {
  return dedupe((text.match(EMAIL_PATTERN) ?? []).map((value) => value.toLowerCase()), unique);
}

export interface NumberExtraction extends ExtractionResult {
  sum: number;
  average: number;
  min: number;
  max: number;
}

export function extractNumbers(text: string, unique = false): NumberExtraction {
  const raw = text.match(NUMBER_PATTERN) ?? [];
  const base = dedupe(raw, unique);
  const parsed = base.values
    .map((value) => Number(value.replace(/[\u0020\u00A0\u202F]/g, "").replace(",", ".")))
    .filter((value) => Number.isFinite(value));
  const sum = parsed.reduce((total, value) => total + value, 0);
  return {
    ...base,
    sum,
    average: parsed.length === 0 ? 0 : sum / parsed.length,
    min: parsed.length === 0 ? 0 : Math.min(...parsed),
    max: parsed.length === 0 ? 0 : Math.max(...parsed),
  };
}
