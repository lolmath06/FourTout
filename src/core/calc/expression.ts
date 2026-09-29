/**
 * Évaluateur d'expressions mathématiques.
 *
 * **Aucun `eval`, aucun `new Function`.** Une calculatrice qui évalue la chaîne
 * saisie par l'utilisateur avec le moteur JavaScript exécute du code arbitraire
 * dans le contexte de l'application : dans une WebView qui a accès aux
 * commandes natives de FourTout, c'est une porte ouverte sur le système de
 * fichiers. On écrit donc un vrai analyseur : lexeur, parseur en descente
 * récursive, évaluation.
 *
 * La grammaire, par précédence croissante :
 *
 *   expression := terme (("+" | "-") terme)*
 *   terme      := facteur (("*" | "/" | "%") facteur)*
 *   facteur    := unaire ("^" facteur)?          — associatif à droite
 *   unaire     := ("+" | "-") unaire | postfixe
 *   postfixe   := primaire "!"*
 *   primaire   := nombre | constante | fonction "(" args ")" | "(" expression ")"
 */

export type AngleMode = "deg" | "rad";

export interface EvaluationResult {
  value: number;
  /** Expression normalisée, telle que la calculatrice l'a comprise. */
  normalized: string;
}

export class ExpressionError extends Error {
  constructor(
    message: string,
    /** Position (0-indexée) dans l'expression, quand elle est connue. */
    readonly position?: number,
  ) {
    super(message);
    this.name = "ExpressionError";
  }
}

type TokenType = "number" | "identifier" | "operator" | "lparen" | "rparen" | "comma";

interface Token {
  type: TokenType;
  text: string;
  value?: number;
  position: number;
}

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  π: Math.PI,
  e: Math.E,
  tau: Math.PI * 2,
};

/** Fonctions à un argument. Les trigonométriques respectent le mode angulaire. */
type UnaryFn = (value: number, mode: AngleMode) => number;

const toRadians = (value: number, mode: AngleMode) => (mode === "deg" ? (value * Math.PI) / 180 : value);
const fromRadians = (value: number, mode: AngleMode) => (mode === "deg" ? (value * 180) / Math.PI : value);

const FUNCTIONS: Record<string, UnaryFn> = {
  sin: (v, m) => Math.sin(toRadians(v, m)),
  cos: (v, m) => Math.cos(toRadians(v, m)),
  tan: (v, m) => Math.tan(toRadians(v, m)),
  asin: (v, m) => fromRadians(Math.asin(v), m),
  acos: (v, m) => fromRadians(Math.acos(v), m),
  atan: (v, m) => fromRadians(Math.atan(v), m),
  sinh: (v) => Math.sinh(v),
  cosh: (v) => Math.cosh(v),
  tanh: (v) => Math.tanh(v),
  ln: (v) => Math.log(v),
  log: (v) => Math.log10(v),
  log2: (v) => Math.log2(v),
  exp: (v) => Math.exp(v),
  sqrt: (v) => Math.sqrt(v),
  cbrt: (v) => Math.cbrt(v),
  abs: (v) => Math.abs(v),
  round: (v) => Math.round(v),
  floor: (v) => Math.floor(v),
  ceil: (v) => Math.ceil(v),
  sign: (v) => Math.sign(v),
  fact: (v) => factorial(v),
};

/** Fonctions à deux arguments, appelées `f(a; b)` ou `f(a, b)`. */
const BINARY_FUNCTIONS: Record<string, (a: number, b: number) => number> = {
  pow: (a, b) => a ** b,
  root: (a, b) => (b === 0 ? Number.NaN : Math.sign(a) * Math.abs(a) ** (1 / b)),
  min: (a, b) => Math.min(a, b),
  max: (a, b) => Math.max(a, b),
  mod: (a, b) => a % b,
  atan2: (a, b) => Math.atan2(a, b),
};

/** Au-delà, la factorielle dépasse déjà largement `Number.MAX_VALUE`. */
const MAX_FACTORIAL = 170;

function factorial(value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new ExpressionError("La factorielle n'accepte qu'un entier positif.");
  }
  if (value > MAX_FACTORIAL) {
    throw new ExpressionError(`La factorielle n'est calculable que jusqu'à ${MAX_FACTORIAL}!.`);
  }
  let result = 1;
  for (let i = 2; i <= value; i += 1) result *= i;
  return result;
}

/** Symboles saisis au clavier ou collés, ramenés à la forme canonique. */
function normalize(input: string): string {
  return input
    .replace(/[×✕⋅·]/g, "*")
    .replace(/[÷∕]/g, "/")
    .replace(/[–—−]/g, "-")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/\bPI\b/gi, "pi");
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const char = source[i];
    if (char === " " || char === "\t" || char === "\n") {
      i += 1;
      continue;
    }
    if (/[0-9.]/.test(char)) {
      const start = i;
      while (i < source.length && /[0-9]/.test(source[i])) i += 1;
      if (source[i] === "." || source[i] === ",") {
        i += 1;
        while (i < source.length && /[0-9]/.test(source[i])) i += 1;
      }
      if (/[eE]/.test(source[i] ?? "") && /[0-9+-]/.test(source[i + 1] ?? "")) {
        i += 1;
        if (/[+-]/.test(source[i])) i += 1;
        while (i < source.length && /[0-9]/.test(source[i])) i += 1;
      }
      const text = source.slice(start, i).replace(",", ".");
      const value = Number(text);
      if (!Number.isFinite(value)) {
        throw new ExpressionError(`Nombre invalide : « ${text} »`, start);
      }
      tokens.push({ type: "number", text, value, position: start });
      continue;
    }
    if (/[a-zA-Zπ_]/.test(char)) {
      const start = i;
      while (i < source.length && /[a-zA-Z0-9π_]/.test(source[i])) i += 1;
      tokens.push({ type: "identifier", text: source.slice(start, i), position: start });
      continue;
    }
    if (char === "(") {
      tokens.push({ type: "lparen", text: char, position: i });
      i += 1;
      continue;
    }
    if (char === ")") {
      tokens.push({ type: "rparen", text: char, position: i });
      i += 1;
      continue;
    }
    if (char === "," || char === ";") {
      tokens.push({ type: "comma", text: char, position: i });
      i += 1;
      continue;
    }
    if ("+-*/^%!√".includes(char)) {
      tokens.push({ type: "operator", text: char, position: i });
      i += 1;
      continue;
    }
    throw new ExpressionError(`Caractère inattendu : « ${char} »`, i);
  }
  return tokens;
}

class Parser {
  private index = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly mode: AngleMode,
  ) {}

  parse(): number {
    const value = this.expression();
    const rest = this.tokens[this.index];
    if (rest) {
      throw new ExpressionError(`Élément en trop : « ${rest.text} »`, rest.position);
    }
    return value;
  }

  private peek(): Token | undefined {
    return this.tokens[this.index];
  }

  private eat(type: TokenType, text?: string): Token | undefined {
    const token = this.peek();
    if (token && token.type === type && (text === undefined || token.text === text)) {
      this.index += 1;
      return token;
    }
    return undefined;
  }

  private expression(): number {
    let left = this.term();
    for (;;) {
      const plus = this.eat("operator", "+");
      const minus = plus ? undefined : this.eat("operator", "-");
      if (!plus && !minus) return left;
      const right = this.term();
      left = plus ? left + right : left - right;
    }
  }

  private term(): number {
    let left = this.factor();
    for (;;) {
      const times = this.eat("operator", "*");
      const divide = times ? undefined : this.eat("operator", "/");
      const modulo = times || divide ? undefined : this.eat("operator", "%");
      if (!times && !divide && !modulo) return left;
      const right = this.factor();
      if (divide && right === 0) throw new ExpressionError("Division par zéro.");
      if (modulo && right === 0) throw new ExpressionError("Modulo par zéro.");
      left = times ? left * right : divide ? left / right : left % right;
    }
  }

  private factor(): number {
    const base = this.unary();
    // `^` est associatif à droite : 2^3^2 vaut 2^9, pas 8^2.
    if (this.eat("operator", "^")) return base ** this.factor();
    return base;
  }

  /**
   * Le moins unaire est **moins prioritaire** que la puissance : `-2^2` vaut
   * −4, comme en mathématiques et comme dans un tableur. On délègue donc à
   * `factor`, qui a déjà consommé l'exposant, avant de changer le signe.
   */
  private unary(): number {
    if (this.eat("operator", "-")) return -this.factor();
    if (this.eat("operator", "+")) return this.factor();
    if (this.eat("operator", "√")) return Math.sqrt(this.factor());
    return this.postfix();
  }

  private postfix(): number {
    let value = this.primary();
    while (this.eat("operator", "!")) value = factorial(value);
    return value;
  }

  private primary(): number {
    const token = this.peek();
    if (!token) throw new ExpressionError("Expression incomplète.");

    if (this.eat("lparen")) {
      const value = this.expression();
      if (!this.eat("rparen")) {
        throw new ExpressionError("Parenthèse fermante manquante.", token.position);
      }
      return value;
    }

    const number = this.eat("number");
    if (number) return number.value as number;

    const identifier = this.eat("identifier");
    if (identifier) {
      const name = identifier.text.toLowerCase();
      if (this.eat("lparen")) {
        const args = [this.expression()];
        while (this.eat("comma")) args.push(this.expression());
        if (!this.eat("rparen")) {
          throw new ExpressionError("Parenthèse fermante manquante.", identifier.position);
        }
        const binary = BINARY_FUNCTIONS[name];
        if (binary) {
          if (args.length !== 2) {
            throw new ExpressionError(`${name} attend deux arguments.`, identifier.position);
          }
          return binary(args[0], args[1]);
        }
        const unary = FUNCTIONS[name];
        if (unary) {
          if (args.length !== 1) {
            throw new ExpressionError(`${name} attend un seul argument.`, identifier.position);
          }
          return unary(args[0], this.mode);
        }
        throw new ExpressionError(`Fonction inconnue : « ${identifier.text} »`, identifier.position);
      }
      const constant = CONSTANTS[name] ?? CONSTANTS[identifier.text];
      if (constant !== undefined) return constant;
      throw new ExpressionError(`Nom inconnu : « ${identifier.text} »`, identifier.position);
    }

    throw new ExpressionError(`Élément inattendu : « ${token.text} »`, token.position);
  }
}

/**
 * Évalue une expression. Lève une `ExpressionError` explicite plutôt que de
 * renvoyer `NaN` : l'utilisateur doit savoir *ce qui* ne va pas.
 */
export function evaluateExpression(input: string, mode: AngleMode = "deg"): EvaluationResult {
  const normalized = normalize(input).trim();
  if (normalized.length === 0) throw new ExpressionError("Expression vide.");
  const value = new Parser(tokenize(normalized), mode).parse();
  if (Number.isNaN(value)) {
    throw new ExpressionError("Le résultat n'est pas un nombre (domaine de définition dépassé).");
  }
  if (!Number.isFinite(value)) throw new ExpressionError("Le résultat est infini.");
  return { value, normalized };
}

/** Liste affichée dans l'aide de l'outil. */
export const FUNCTION_NAMES = [...Object.keys(FUNCTIONS), ...Object.keys(BINARY_FUNCTIONS)].sort();
export const CONSTANT_NAMES = ["pi", "π", "e", "tau"];
