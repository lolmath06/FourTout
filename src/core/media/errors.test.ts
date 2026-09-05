import { describe, expect, it } from "vitest";
import { JobCancelledError } from "@/core/jobs/types";
import { MEDIA_CANCELLED, describeMediaError, friendlyMediaError, isEncoderUnavailable } from "./errors";

/**
 * La sortie d'erreur de FFmpeg est écrite pour un développeur. On la reformule
 * pour les cas fréquents — sans jamais inventer : un message non reconnu est
 * conservé tel quel plutôt que remplacé par une explication approximative.
 */
describe("erreurs média", () => {
  it("reconnaît un fichier illisible", () => {
    expect(friendlyMediaError(new Error("moov atom not found\nInvalid data found when processing input"))).toMatch(
      /incomplet, endommagé/,
    );
  });

  it("reconnaît un encodeur qui existe mais ne démarre pas ici", () => {
    // Le message exact rencontré sur Fedora avec NVENC compilé mais inutilisable.
    const nvenc =
      "[h264_nvenc @ 0x55] Error while opening encoder - maybe incorrect parameters such as bit_rate, rate, width or height\n" +
      "Error while filtering: Operation not permitted\n" +
      "Conversion failed!";
    expect(isEncoderUnavailable(nvenc)).toBe(true);
    expect(friendlyMediaError(new Error(nvenc))).toMatch(/n'a pas pu démarrer sur cette machine/);
    // Le message vague d'origine ne doit plus apparaître pour ce cas.
    expect(friendlyMediaError(new Error(nvenc))).not.toMatch(/paramètres demandés/);
  });

  it("reconnaît les autres signatures d'accélération matérielle absente", () => {
    for (const raw of [
      "Cannot load libcuda.so.1",
      "No capable devices found",
      "Failed setting up VAAPI encode context",
      "OpenEncodeSessionEx failed: no encode device (12)",
    ]) {
      expect(isEncoderUnavailable(raw), raw).toBe(true);
    }
  });

  it("ne confond pas une vraie panne avec une indisponibilité d'encodeur", () => {
    // Ces erreurs ne doivent PAS déclencher de nouvelle tentative.
    for (const raw of [
      "Invalid data found when processing input",
      "No space left on device",
      "Stream map '0:s:0' matches no streams.",
      "Unknown encoder 'libx265'",
    ]) {
      expect(isEncoderUnavailable(raw), raw).toBe(false);
    }
  });

  it("reconnaît un codec absent du build", () => {
    expect(friendlyMediaError(new Error("Unknown encoder 'libx265'"))).toMatch(/pas disponible/);
  });

  it("reconnaît une piste demandée qui n'existe pas", () => {
    expect(
      friendlyMediaError(new Error("Stream map '0:s:0' matches no streams.")),
    ).toMatch(/n'existe pas/);
  });

  it("reconnaît un disque plein et un refus d'accès", () => {
    expect(friendlyMediaError(new Error("av_interleaved_write_frame(): No space left on device"))).toMatch(
      /espace disque/,
    );
    expect(friendlyMediaError(new Error("Permission denied"))).toMatch(/refusé/);
  });

  it("reconnaît une combinaison conteneur/codec impossible", () => {
    expect(
      friendlyMediaError(new Error("Could not write header for output file #0 (incorrect codec parameters ?)")),
    ).toMatch(/conteneur|paramètres/i);
  });

  it("traite l'annulation comme une annulation, pas comme une panne", () => {
    expect(describeMediaError(new JobCancelledError())).toEqual({
      message: MEDIA_CANCELLED,
      cancelled: true,
    });
    expect(describeMediaError("cancelled").cancelled).toBe(true);
  });

  it("conserve un message inconnu au lieu d'en inventer un", () => {
    const raw = "Quelque chose de très spécifique s'est mal passé (code 42)";
    const described = describeMediaError(new Error(raw));
    expect(described.message).toBe(raw);
    expect(described.cancelled).toBe(false);
  });

  it("garde le détail technique disponible à côté du message clair", () => {
    const described = describeMediaError(new Error("Unknown encoder 'libx265'"));
    expect(described.detail).toContain("libx265");
    expect(described.message).not.toContain("libx265");
  });
});
