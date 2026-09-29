// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeText, detectEncoding } from "@/core/text/encoding";
import {
  detectFormat,
  mergeCues,
  normalizeCues,
  parseSrt,
  parseSubtitles,
  parseTimestamp,
  parseVtt,
  reportCues,
  serializeSrt,
  serializeVtt,
  shiftCues,
  subtitleOutputName,
  conversionWarnings,
  type SubtitleCue,
} from "./index";

const DIR = join(process.cwd(), "test-assets", "generated");
const read = (name: string) => readFileSync(join(DIR, name), "utf8");
const CONTRACT = JSON.parse(readFileSync(join(DIR, "CONTRAT.json"), "utf8")) as {
  sousTitres: Record<
    string,
    { repliques?: number; blocs?: number; decalageMs?: number; chevauchements?: number; encodage?: string }
  >;
};

describe("lecture des sous-titres", () => {
  it("lit un SRT complet : indices, horodatages, texte multiligne, Unicode", () => {
    const document = parseSrt(read("subtitle-sample.srt"));
    expect(document.format).toBe("srt");
    expect(document.cues).toHaveLength(CONTRACT.sousTitres["subtitle-sample.srt"].repliques!);
    expect(document.warnings).toHaveLength(0);

    expect(document.cues[0].startMs).toBe(1000);
    expect(document.cues[0].endMs).toBe(3500);
    expect(document.cues[0].text).toBe("Première réplique, accentuée.");
    expect(document.cues[1].text.split("\n")).toHaveLength(2);
    expect(document.cues[2].text).toContain("日本語");
    expect(document.cues[2].text).toContain("🎬");
  });

  it("lit un WebVTT avec en-tête, identifiant et réglages de placement", () => {
    const document = parseVtt(read("subtitle-sample.vtt"));
    expect(document.format).toBe("vtt");
    expect(document.cues).toHaveLength(CONTRACT.sousTitres["subtitle-sample.vtt"].repliques!);
    expect(document.warnings).toHaveLength(0);
    expect(document.cues[0].identifier).toBe("intro");
    expect(document.cues[0].settings).toBe("line:90%");
    expect(document.cues[0].startMs).toBe(1000);
  });

  it("reconnaît le format d'après le contenu avant l'extension", () => {
    expect(detectFormat(read("subtitle-sample.vtt"))).toBe("vtt");
    expect(detectFormat(read("subtitle-sample.srt"))).toBe("srt");
    // Un fichier WebVTT mal nommé reste un WebVTT.
    expect(detectFormat(read("subtitle-sample.vtt"), "srt")).toBe("vtt");
  });

  it("accepte les horodatages tolérables et refuse les absurdes", () => {
    expect(parseTimestamp("00:00:01,500")).toBe(1500);
    expect(parseTimestamp("00:00:01.500")).toBe(1500);
    expect(parseTimestamp("01:02.250")).toBe(62_250);
    expect(parseTimestamp(" 00:00:01,5 ")).toBe(1500);

    // 90 minutes ou 75 secondes ne sont pas des horodatages valides.
    expect(parseTimestamp("00:90:00,000")).toBeUndefined();
    expect(parseTimestamp("00:00:75,000")).toBeUndefined();
    expect(parseTimestamp("n'importe quoi")).toBeUndefined();
    expect(parseTimestamp("999:00:00,000")).toBeUndefined();
  });

  it("lit un fichier venu de Windows sans transformer les accents en losanges", () => {
    // UTF-16 avec marque d'ordre des octets et CRLF : décodé en UTF-8 d'office,
    // ce fichier ne lèverait aucune erreur, il rendrait du charabia. La
    // détection d'encodage de la phase 8 fait le travail en amont du lecteur.
    const bytes = new Uint8Array(readFileSync(join(DIR, "subtitle-windows.srt")));
    const detection = detectEncoding(bytes);
    const expected = CONTRACT.sousTitres["subtitle-windows.srt"];
    expect(detection.encoding).toBe(expected.encodage);
    expect(detection.certain).toBe(true);

    const document = parseSrt(decodeText(bytes, detection.encoding));
    expect(document.cues).toHaveLength(expected.repliques!);
    expect(document.warnings).toHaveLength(0);
    expect(document.cues[0].text).toBe("Réplique accentuée à l'ancienne.");
    expect(document.cues[1].text).toBe("Où ça ? Là-bas, près du mûrier.");

    // La réécriture est toujours en fins de ligne LF, quel que soit le fichier
    // d'entrée : c'est ce que lisent VLC comme les lecteurs web, et c'est la
    // seule façon d'obtenir le même résultat sous Fedora et sous Windows.
    const srt = serializeSrt(document.cues);
    expect(srt).not.toContain("\r");
    expect(srt).toContain("Réplique accentuée");
  });

  it("signale les défauts d'un fichier abîmé plutôt que de les masquer", () => {
    const document = parseSrt(read("subtitle-broken.srt"));
    // La marque d'ordre des octets et les CRLF ne doivent pas gêner la lecture.
    expect(document.cues).toHaveLength(CONTRACT.sousTitres["subtitle-broken.srt"].blocs!);
    expect(document.cues[0].text).toBe("Dernière réplique.");

    const kinds = document.warnings.map((warning) => warning.kind);
    expect(kinds).toContain("end-before-start");
    expect(kinds).toContain("empty-text");
  });
});

describe("écriture et conversion", () => {
  it("convertit SRT → VTT sans toucher au texte ni aux temps", () => {
    const source = parseSrt(read("subtitle-sample.srt"));
    const vtt = serializeVtt(source.cues);
    expect(vtt.startsWith("WEBVTT\n")).toBe(true);

    const back = parseVtt(vtt);
    expect(back.cues).toHaveLength(source.cues.length);
    back.cues.forEach((cue, index) => {
      expect(cue.startMs).toBe(source.cues[index].startMs);
      expect(cue.endMs).toBe(source.cues[index].endMs);
      expect(cue.text).toBe(source.cues[index].text);
    });
  });

  it("convertit VTT → SRT et renumérote proprement", () => {
    const source = parseVtt(read("subtitle-sample.vtt"));
    const srt = serializeSrt(source.cues);
    expect(srt.startsWith("1\n00:00:01,000 --> 00:00:03,500\n")).toBe(true);

    const back = parseSrt(srt);
    expect(back.warnings).toHaveLength(0);
    expect(back.cues.map((cue) => cue.text)).toEqual(source.cues.map((cue) => cue.text));
    expect(back.cues.map((cue) => cue.startMs)).toEqual(source.cues.map((cue) => cue.startMs));
  });

  it("prévient quand SRT ne peut pas porter un réglage WebVTT", () => {
    const source = parseVtt(read("subtitle-sample.vtt"));
    const warnings = conversionWarnings(source.cues, "srt");
    expect(warnings).toHaveLength(1);
    expect(warnings[0].kind).toBe("dropped-settings");
    // Vers le WebVTT, rien n'est perdu : aucun avertissement.
    expect(conversionWarnings(source.cues, "vtt")).toHaveLength(0);
  });

  it("survit à un aller-retour complet dans les deux sens", () => {
    const original = parseSrt(read("subtitle-sample.srt")).cues;
    const roundTrip = parseSrt(serializeSrt(parseVtt(serializeVtt(original)).cues)).cues;
    // Les horodatages et les textes doivent revenir au bit près. L'identifiant,
    // lui, est l'index SRT : il est régénéré à chaque écriture, pas transporté.
    expect(roundTrip.map(({ startMs, endMs, text }) => ({ startMs, endMs, text }))).toEqual(
      original.map(({ startMs, endMs, text }) => ({ startMs, endMs, text })),
    );
  });

  it("nomme les sorties d'après la source", () => {
    expect(subtitleOutputName("film.srt", "vtt")).toBe("film.vtt");
    expect(subtitleOutputName("film.vtt", "srt", "decale")).toBe("film-decale.srt");
  });
});

describe("décalage", () => {
  const sample = () => parseSrt(read("subtitle-sample.srt")).cues;

  it("décale toutes les répliques en avant", () => {
    const offset = CONTRACT.sousTitres["subtitle-offset.srt"].decalageMs!;
    const shifted = shiftCues(sample(), offset);
    const expected = parseSrt(read("subtitle-offset.srt")).cues;

    expect(shifted.clamped).toBe(0);
    expect(shifted.dropped).toBe(0);
    shifted.cues.forEach((cue, index) => {
      expect(cue.startMs).toBe(expected[index].startMs);
      expect(cue.endMs).toBe(expected[index].endMs);
      expect(cue.text).toBe(expected[index].text);
    });
  });

  it("décale en arrière et ramène à zéro sans écraser la durée", () => {
    const cues = sample();
    const shifted = shiftCues(cues, -1000);
    expect(shifted.cues[0].startMs).toBe(0);
    expect(shifted.cues[0].endMs).toBe(2500);
    expect(shifted.clamped).toBe(0);

    // Décalage plus grand que le début de la première réplique : elle est
    // ramenée à zéro, mais garde sa durée d'origine.
    const heavy = shiftCues(cues, -2000);
    expect(heavy.clamped).toBe(1);
    expect(heavy.cues[0].startMs).toBe(0);
    expect(heavy.cues[0].endMs).toBe(cues[0].endMs - cues[0].startMs);
  });

  it("écarte une réplique qui tomberait entièrement avant zéro", () => {
    const shifted = shiftCues(sample(), -60_000);
    expect(shifted.cues).toHaveLength(0);
    expect(shifted.dropped).toBe(3);
  });

  it("ne modifie pas les répliques d'origine", () => {
    const cues = sample();
    shiftCues(cues, 5000);
    expect(cues[0].startMs).toBe(1000);
  });
});

describe("fusion", () => {
  it("réunit deux fichiers sur une seule ligne de temps, triée", () => {
    const a = parseSrt(read("subtitle-sample.srt")).cues;
    const b = parseSrt(read("subtitle-second.srt")).cues;
    const merged = mergeCues(a, b);

    expect(merged).toHaveLength(a.length + b.length);
    // Chronologie croissante d'un bout à l'autre.
    for (let index = 1; index < merged.length; index += 1) {
      expect(merged[index].startMs).toBeGreaterThanOrEqual(merged[index - 1].startMs);
    }
    // Aucun texte n'a disparu ni n'a été recollé à un autre.
    expect(merged.map((cue) => cue.text).sort()).toEqual([...a, ...b].map((cue) => cue.text).sort());
  });

  it("conserve l'ordre des fichiers quand on ne trie pas", () => {
    const a = parseSrt(read("subtitle-sample.srt")).cues;
    const b = parseSrt(read("subtitle-second.srt")).cues;
    const merged = mergeCues(a, b, "sequential");
    expect(merged.slice(0, a.length).map((c) => c.text)).toEqual(a.map((c) => c.text));
  });

  it("garde les deux répliques quand elles se chevauchent", () => {
    const overlapping = parseSrt(read("subtitle-overlap.srt")).cues;
    const merged = mergeCues(overlapping, overlapping);
    expect(merged).toHaveLength(overlapping.length * 2);
  });
});

describe("normalisation et rapport", () => {
  it("décrit un fichier sain sans rien signaler", () => {
    const report = reportCues(parseSrt(read("subtitle-sample.srt")).cues);
    expect(report.cues).toBe(3);
    expect(report.firstStartMs).toBe(1000);
    expect(report.lastEndMs).toBe(12_000);
    expect(report.overlaps).toBe(0);
    expect(report.empty).toBe(0);
    expect(report.duplicates).toBe(0);
    expect(report.endBeforeStart).toBe(0);
  });

  it("compte les chevauchements sans y toucher", () => {
    const cues = parseSrt(read("subtitle-overlap.srt")).cues;
    const expected = CONTRACT.sousTitres["subtitle-overlap.srt"].chevauchements!;
    expect(reportCues(cues).overlaps).toBe(expected);

    const result = normalizeCues(cues);
    expect(result.cues).toHaveLength(cues.length);
    expect(result.after.overlaps).toBe(expected);
    expect(result.remaining.map((issue) => issue.kind)).toContain("overlap");
  });

  it("remet d'aplomb un fichier abîmé et dit ce qu'il reste", () => {
    const document = parseSrt(read("subtitle-broken.srt"));
    const result = normalizeCues(document.cues);

    expect(result.before.cues).toBe(5);
    expect(result.before.outOfOrder).toBeGreaterThan(0);
    expect(result.before.empty).toBe(1);
    expect(result.before.duplicates).toBe(1);

    // Vide et doublon retirés, ordre rétabli.
    expect(result.after.cues).toBe(3);
    expect(result.after.empty).toBe(0);
    expect(result.after.duplicates).toBe(0);
    expect(result.after.outOfOrder).toBe(0);
    expect(result.removed).toBe(2);

    // La réplique dont la fin précède le début est conservée mais signalée :
    // choisir un horodatage à la place de l'auteur serait une invention.
    expect(result.after.endBeforeStart).toBe(1);
    expect(result.remaining.map((issue) => issue.kind)).toContain("end-before-start");

    // Renumérotation à l'écriture : 1, 2, 3 dans l'ordre chronologique.
    const srt = serializeSrt(result.cues);
    expect(srt.split("\n")[0]).toBe("1");
    expect(parseSrt(srt).cues[0].text).toBe("Première réplique.");
  });

  it("peut retirer les répliques inaffichables si on le demande", () => {
    const document = parseSrt(read("subtitle-broken.srt"));
    const result = normalizeCues(document.cues, { removeInvalid: true });
    expect(result.after.endBeforeStart).toBe(0);
    expect(result.remaining.map((issue) => issue.kind)).not.toContain("end-before-start");
  });

  it("sert de simple validateur, sans rien modifier", () => {
    const cues: SubtitleCue[] = [{ startMs: 1000, endMs: 2000, text: "a" }];
    const before = JSON.stringify(cues);
    reportCues(cues);
    expect(JSON.stringify(cues)).toBe(before);
  });

  it("lit indifféremment SRT ou VTT via le point d'entrée commun", () => {
    expect(parseSubtitles(read("subtitle-sample.vtt"), "vtt").cues).toHaveLength(3);
    expect(parseSubtitles(read("subtitle-sample.srt"), "srt").cues).toHaveLength(3);
  });
});
