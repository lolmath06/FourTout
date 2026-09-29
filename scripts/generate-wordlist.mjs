#!/usr/bin/env node
/**
 * Construit le corpus de graines de la récupération de mot de passe PDF.
 *
 * Le corpus est volontairement bâti à partir de sources **légalement propres** :
 *  - une liste de mots de passe très courants que je rédige (savoir public) ;
 *  - des prénoms et motifs courants (savoir public) ;
 *  - le dictionnaire anglais de Fedora `/usr/share/dict/linux.words`, dont la
 *    licence est « Public Domain » (vérifié : rpm LicenseRef-Fedora-Public-Domain).
 *
 * Aucune liste issue de fuites n'est téléchargée ni intégrée. Les graines sont
 * dédupliquées et triées par probabilité décroissante, puis compressées en gzip.
 * Les millions de candidats sont produits à l'exécution par le moteur de règles
 * (voir src-tauri/src/recovery/rules.rs), pas stockés ici.
 *
 * Sortie : src-tauri/resources/wordlists/seeds.txt.gz (+ seeds.meta).
 * Régénérable par `pnpm wordlist`.
 */
import { createReadStream, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { gzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "src-tauri", "resources", "wordlists");
const SYSTEM_DICT = "/usr/share/dict/linux.words";

/**
 * Mots de passe extrêmement courants (savoir public, ordre de fréquence).
 * Liste volontairement compacte : le gros du volume vient du dictionnaire et
 * des règles. Ceux-ci ouvrent tout de même une large part des documents réels.
 */
const COMMON_PASSWORDS = [
  "123456", "password", "123456789", "12345678", "12345", "1234567", "qwerty",
  "azerty", "111111", "1234567890", "123123", "000000", "iloveyou", "1234",
  "1q2w3e4r", "qwertyuiop", "monkey", "dragon", "123321", "654321", "666666",
  "1qaz2wsx", "myspace1", "121212", "homelander", "123qwe", "letmein", "football",
  "shadow", "master", "michael", "superman", "696969", "123abc", "batman",
  "trustno1", "baseball", "abc123", "welcome", "admin", "root", "toor", "pass",
  "test", "guest", "info", "adm", "administrator", "login", "changeme",
  "secret", "sunshine", "princess", "flower", "hottie", "loveme", "zaq12wsx",
  "password1", "password123", "passw0rd", "p@ssw0rd", "azerty123", "soleil",
  "motdepasse", "bonjour", "coucou", "chouchou", "doudou", "camille", "nicolas",
  "marseille", "loulou", "chocolat", "jetaime", "amour", "liverpool", "chelsea",
  "arsenal", "starwars", "pokemon", "computer", "internet", "samsung", "google",
  "whatever", "hello", "hello123", "freedom", "ninja", "cheese", "summer",
  "winter", "orange", "banana", "apple", "purple", "yellow", "cookie", "pepper",
  "ginger", "buster", "hunter", "george", "thomas", "jordan", "harley",
  "ranger", "daniel", "hannah", "maggie", "jessica", "charlie", "michelle",
  "jennifer", "amanda", "ashley", "bailey", "tigger", "joshua", "andrew",
  "matrix", "mustang", "access", "flower123", "qazwsx", "zxcvbnm", "asdfgh",
  "asdfghjkl", "qwerty123", "1q2w3e", "q1w2e3r4", "1111", "2222", "0000",
  "abcd1234", "a1b2c3d4", "112233", "123654", "159753", "147258369", "987654321",
  "azertyuiop", "motdepasse1", "soleil123", "vacances", "printemps", "famille",
  "maison", "voiture", "football1", "france", "paris", "lyon", "toulouse",
];

/** Prénoms courants (français et anglais mêlés, savoir public). */
const NAMES = [
  "marie", "jean", "pierre", "michel", "andre", "philippe", "louis", "nicolas",
  "julien", "david", "alexandre", "thomas", "maxime", "antoine", "kevin",
  "sophie", "julie", "celine", "nathalie", "isabelle", "sandrine", "stephanie",
  "laura", "emma", "chloe", "manon", "camille", "sarah", "lea", "clara",
  "james", "john", "robert", "william", "richard", "joseph", "charles", "daniel",
  "matthew", "anthony", "mark", "steven", "andrew", "joshua", "kevin", "brian",
  "mary", "patricia", "jennifer", "linda", "elizabeth", "barbara", "susan",
  "jessica", "sarah", "karen", "nancy", "lisa", "emily", "olivia", "sophia",
  "ava", "mia", "lucas", "hugo", "gabriel", "arthur", "jules", "adam", "raphael",
  "liam", "noah", "ethan", "mason", "logan", "jacob", "aiden", "oliver", "elijah",
];

/** Motifs clavier et suites numériques fréquents (savoir public). */
function buildPatterns() {
  const out = [];
  // Marches clavier.
  out.push("qwerty", "azerty", "qwertz", "asdf", "asdfgh", "zxcvbn", "wsxedc",
           "qsdfgh", "wxcvbn", "poiuyt", "lkjhgf", "mnbvcx");
  // Répétitions de chiffres.
  for (let d = 0; d <= 9; d += 1) {
    out.push(String(d).repeat(4), String(d).repeat(6), String(d).repeat(8));
  }
  // PIN et suites très courants.
  out.push("1234", "0000", "1111", "2580", "1212", "1004", "2000", "4444",
           "2222", "6969", "1122", "1313", "8888", "4321", "6666", "1010");
  // Années plausibles comme mot de passe complet.
  for (let y = 2026; y >= 1950; y -= 1) out.push(String(y));
  // Dates courtes jj/mm compressées.
  out.push("0101", "3112", "1502", "2412", "1407", "1105");
  return out;
}

/** Charge et filtre le dictionnaire système s'il est présent. */
async function loadDictionary() {
  if (!existsSync(SYSTEM_DICT)) {
    console.warn(
      `Dictionnaire ${SYSTEM_DICT} absent : corpus réduit aux graines rédigées.\n` +
        "Sur Fedora : sudo dnf install words",
    );
    return [];
  }
  const words = [];
  const rl = createInterface({ input: createReadStream(SYSTEM_DICT), crlfDelay: Infinity });
  for await (const line of rl) {
    const word = line.trim().toLowerCase();
    // Mots alphabétiques ASCII de 4 à 12 lettres : le cœur des mots de passe.
    if (/^[a-z]{4,12}$/.test(word)) words.push(word);
  }
  // Tri par longueur croissante (les mots courts sont des mots de passe plus
  // probables), puis alphabétique, pour un ordre déterministe et utile.
  words.sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));
  return words;
}

async function main() {
  const dictionary = await loadDictionary();

  // Ordre de priorité : mots de passe courants, prénoms, motifs, dictionnaire.
  const ordered = [
    ...COMMON_PASSWORDS,
    ...NAMES,
    ...buildPatterns(),
    ...dictionary,
  ];

  // Déduplication exacte en préservant l'ordre (première occurrence gardée).
  const seen = new Set();
  const seeds = [];
  for (const raw of ordered) {
    const seed = raw.trim();
    if (seed.length === 0 || seed.length > 40) continue;
    if (seen.has(seed)) continue;
    seen.add(seed);
    seeds.push(seed);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const text = seeds.join("\n") + "\n";
  const rawBytes = Buffer.byteLength(text);
  const gz = gzipSync(Buffer.from(text), { level: 9 });

  writeFileSync(join(OUT_DIR, "seeds.txt.gz"), gz);
  writeFileSync(join(OUT_DIR, "seeds.meta"), `${seeds.length}\n`);

  // Budgets de règles, gardés synchronisés avec rules.rs pour l'estimation.
  const budgets = { quick: 2, extended: 4, full: 40 };
  const quickSeeds = Math.min(30_000, seeds.length);
  const est = {
    quick: quickSeeds * budgets.quick,
    extended: seeds.length * budgets.extended,
    full: seeds.length * budgets.full,
  };

  const fmt = (n) => n.toLocaleString("fr-FR");
  console.log("Corpus de récupération généré :");
  console.log(`  graines            : ${fmt(seeds.length)}`);
  console.log(`    · mots de passe  : ${fmt(COMMON_PASSWORDS.length)}`);
  console.log(`    · prénoms        : ${fmt(NAMES.length)}`);
  console.log(`    · dictionnaire   : ${fmt(dictionary.length)} (public domain)`);
  console.log(`  texte brut         : ${fmt(rawBytes)} octets`);
  console.log(`  gzip (installé)    : ${fmt(gz.length)} octets`);
  console.log("  candidats prévus (graines × budget de règles) :");
  console.log(`    · Rapide         : ~${fmt(est.quick)}`);
  console.log(`    · Étendu         : ~${fmt(est.extended)}`);
  console.log(`    · Complet        : ~${fmt(est.full)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
