import { describe, expect, it } from "vitest";
import { isRecoveryAvailable, startRecovery } from "./client";

describe("client de récupération", () => {
  it("est indisponible hors application (pas de moteur natif)", () => {
    // En environnement de test (jsdom), Tauri n'est pas présent.
    expect(isRecoveryAvailable()).toBe(false);
  });

  it("refuse de démarrer sans moteur natif, avec un message clair", async () => {
    await expect(
      startRecovery(
        { revision: 4, keyLength: 16, o: "00", u: "00", p: 0, id0: "00", encryptMetadata: true },
        "quick",
        { onProgress: () => {}, onDone: () => {} },
      ),
    ).rejects.toThrow(/application FourTout/i);
  });
});
