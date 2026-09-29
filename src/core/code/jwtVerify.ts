/**
 * Vérification de la signature d'un JWT.
 *
 * Décoder un JWT, c'est lire du base64 ; le vérifier, c'est refaire le calcul
 * cryptographique avec la clé. Les deux opérations n'ont rien à voir, et la
 * confusion entre elles est la faille classique des applications qui manipulent
 * des jetons.
 *
 * Trois règles structurent ce module, et aucune n'est négociable :
 *
 * 1. **L'algorithme vient de l'utilisateur, jamais du token.** Faire confiance
 *    au champ `alg` de l'en-tête, c'est laisser l'attaquant choisir la manière
 *    dont on vérifie sa propre signature — d'où les attaques « alg: none » et
 *    « RS256 dégradé en HS256 ». Ici, l'en-tête est seulement *comparé* à ce que
 *    l'utilisateur attend, et toute divergence est un refus.
 * 2. **`alg: none` est refusé**, quelles que soient les circonstances.
 * 3. **Signature et claims sont deux verdicts distincts.** Un token peut être
 *    cryptographiquement authentique et pourtant inutilisable parce qu'il a
 *    expiré. Confondre les deux revient soit à accepter un token périmé, soit à
 *    faire croire à une signature falsifiée.
 *
 * La clé n'est jamais journalisée, ni conservée, ni envoyée ailleurs que dans le
 * calcul lui-même.
 */

import { decodeJwt, JwtError, type DecodedJwt } from "./tokens";

/** Algorithmes réellement vérifiés par FourTout. Aucun autre n'est annoncé. */
export const SUPPORTED_JWT_ALGORITHMS = [
  "HS256",
  "HS384",
  "HS512",
  "RS256",
  "RS384",
  "RS512",
] as const;

export type JwtAlgorithm = (typeof SUPPORTED_JWT_ALGORITHMS)[number];

export const JWT_ALGORITHM_LABELS: Record<JwtAlgorithm, string> = {
  HS256: "HS256 — HMAC SHA-256 (secret partagé)",
  HS384: "HS384 — HMAC SHA-384 (secret partagé)",
  HS512: "HS512 — HMAC SHA-512 (secret partagé)",
  RS256: "RS256 — RSA PKCS#1 v1.5 SHA-256 (clé publique)",
  RS384: "RS384 — RSA PKCS#1 v1.5 SHA-384 (clé publique)",
  RS512: "RS512 — RSA PKCS#1 v1.5 SHA-512 (clé publique)",
};

export function isSupportedAlgorithm(value: string): value is JwtAlgorithm {
  return (SUPPORTED_JWT_ALGORITHMS as readonly string[]).includes(value);
}

/** Famille de clé attendue par un algorithme. */
export function keyKindFor(algorithm: JwtAlgorithm): "secret" | "public-key" {
  return algorithm.startsWith("HS") ? "secret" : "public-key";
}

/** Verdict de la signature, séparé de toute considération sur les claims. */
export type SignatureVerdict =
  /** Le calcul a été fait et il concorde. */
  | "valid"
  /** Le calcul a été fait et il ne concorde pas. */
  | "invalid"
  /** Aucun calcul n'a été fait : la vérification a été refusée en amont. */
  | "refused";

export interface ClaimStatus {
  /** `exp` est dépassé. */
  expired: boolean;
  /** `nbf` n'est pas encore atteint. */
  notYetValid: boolean;
  /** Le token porte-t-il au moins une contrainte de temps ? */
  hasTimeBounds: boolean;
  /** Phrases à afficher, une par contrainte non satisfaite. */
  notes: string[];
}

export interface JwtVerification {
  signature: SignatureVerdict;
  /** Motif du refus, quand `signature` vaut `refused`. */
  refusal?: string;
  /** Algorithme annoncé par l'en-tête du token. */
  headerAlgorithm: string;
  /** Algorithme choisi par l'utilisateur, le seul qui ait servi. */
  expectedAlgorithm: JwtAlgorithm;
  decoded: DecodedJwt;
  claims: ClaimStatus;
  /**
   * Vrai si — et seulement si — la signature est valide **et** les contraintes
   * de temps sont satisfaites. C'est le seul champ qui répond à « puis-je m'en
   * servir ? ».
   */
  acceptable: boolean;
}

/**
 * Primitive de vérification.
 *
 * Injectée plutôt qu'importée : la politique ci-dessous se teste ainsi sans
 * cryptographie, et la cryptographie se teste sans politique.
 */
export interface SignatureCheckInput {
  algorithm: JwtAlgorithm;
  /** `header.payload`, tel qu'il a été signé, en ASCII. */
  signingInput: string;
  /** Signature du token, en base64url. */
  signature: string;
  /** Secret partagé (HS*) ou clé publique PEM (RS*). */
  key: string;
}

export type SignatureChecker = (input: SignatureCheckInput) => Promise<boolean>;

export class JwtVerifyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JwtVerifyError";
  }
}

function claimStatus(decoded: DecodedJwt, now: Date): ClaimStatus {
  const seconds = Math.floor(now.getTime() / 1000);
  const exp = decoded.payload.exp;
  const nbf = decoded.payload.nbf;
  const expired = typeof exp === "number" && exp <= seconds;
  const notYetValid = typeof nbf === "number" && nbf > seconds;
  const notes: string[] = [];
  if (expired) notes.push("Le token a expiré : son `exp` est dans le passé.");
  if (notYetValid) notes.push("Le token n'est pas encore valide : son `nbf` est dans le futur.");
  return {
    expired,
    notYetValid,
    hasTimeBounds: typeof exp === "number" || typeof nbf === "number",
    notes,
  };
}

/**
 * Vérifie un JWT avec l'algorithme et la clé fournis par l'utilisateur.
 *
 * Ne lève que si le token est illisible : un refus de politique ou une
 * signature fausse sont des *résultats*, pas des erreurs.
 */
export async function verifyJwt(
  token: string,
  options: { algorithm: JwtAlgorithm; key: string; now?: Date },
  check: SignatureChecker,
): Promise<JwtVerification> {
  const now = options.now ?? new Date();
  const decoded = decodeJwt(token, now);
  const claims = claimStatus(decoded, now);
  const headerAlgorithm = decoded.algorithm;

  const refuse = (refusal: string): JwtVerification => ({
    signature: "refused",
    refusal,
    headerAlgorithm,
    expectedAlgorithm: options.algorithm,
    decoded,
    claims,
    acceptable: false,
  });

  if (headerAlgorithm.toLowerCase() === "none") {
    return refuse(
      "L'en-tête annonce « alg: none » : le token n'est pas signé. FourTout refuse de le " +
        "déclarer valide, quelle que soit la clé fournie — c'est exactement la forgerie que " +
        "cette vérification doit empêcher.",
    );
  }
  if (!isSupportedAlgorithm(headerAlgorithm)) {
    return refuse(
      `L'en-tête annonce l'algorithme « ${headerAlgorithm} », que FourTout ne sait pas vérifier. ` +
        `Algorithmes pris en charge : ${SUPPORTED_JWT_ALGORITHMS.join(", ")}.`,
    );
  }
  if (headerAlgorithm !== options.algorithm) {
    return refuse(
      `Divergence d'algorithme : l'en-tête du token annonce « ${headerAlgorithm} », vous attendez ` +
        `« ${options.algorithm} ». Vérifier avec un autre algorithme que celui attendu est la faille ` +
        `classique des JWT : la vérification s'arrête ici.`,
    );
  }
  if (options.key.length === 0) {
    return refuse(
      keyKindFor(options.algorithm) === "secret"
        ? "Aucun secret fourni : il n'y a rien avec quoi vérifier."
        : "Aucune clé publique fournie : il n'y a rien avec quoi vérifier.",
    );
  }

  const parts = token.trim().replace(/^Bearer\s+/i, "").split(".");
  const valid = await check({
    algorithm: options.algorithm,
    signingInput: `${parts[0]}.${parts[1]}`,
    signature: parts[2],
    key: options.key,
  });

  return {
    signature: valid ? "valid" : "invalid",
    headerAlgorithm,
    expectedAlgorithm: options.algorithm,
    decoded,
    claims,
    acceptable: valid && !claims.expired && !claims.notYetValid,
  };
}

/** Phrase de synthèse, volontairement sans raccourci. */
export function verdictSentence(result: JwtVerification): string {
  if (result.signature === "refused") return "Vérification refusée.";
  if (result.signature === "invalid") {
    return "Signature invalide : ce token n'a pas été produit avec cette clé (ou il a été modifié).";
  }
  if (result.claims.expired) {
    return "Signature valide, mais le token est expiré : il est authentique et inutilisable.";
  }
  if (result.claims.notYetValid) {
    return "Signature valide, mais le token n'est pas encore valide (nbf dans le futur).";
  }
  return "Signature valide, et aucune contrainte de temps n'est violée.";
}

export { JwtError };
