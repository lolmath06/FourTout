import { describe, expect, it } from "vitest";
import { JobCancelledError } from "@/core/jobs/types";
import { MEDIA_CANCELLED, describeMediaError, friendlyMediaError } from "./errors";

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
