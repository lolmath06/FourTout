#!/usr/bin/env node
/**
 * Fixtures de la phase 11 : TOML et jetons JWT.
 *
 * La base `sample.sqlite` est écrite à part, par
 * `cargo run --example phase11_fixtures`, parce que Node ne sait pas produire
 * un fichier SQLite sans dépendance expérimentale.
 *
 * Les jetons HS256 sont **entièrement déterministes** : secret fixe, dates
 * fixes, donc même chaîne à chaque exécution. Les jetons RS256 dépendent d'une
 * paire de clés engendrée à chaque génération : la clé publique est écrite à
 * côté des jetons, si bien que l'ensemble reste cohérent, et `CONTRAT.json`
 * enregistre ce qui a réellement été produit.
 *
 * Aucune de ces clés n'a jamais servi ailleurs : elles existent pour ce dossier
 * de test et pour rien d'autre.
 *
 * Usage : `node scripts/generate-phase11-assets.mjs`
 */
import { createHmac, generateKeyPairSync, createSign } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "test-assets", "generated");
mkdirSync(OUT, { recursive: true });

const write = (name, content) => {
  writeFileSync(join(OUT, name), content, "utf8");
  return name;
};

/* ------------------------------------------------------------------ TOML */

/** Document valide, couvrant tout ce que le formateur doit préserver. */
const VALID_TOML = `titre = "FourTout — inventaire"
version = 3
actif = true
ratio = 0.75
publie = 1979-05-27T07:32:00Z
jour = 2026-03-29
heure = 07:32:00
tags = ["local", "hors-ligne", "gratuit"]

description = """
Un outil de bureau,
décrit sur deux lignes.
"""

chemin = 'C:\\Users\\alice\\fourtout'

[serveur]
hote = "127.0.0.1"
port = 8080
tolere = [1, 2, 3]

[serveur.limites]
requetes = 100
duree = "30s"

[[journal]]
niveau = "info"
fichier = "info.log"

[[journal]]
niveau = "erreur"
fichier = "erreur.log"
`;

/** Document invalide : la clé « port » est définie deux fois. */
const INVALID_TOML = `[serveur]
hote = "127.0.0.1"
port = 8080
port = 9090
`;

/** Document abondamment commenté : c'est ce que le reformatage perdra. */
const COMMENTS_TOML = `# Configuration de FourTout
# Ce fichier est commenté exprès : le reformatage doit dire qu'il les perd.

# Nom affiché dans l'interface
titre = "FourTout"

# Réglages du serveur local
[serveur]
hote = "127.0.0.1" # commentaire de fin de ligne
port = 8080

# Un dièse dans une chaîne n'est pas un commentaire :
motif = "# ceci reste du texte"

texte = """
# celui-ci non plus
"""
`;

const files = [
  write("sample-valid.toml", VALID_TOML),
  write("sample-invalid.toml", INVALID_TOML),
  write("sample-comments.toml", COMMENTS_TOML),
];

/* ------------------------------------------------------------------- JWT */

const base64Url = (buffer) =>
  Buffer.from(buffer).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const encodeJson = (value) => base64Url(Buffer.from(JSON.stringify(value), "utf8"));

/** Secret de test, et rien d'autre. */
const HS_SECRET = "fourtout-phase11-secret-de-test";
const HS_WRONG_SECRET = "ce-n-est-pas-le-bon-secret";

/** Dates figées : les jetons ne changent pas d'une exécution à l'autre. */
const ISSUED_AT = 1_767_225_600; // 2026-01-01T00:00:00Z
const EXPIRES_LATER = 4_102_444_800; // 2100-01-01T00:00:00Z
const EXPIRED_AT = 1_735_689_600; // 2025-01-01T00:00:00Z

function signHs(algorithm, payload, secret) {
  const header = encodeJson({ alg: algorithm, typ: "JWT" });
  const body = encodeJson(payload);
  const hash = `sha${algorithm.slice(2)}`;
  const signature = base64Url(
    createHmac(hash, secret).update(`${header}.${body}`).digest(),
  );
  return `${header}.${body}.${signature}`;
}

function signRs(algorithm, payload, privateKey) {
  const header = encodeJson({ alg: algorithm, typ: "JWT" });
  const body = encodeJson(payload);
  const signer = createSign(`RSA-SHA${algorithm.slice(2)}`);
  signer.update(`${header}.${body}`);
  return `${header}.${body}.${base64Url(signer.sign(privateKey))}`;
}

const validPayload = { sub: "alice", name: "Alice", iat: ISSUED_AT, exp: EXPIRES_LATER };
const expiredPayload = { sub: "alice", name: "Alice", iat: ISSUED_AT, exp: EXPIRED_AT };

const jwt = {
  secret: HS_SECRET,
  wrongSecret: HS_WRONG_SECRET,
  issuedAt: ISSUED_AT,
  expiresAt: EXPIRES_LATER,
  expiredAt: EXPIRED_AT,
  hs256Valid: signHs("HS256", validPayload, HS_SECRET),
  hs256WrongKey: signHs("HS256", validPayload, HS_WRONG_SECRET),
  hs256Expired: signHs("HS256", expiredPayload, HS_SECRET),
  hs384Valid: signHs("HS384", validPayload, HS_SECRET),
  hs512Valid: signHs("HS512", validPayload, HS_SECRET),
  none: `${encodeJson({ alg: "none", typ: "JWT" })}.${encodeJson(validPayload)}.`,
};

// Deux paires RSA : l'une signe, l'autre sert de mauvaise clé publique.
const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const other = generateKeyPairSync("rsa", { modulusLength: 2048 });

const publicPem = rsa.publicKey.export({ type: "spki", format: "pem" }).toString();
const otherPublicPem = other.publicKey.export({ type: "spki", format: "pem" }).toString();

jwt.rs256Valid = signRs("RS256", validPayload, rsa.privateKey);
jwt.rs256Expired = signRs("RS256", expiredPayload, rsa.privateKey);
jwt.rs384Valid = signRs("RS384", validPayload, rsa.privateKey);
jwt.rs512Valid = signRs("RS512", validPayload, rsa.privateKey);
jwt.rsaPublicKeyFile = "jwt-rsa-public.pem";
jwt.rsaWrongPublicKeyFile = "jwt-rsa-autre-public.pem";

files.push(write("jwt-rsa-public.pem", publicPem));
files.push(write("jwt-rsa-autre-public.pem", otherPublicPem));
files.push(write("jwt-fixtures.json", `${JSON.stringify(jwt, null, 2)}\n`));

// La clé privée n'est jamais écrite sur le disque : elle a servi à signer et
// disparaît avec le processus. Vérifier une signature ne demande que la clé
// publique, et laisser traîner une clé privée dans un dépôt — fût-elle de
// test — apprend le mauvais réflexe.

console.log(`Fixtures phase 11 écrites : ${files.join(", ")}`);
