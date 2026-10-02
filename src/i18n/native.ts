import templates from "./native.json";

/**
 * Reconnaissance des messages du socle natif.
 *
 * Le code Rust renvoie ses messages en français, souvent composés
 * (« Création impossible : Permission denied »). `scripts/i18n/native.mjs`
 * recense leurs gabarits (« Création impossible : {e} ») ; ici, un message
 * reçu est rapproché de son gabarit, qui est un message ordinaire du
 * catalogue, avec les valeurs qu'il contenait.
 */

interface CompiledTemplate {
  template: string;
  pattern: RegExp;
  names: string[];
  /** Le plus long morceau fixe : un filtre rapide avant l'expression régulière. */
  anchor: string;
}

let compiled: CompiledTemplate[] | undefined;

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compile(): CompiledTemplate[] {
  return (templates as string[])
    .filter((template) => template.includes("{"))
    .map((template) => {
      const pieces = template.split(/\{([\p{L}\p{N}_]+)\}/u);
      const literals = pieces.filter((_, index) => index % 2 === 0);
      const names = pieces.filter((_, index) => index % 2 === 1);
      const pattern = new RegExp(`^${literals.map(escape).join("([\\s\\S]+?)")}$`, "u");
      const anchor = literals.reduce((best, piece) => (piece.length > best.length ? piece : best), "");
      return { template, pattern, names, anchor };
    })
    .filter((entry) => entry.anchor.trim().length >= 3)
    // Les gabarits les plus précis d'abord.
    .sort((a, b) => literalLength(b.template) - literalLength(a.template));
}

function literalLength(template: string): number {
  return template.replace(/\{[^}]*\}/g, "").length;
}

export interface NativeMatch {
  template: string;
  values: Record<string, string>;
}

const cache = new Map<string, NativeMatch | null>();

/** Gabarit natif correspondant à un message, ou `undefined`. */
export function matchNativeMessage(text: string): NativeMatch | undefined {
  const cached = cache.get(text);
  if (cached !== undefined) return cached ?? undefined;
  compiled ??= compile();
  let found: NativeMatch | null = null;
  for (const entry of compiled) {
    if (!text.includes(entry.anchor)) continue;
    const match = entry.pattern.exec(text);
    if (!match) continue;
    const values: Record<string, string> = {};
    entry.names.forEach((name, index) => {
      values[name] = match[index + 1];
    });
    found = { template: entry.template, values };
    break;
  }
  if (cache.size > 2000) cache.clear();
  cache.set(text, found);
  return found ?? undefined;
}
