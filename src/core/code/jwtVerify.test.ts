import { describe, expect, it } from "vitest";
import {
  keyKindFor,
  SUPPORTED_JWT_ALGORITHMS,
  verdictSentence,
  verifyJwt,
  type SignatureChecker,
} from "./jwtVerify";
import { JwtError } from "./tokens";

/* ------------------------------------------------------------------------ */
/* Fabrication de jetons de test                                             */
/* ------------------------------------------------------------------------ */

const encoder = new TextEncoder();

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const encodeJson = (value: unknown) => base64Url(encoder.encode(JSON.stringify(value)));

async function hmac(secret: string, message: string, hash: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

/** Fabrique un JWT HS* signé, pour n'avoir aucune constante opaque dans les tests. */
async function makeToken(
  payload: Record<string, unknown>,
  secret: string,
  algorithm: "HS256" | "HS384" | "HS512" = "HS256",
): Promise<string> {
  const header = encodeJson({ alg: algorithm, typ: "JWT" });
  const body = encodeJson(payload);
  const hash = `SHA-${algorithm.slice(2)}`;
  const signature = base64Url(await hmac(secret, `${header}.${body}`, hash));
  return `${header}.${body}.${signature}`;
}

/**
 * Vérificateur de référence pour les tests : la même primitive que le moteur
 * natif, mais indépendante de lui. Les tests de politique ne dépendent donc pas
 * de la disponibilité de Tauri.
 */
const testChecker: SignatureChecker = async ({ algorithm, signingInput, signature, key }) => {
  if (!algorithm.startsWith("HS")) throw new Error("Ce vérificateur de test ne fait que du HMAC.");
  const expected = base64Url(await hmac(key, signingInput, `SHA-${algorithm.slice(2)}`));
  return expected === signature.replace(/=+$/, "");
};

/** Vérificateur qui échoue si on l'appelle : prouve qu'un refus n'a rien calculé. */
const neverCalled: SignatureChecker = async () => {
  throw new Error("la cryptographie n'aurait pas dû être appelée");
};

const SECRET = "fourtout-secret-de-test";
const now = new Date("2026-06-15T12:00:00Z");
const seconds = Math.floor(now.getTime() / 1000);

describe("JWT — vérification de signature", () => {
  it("valide un token signé avec la bonne clé", async () => {
    const token = await makeToken({ sub: "alice" }, SECRET);
    const result = await verifyJwt(token, { algorithm: "HS256", key: SECRET, now }, testChecker);
    expect(result.signature).toBe("valid");
    expect(result.acceptable).toBe(true);
    expect(result.claims.hasTimeBounds).toBe(false);
  });

  it("invalide un token signé avec une autre clé", async () => {
    const token = await makeToken({ sub: "alice" }, SECRET);
    const result = await verifyJwt(
      token,
      { algorithm: "HS256", key: "mauvais-secret", now },
      testChecker,
    );
    expect(result.signature).toBe("invalid");
    expect(result.acceptable).toBe(false);
    expect(verdictSentence(result)).toMatch(/pas été produit avec cette clé/);
  });

  it("invalide un token dont la charge utile a été modifiée", async () => {
    const token = await makeToken({ sub: "alice", role: "lecteur" }, SECRET);
    const [header, , signature] = token.split(".");
    const falsified = `${header}.${encodeJson({ sub: "alice", role: "admin" })}.${signature}`;
    const result = await verifyJwt(
      falsified,
      { algorithm: "HS256", key: SECRET, now },
      testChecker,
    );
    expect(result.signature).toBe("invalid");
  });

  it("vérifie aussi HS384 et HS512", async () => {
    for (const algorithm of ["HS384", "HS512"] as const) {
      const token = await makeToken({ sub: "alice" }, SECRET, algorithm);
      const result = await verifyJwt(token, { algorithm, key: SECRET, now }, testChecker);
      expect(result.signature, algorithm).toBe("valid");
    }
  });
});

describe("JWT — signature et claims sont deux verdicts", () => {
  it("dit « signature valide, mais expiré » plutôt que « invalide »", async () => {
    const token = await makeToken({ sub: "alice", exp: seconds - 3600 }, SECRET);
    const result = await verifyJwt(token, { algorithm: "HS256", key: SECRET, now }, testChecker);
    expect(result.signature).toBe("valid");
    expect(result.claims.expired).toBe(true);
    expect(result.acceptable).toBe(false);
    expect(verdictSentence(result)).toMatch(/authentique et inutilisable/);
  });

  it("dit « signature valide, mais pas encore valide » pour un nbf futur", async () => {
    const token = await makeToken({ sub: "alice", nbf: seconds + 3600 }, SECRET);
    const result = await verifyJwt(token, { algorithm: "HS256", key: SECRET, now }, testChecker);
    expect(result.signature).toBe("valid");
    expect(result.claims.notYetValid).toBe(true);
    expect(result.claims.expired).toBe(false);
    expect(result.acceptable).toBe(false);
  });

  it("accepte un token encore valide", async () => {
    const token = await makeToken(
      { sub: "alice", iat: seconds - 60, nbf: seconds - 60, exp: seconds + 3600 },
      SECRET,
    );
    const result = await verifyJwt(token, { algorithm: "HS256", key: SECRET, now }, testChecker);
    expect(result.acceptable).toBe(true);
    expect(result.claims.hasTimeBounds).toBe(true);
    expect(result.claims.notes).toHaveLength(0);
  });

  it("n'accepte jamais un token expiré, même bien signé", async () => {
    const token = await makeToken({ exp: seconds - 1 }, SECRET);
    const result = await verifyJwt(token, { algorithm: "HS256", key: SECRET, now }, testChecker);
    expect(result.acceptable).toBe(false);
  });
});

describe("JWT — refus de politique", () => {
  it("refuse « alg: none » sans rien calculer", async () => {
    const header = encodeJson({ alg: "none", typ: "JWT" });
    const token = `${header}.${encodeJson({ sub: "alice" })}.x`;
    const result = await verifyJwt(token, { algorithm: "HS256", key: SECRET, now }, neverCalled);
    expect(result.signature).toBe("refused");
    expect(result.refusal).toMatch(/n'est pas signé/);
    expect(result.acceptable).toBe(false);
  });

  it("refuse un algorithme différent de celui attendu", async () => {
    const token = await makeToken({ sub: "alice" }, SECRET, "HS256");
    const result = await verifyJwt(token, { algorithm: "HS512", key: SECRET, now }, neverCalled);
    expect(result.signature).toBe("refused");
    expect(result.refusal).toMatch(/Divergence d'algorithme/);
    expect(result.headerAlgorithm).toBe("HS256");
    expect(result.expectedAlgorithm).toBe("HS512");
  });

  it("refuse un algorithme que FourTout ne sait pas vérifier", async () => {
    const header = encodeJson({ alg: "PS256", typ: "JWT" });
    const token = `${header}.${encodeJson({ sub: "a" })}.x`;
    const result = await verifyJwt(token, { algorithm: "HS256", key: SECRET, now }, neverCalled);
    expect(result.signature).toBe("refused");
    expect(result.refusal).toMatch(/PS256/);
  });

  it("refuse une vérification sans clé", async () => {
    const token = await makeToken({ sub: "alice" }, SECRET);
    const result = await verifyJwt(token, { algorithm: "HS256", key: "", now }, neverCalled);
    expect(result.signature).toBe("refused");
    expect(result.refusal).toMatch(/Aucun secret/);
  });

  it("évalue quand même les claims d'un token refusé", async () => {
    const header = encodeJson({ alg: "none" });
    const token = `${header}.${encodeJson({ exp: seconds - 10 })}.x`;
    const result = await verifyJwt(token, { algorithm: "HS256", key: SECRET, now }, neverCalled);
    expect(result.claims.expired).toBe(true);
  });

  it("lève sur un token illisible, au lieu de le déclarer invalide", async () => {
    await expect(
      verifyJwt("pas-un-jwt", { algorithm: "HS256", key: SECRET, now }, neverCalled),
    ).rejects.toThrow(JwtError);
  });
});

describe("JWT — contrat d'algorithmes", () => {
  it("n'annonce que des algorithmes réellement vérifiés", () => {
    expect(SUPPORTED_JWT_ALGORITHMS).toEqual([
      "HS256",
      "HS384",
      "HS512",
      "RS256",
      "RS384",
      "RS512",
    ]);
    expect(SUPPORTED_JWT_ALGORITHMS).not.toContain("none");
    expect(SUPPORTED_JWT_ALGORITHMS).not.toContain("ES256");
  });

  it("sait quelle sorte de clé chaque algorithme demande", () => {
    expect(keyKindFor("HS256")).toBe("secret");
    expect(keyKindFor("RS256")).toBe("public-key");
  });
});
