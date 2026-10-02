/**
 * Format des messages : un sous-ensemble volontairement réduit d'ICU.
 *
 * - `{name}` : valeur interpolée telle quelle ;
 * - `{count, plural, one {# fichier} other {# fichiers}}` : forme choisie par
 *   `Intl.PluralRules` pour la langue active (`=0`, `=1`… acceptés), `#`
 *   remplacé par le nombre formaté ;
 * - `<0>…</0>`, `<1/>` : balises numérotées, rendues par `<Trans>` avec les
 *   éléments fournis — le texte autour reste traduisible d'un seul tenant.
 *
 * Un message mal formé ne casse jamais l'interface : la partie illisible est
 * rendue telle quelle.
 */

export type MessageValue = string | number | boolean | null | undefined | object;
export type MessageValues = Record<string, MessageValue>;

/** Nœud d'un message analysé. */
export type MessagePart =
  | { kind: "text"; value: string }
  | { kind: "arg"; name: string }
  | { kind: "plural"; name: string; offset: number; options: Record<string, MessagePart[]> }
  | { kind: "pound" }
  | { kind: "tag"; index: number; children: MessagePart[] | null };

const cache = new Map<string, MessagePart[]>();

export function parseMessage(message: string): MessagePart[] {
  const cached = cache.get(message);
  if (cached) return cached;
  let parts: MessagePart[];
  try {
    const parser = new Parser(message);
    parts = parser.parse(false, null);
  } catch {
    parts = [{ kind: "text", value: message }];
  }
  cache.set(message, parts);
  return parts;
}

class Parser {
  private pos = 0;

  constructor(private readonly src: string) {}

  /**
   * @param inPlural `#` n'a de sens que dans une branche de pluriel.
   * @param closingTag index de la balise dont on attend la fermeture.
   */
  parse(inPlural: boolean, closingTag: number | null): MessagePart[] {
    const parts: MessagePart[] = [];
    let text = "";
    const flush = () => {
      if (text) parts.push({ kind: "text", value: text });
      text = "";
    };
    while (this.pos < this.src.length) {
      const char = this.src[this.pos];
      if (char === "}" && inPlural) break;
      if (char === "{") {
        flush();
        parts.push(this.parseArgument());
        continue;
      }
      if (char === "#" && inPlural) {
        flush();
        parts.push({ kind: "pound" });
        this.pos += 1;
        continue;
      }
      if (char === "<") {
        const close = /^<\/(\d+)>/.exec(this.src.slice(this.pos));
        if (close) {
          if (closingTag !== null && Number(close[1]) === closingTag) {
            flush();
            this.pos += close[0].length;
            return parts;
          }
          throw new Error("balise fermante inattendue");
        }
        const open = /^<(\d+)(\/?)>/.exec(this.src.slice(this.pos));
        if (open) {
          flush();
          this.pos += open[0].length;
          const index = Number(open[1]);
          if (open[2] === "/") {
            parts.push({ kind: "tag", index, children: null });
          } else {
            parts.push({ kind: "tag", index, children: this.parse(inPlural, index) });
          }
          continue;
        }
      }
      text += char;
      this.pos += 1;
    }
    if (closingTag !== null) throw new Error("balise non fermée");
    flush();
    return parts;
  }

  private parseArgument(): MessagePart {
    // `{` déjà vu.
    this.pos += 1;
    const end = this.findTopLevel([",", "}"]);
    const name = this.src.slice(this.pos, end).trim();
    if (!/^[\p{L}\p{N}_]+$/u.test(name)) throw new Error("argument invalide");
    this.pos = end;
    if (this.src[this.pos] === "}") {
      this.pos += 1;
      return { kind: "arg", name };
    }
    // `, plural, …`
    this.pos += 1;
    const typeEnd = this.src.indexOf(",", this.pos);
    if (typeEnd < 0) throw new Error("type manquant");
    const type = this.src.slice(this.pos, typeEnd).trim();
    if (type !== "plural") throw new Error(`type non pris en charge : ${type}`);
    this.pos = typeEnd + 1;
    const options: Record<string, MessagePart[]> = {};
    let offset = 0;
    for (;;) {
      this.skipSpace();
      if (this.src[this.pos] === "}") {
        this.pos += 1;
        break;
      }
      const selectorMatch = /^(offset:\d+|=\d+|zero|one|two|few|many|other)/.exec(
        this.src.slice(this.pos),
      );
      if (!selectorMatch) throw new Error("sélecteur invalide");
      this.pos += selectorMatch[0].length;
      if (selectorMatch[0].startsWith("offset:")) {
        offset = Number(selectorMatch[0].slice(7));
        continue;
      }
      this.skipSpace();
      if (this.src[this.pos] !== "{") throw new Error("branche attendue");
      this.pos += 1;
      options[selectorMatch[0]] = this.parse(true, null);
      if (this.src[this.pos] !== "}") throw new Error("branche non fermée");
      this.pos += 1;
    }
    if (!options.other) throw new Error("branche other manquante");
    return { kind: "plural", name, offset, options };
  }

  private findTopLevel(chars: string[]): number {
    for (let i = this.pos; i < this.src.length; i += 1) {
      if (chars.includes(this.src[i])) return i;
    }
    throw new Error("argument non fermé");
  }

  private skipSpace(): void {
    while (/\s/.test(this.src[this.pos] ?? "")) this.pos += 1;
  }
}

const pluralRulesCache = new Map<string, Intl.PluralRules>();
const numberFormatCache = new Map<string, Intl.NumberFormat>();

function pluralCategory(locale: string, value: number): string {
  let rules = pluralRulesCache.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRulesCache.set(locale, rules);
  }
  return rules.select(value);
}

function formatPound(locale: string, value: number): string {
  let format = numberFormatCache.get(locale);
  if (!format) {
    format = new Intl.NumberFormat(locale, { maximumFractionDigits: 20 });
    numberFormatCache.set(locale, format);
  }
  return format.format(value);
}

/**
 * Résout un message en une suite de morceaux : chaînes, valeurs (qui peuvent
 * être des éléments React) et balises.
 */
export type ResolvedPart =
  | string
  | { value: MessageValue }
  | { tag: number; children: ResolvedPart[] | null };

export function resolveMessage(
  parts: MessagePart[],
  values: MessageValues | undefined,
  locale: string,
  pound?: number,
): ResolvedPart[] {
  const out: ResolvedPart[] = [];
  for (const part of parts) {
    switch (part.kind) {
      case "text":
        out.push(part.value);
        break;
      case "pound":
        out.push(pound === undefined ? "#" : formatPound(locale, pound));
        break;
      case "arg": {
        if (values && part.name in values) out.push({ value: values[part.name] });
        else out.push(`{${part.name}}`);
        break;
      }
      case "plural": {
        const raw = values?.[part.name];
        const number = typeof raw === "number" ? raw : Number(raw);
        const value = Number.isFinite(number) ? number - part.offset : 0;
        const exact = part.options[`=${number}`];
        const branch = exact ?? part.options[pluralCategory(locale, value)] ?? part.options.other;
        out.push(...resolveMessage(branch, values, locale, value));
        break;
      }
      case "tag":
        out.push({
          tag: part.index,
          children: part.children ? resolveMessage(part.children, values, locale, pound) : null,
        });
        break;
    }
  }
  return out;
}

/** Version texte : les balises sont retirées, leurs contenus conservés. */
export function formatMessageToString(
  message: string,
  values: MessageValues | undefined,
  locale: string,
): string {
  if (!values && !message.includes("{") && !message.includes("<")) return message;
  return flatten(resolveMessage(parseMessage(message), values, locale));
}

function flatten(parts: ResolvedPart[]): string {
  let text = "";
  for (const part of parts) {
    if (typeof part === "string") text += part;
    else if ("value" in part) text += part.value == null ? "" : String(part.value);
    else if (part.children) text += flatten(part.children);
  }
  return text;
}

/** Noms des arguments et balises d'un message : sert aux tests de cohérence. */
export function messageSignature(message: string): { args: string[]; tags: number[] } {
  const args = new Set<string>();
  const tags = new Set<number>();
  const walk = (parts: MessagePart[]) => {
    for (const part of parts) {
      if (part.kind === "arg") args.add(part.name);
      else if (part.kind === "plural") {
        args.add(part.name);
        Object.values(part.options).forEach(walk);
      } else if (part.kind === "tag") {
        tags.add(part.index);
        if (part.children) walk(part.children);
      }
    }
  };
  walk(parseMessage(message));
  return { args: [...args].sort(), tags: [...tags].sort((a, b) => a - b) };
}

/** Vrai si le message s'analyse sans erreur (pas de repli en texte brut). */
export function isWellFormed(message: string): boolean {
  try {
    new Parser(message).parse(false, null);
    return true;
  } catch {
    return false;
  }
}

/**
 * Identifiant stable d'un message : empreinte FNV-1a 32 bits de son texte
 * source, en base 36. Les fichiers de traduction restent ainsi compacts ; la
 * correspondance avec le texte source est dans `messages/fr.json`.
 */
export function messageId(source: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
