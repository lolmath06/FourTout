import { describe, expect, it } from "vitest";
import { parseProbe, readProbeJson } from "./types";
import { inspectMedia } from "./inspect";

/**
 * Ce que FFprobe rend n'est pas toujours du JSON.
 *
 * Un fichier illisible, un processus interrompu, une compilation qui écrit un
 * avertissement avant sa sortie : dans ces cas, l'analyse recevait autrefois le
 * message brut du moteur JavaScript — en anglais, et sans rapport avec ce que
 * l'utilisateur venait de faire.
 */
describe("lecture de la sortie FFprobe", () => {
  it("explique une sortie vide au lieu de laisser filer l'erreur du moteur", () => {
    for (const empty of ["", "   ", "\n"]) {
      expect(() => readProbeJson(empty)).toThrow(/FFprobe n'a rien renvoyé/);
      expect(() => parseProbe(empty)).toThrow(/FFprobe n'a rien renvoyé/);
      expect(() => inspectMedia(empty)).toThrow(/FFprobe n'a rien renvoyé/);
    }
  });

  it("explique une sortie illisible sans montrer le message du moteur", () => {
    const noise = "ffmpeg version 6.1\n{ ceci n'est pas du JSON";
    for (const read of [readProbeJson, parseProbe, inspectMedia]) {
      let message = "";
      try {
        read(noise);
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).toMatch(/n'a pas pu être lue/);
      // Aucun vocabulaire de moteur JavaScript ne doit atteindre l'écran.
      expect(message).not.toMatch(/Unexpected token|JSON at position|SyntaxError/);
    }
  });

  it("lit une sortie valide sans rien changer à son interprétation", () => {
    const probe = JSON.stringify({
      format: { duration: "12.5", format_name: "mov,mp4", bit_rate: "800000" },
      streams: [{ codec_type: "video", codec_name: "h264", width: 640, height: 480 }],
    });
    const info = parseProbe(probe);
    expect(info.durationMs).toBe(12500);
    expect(info.formatName).toBe("mov,mp4");
    expect(info.hasVideo).toBe(true);
    expect(info.videoCodec).toBe("h264");
  });
});
