#!/usr/bin/env node
/**
 * Fixtures de la récupération de mot de passe PDF.
 *
 * Les mots de passe sont **dérivés du corpus réel** afin d'être réellement
 * atteignables par le moteur, et placés **suffisamment loin** pour prouver que
 * la recherche progresse sur plusieurs lots (et n'est pas codée en dur) :
 *
 *  - `pdf-recover-quick.pdf` : chiffrement AES-128 (rapide à tester) ; mot de
 *    passe = une graine située vers le 800ᵉ rang, donc hors des 100 premiers
 *    candidats mais trouvé en quelques secondes au niveau Rapide.
 *  - `pdf-recover-deep.pdf` : chiffrement AES-256 (lent à tester, par
 *    conception) ; mot de passe = une graine profonde + « 2024 », atteignable
 *    uniquement au niveau Complet, après quelques centaines de milliers de
 *    candidats — de quoi observer l'avancement, les lots et l'annulation.
 *
 * Écrit aussi `recovery-fixture.json` (paramètres + mot de passe) pour le test
 * d'intégration Rust, qui rejoue la recherche sur le vrai corpus.
 */
import { createReadStream, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFArray, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFString, StandardFonts, rgb }
  from "@cantoo/pdf-lib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "test-assets", "generated");
const CORPUS = join(ROOT, "src-tauri", "resources", "wordlists", "seeds.txt.gz");

async function readSeeds(limit) {
  if (!existsSync(CORPUS)) {
    throw new Error(`Corpus introuvable (${CORPUS}). Lancez d'abord : pnpm wordlist`);
  }
  const seeds = [];
  const rl = createInterface({
    input: createReadStream(CORPUS).pipe(createGunzip()),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    const seed = line.trim();
    if (seed) seeds.push(seed);
    if (seeds.length >= limit) break;
  }
  return seeds;
}

async function buildLockedPdf(password, label, algorithm) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([420, 300]);
  page.drawRectangle({ x: 0, y: 0, width: 420, height: 300, color: rgb(0.95, 0.92, 0.85) });
  page.drawText("DOCUMENT PROTEGE", { x: 40, y: 200, size: 22, font, color: rgb(0.3, 0.25, 0.1) });
  page.drawText(label, { x: 40, y: 160, size: 12, font, color: rgb(0.4, 0.4, 0.4) });
  const plain = await doc.save();

  const enc = await PDFDocument.load(plain);
  const opts = { userPassword: password, ownerPassword: `owner-${password}` };
  if (algorithm) opts.algorithm = algorithm;
  enc.encrypt(opts);
  return enc.save({ useObjectStreams: false });
}

function bytesOf(obj) {
  if (obj instanceof PDFHexString || obj instanceof PDFString) return obj.asBytes();
  return null;
}
function hex(u8) {
  return Buffer.from(u8).toString("hex");
}

async function extractParams(bytes) {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const ctx = doc.context;
  const enc = ctx.lookup(ctx.trailerInfo.Encrypt);
  const g = (k) => enc.get(PDFName.of(k));
  const num = (k) => {
    const v = g(k);
    return v instanceof PDFNumber ? v.asNumber() : undefined;
  };
  const revision = num("R");
  const length = num("Length") ?? 40;
  let id0 = new Uint8Array(0);
  const idArr = ctx.trailerInfo.ID;
  if (idArr instanceof PDFArray) {
    const first = bytesOf(idArr.asArray()[0]);
    if (first) id0 = first;
  }
  return {
    revision,
    keyLength: revision >= 5 ? 32 : Math.max(5, Math.floor(length / 8)),
    o: hex(bytesOf(g("O"))),
    u: hex(bytesOf(g("U"))),
    p: (num("P") ?? 0) | 0,
    id0: hex(id0),
    encryptMetadata: g("EncryptMetadata") === undefined ? true : String(g("EncryptMetadata")) !== "false",
  };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const seeds = await readSeeds(9000);

  // Graines choisies à des rangs connus, profonds mais déterministes.
  const quickSeed = seeds[800];
  const deepSeed = seeds[8000];
  const quickPassword = quickSeed; // graine brute, ~1600ᵉ candidat au niveau Rapide
  const deepPassword = `${deepSeed}2024`; // règle « +2024 », niveau Complet requis

  const quickBytes = await buildLockedPdf(quickPassword, "AES-128 - niveau Rapide", "AES-128");
  const deepBytes = await buildLockedPdf(deepPassword, "AES-256 - niveau Complet", undefined);

  writeFileSync(join(OUT, "pdf-recover-quick.pdf"), quickBytes);
  writeFileSync(join(OUT, "pdf-recover-deep.pdf"), deepBytes);

  const fixture = {
    quick: { file: "pdf-recover-quick.pdf", password: quickPassword, tier: "quick", seedRank: 800, params: await extractParams(quickBytes) },
    deep: { file: "pdf-recover-deep.pdf", password: deepPassword, tier: "full", seedRank: 8000, params: await extractParams(deepBytes) },
  };
  writeFileSync(join(OUT, "recovery-fixture.json"), JSON.stringify(fixture, null, 2));

  console.log("Fixtures de récupération générées :");
  console.log(`  pdf-recover-quick.pdf  AES-128  mot de passe « ${quickPassword} » (graine n°800)`);
  console.log(`  pdf-recover-deep.pdf   AES-256  mot de passe « ${deepPassword} » (graine n°8000 + 2024)`);
  console.log("  recovery-fixture.json  (paramètres pour le test d'intégration Rust)");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
