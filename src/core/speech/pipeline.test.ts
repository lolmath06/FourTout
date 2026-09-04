import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Enchaînement réel des appels au socle natif, sans les moteurs eux-mêmes :
 * ces tests vérifient que la synthèse découpe, appelle, assemble et **nettoie**
 * ses fichiers temporaires, que l'annulation coupe vraiment, et que la
 * transcription prépare son audio avant d'appeler le moteur. La qualité vocale,
 * elle, est vérifiée contre les vrais moteurs (`src-tauri/tests/speech_integration.rs`).
 */

const invokeMock = vi.fn();
const listenMock = vi.fn();

vi.mock("@/core/platform", () => ({ isTauri: () => true, detectPlatform: () => "linux" }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));

import { JobCancelledError } from "@/core/jobs/types";
import { synthesize, synthesizePreview, TTS_VOICES, defaultVoice, formatDuration } from "./tts";
import { transcribe, parseWhisperJson, STT_MODELS } from "./stt";
import { installAsset, missingAssets, formatSize, type SpeechAsset } from "./models";

/** Pont natif simulé : chaque commande répond comme le ferait Rust. */
function bridge(overrides: Record<string, (args: unknown) => unknown> = {}) {
  const speak = vi.fn();
  invokeMock.mockImplementation((command: string, args: unknown) => {
    if (overrides[command]) return Promise.resolve(overrides[command](args));
    switch (command) {
      case "tts_speak": {
        const params = (args as { params: { text: string } }).params;
        speak(params.text);
        return Promise.resolve(`/tmp/fourtout-media/seg-${speak.mock.calls.length}.wav`);
      }
      case "tts_concat":
        return Promise.resolve({ path: "/tmp/fourtout-media/joined.wav", durationMs: 4200, bytes: 16 });
      case "media_read":
        return Promise.resolve(new Uint8Array([82, 73, 70, 70]).buffer);
      case "media_exec":
      case "media_cleanup":
      case "speech_cancel":
      case "media_cancel":
        return Promise.resolve(undefined);
      case "media_stage":
        return Promise.resolve("/tmp/fourtout-media/input.mp3");
      case "media_temp":
        return Promise.resolve("/tmp/fourtout-media/prepared.wav");
      case "stt_transcribe":
        return Promise.resolve(
          JSON.stringify({
            result: { language: "fr" },
            transcription: [
              { offsets: { from: 0, to: 2350 }, text: " Bonjour, ceci est un test." },
              { offsets: { from: 2350, to: 5280 }, text: " Le numéro est 2026." },
            ],
          }),
        );
      default:
        return Promise.resolve(undefined);
    }
  });
  return { speak };
}

/** Fichier sélectionné exploitable sous jsdom, qui n'implémente pas `Blob.arrayBuffer`. */
function selectedFile(name: string, extension: string, mimeType: string, kind: "audio" | "video") {
  const bytes = new Uint8Array([1, 2, 3]);
  const file = new File([bytes], name, { type: mimeType });
  if (typeof file.arrayBuffer !== "function") {
    Object.defineProperty(file, "arrayBuffer", { value: async () => bytes.buffer });
  }
  return { id: "a", name, size: bytes.length, extension, mimeType, kind, file };
}

const audioFile = selectedFile("reunion.mp3", "mp3", "audio/mpeg", "audio");

beforeEach(() => {
  invokeMock.mockReset();
  listenMock.mockReset();
  listenMock.mockResolvedValue(() => {});
  bridge();
});

describe("synthèse vocale", () => {
  it("refuse un texte vide sans appeler le moteur", async () => {
    await expect(synthesize({ text: "   ", voiceId: "voice-fr-siwis" })).rejects.toThrow(/vide/i);
    expect(invokeMock).not.toHaveBeenCalledWith("tts_speak", expect.anything());
  });

  it("synthétise une phrase courte en un seul segment", async () => {
    const { speak } = bridge();
    const result = await synthesize({
      text: "Bonjour, ceci est un test de FourTout.",
      voiceId: "voice-fr-siwis",
    });
    expect(speak).toHaveBeenCalledTimes(1);
    expect(result.segments).toBe(1);
    expect(result.durationMs).toBe(4200);
    expect(result.bytes).toBeInstanceOf(Uint8Array);
  });

  it("découpe un long texte et publie une progression croissante", async () => {
    const { speak } = bridge();
    const long = "Ceci est une phrase de test assez longue pour occuper de la place. ".repeat(30);
    const ratios: number[] = [];

    const result = await synthesize(
      { text: long, voiceId: "voice-fr-siwis" },
      { report: ({ ratio }) => ratio !== undefined && ratios.push(ratio), signal: undefined as never },
    );

    expect(speak.mock.calls.length).toBeGreaterThan(2);
    expect(result.segments).toBe(speak.mock.calls.length);
    expect(ratios[0]).toBe(0);
    expect(ratios.at(-1)).toBe(1);
    expect([...ratios].sort((a, b) => a - b)).toEqual(ratios);
  });

  it("convertit la vitesse en durée de phonème pour Piper", async () => {
    bridge();
    await synthesize({ text: "Bonjour.", voiceId: "voice-fr-siwis", speed: 2 });
    const call = invokeMock.mock.calls.find(([command]) => command === "tts_speak");
    expect((call?.[1] as { params: { lengthScale: number } }).params.lengthScale).toBeCloseTo(0.5);
  });

  it("supprime tous les fichiers temporaires, y compris l'assemblage", async () => {
    bridge();
    await synthesize({ text: "Une phrase. Une autre phrase.", voiceId: "voice-fr-siwis" });
    const cleaned = invokeMock.mock.calls
      .filter(([command]) => command === "media_cleanup")
      .flatMap(([, args]) => (args as { paths: string[] }).paths);
    expect(cleaned).toContain("/tmp/fourtout-media/joined.wav");
    expect(cleaned.some((path) => path.includes("seg-1"))).toBe(true);
  });

  it("arrête le moteur et ne produit rien quand on annule", async () => {
    const controller = new AbortController();
    let calls = 0;
    invokeMock.mockImplementation((command: string) => {
      if (command === "tts_speak") {
        calls += 1;
        // L'utilisateur annule pendant la synthèse du premier segment.
        if (calls === 1) controller.abort();
        return Promise.resolve(`/tmp/fourtout-media/seg-${calls}.wav`);
      }
      return Promise.resolve(undefined);
    });

    const long = "Une phrase de test raisonnablement longue à lire. ".repeat(30);
    await expect(
      synthesize({ text: long, voiceId: "voice-fr-siwis" }, { report: () => {}, signal: controller.signal }),
    ).rejects.toBeInstanceOf(JobCancelledError);

    expect(invokeMock).toHaveBeenCalledWith("speech_cancel", expect.objectContaining({ jobId: expect.any(String) }));
    expect(invokeMock).not.toHaveBeenCalledWith("tts_concat", expect.anything());
  });

  it("relaie une erreur du moteur telle qu'elle est lisible", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "tts_speak") return Promise.reject(new Error("La synthèse vocale a échoué : voix absente"));
      return Promise.resolve(undefined);
    });
    await expect(synthesize({ text: "Bonjour.", voiceId: "voice-fr-siwis" })).rejects.toThrow(/voix absente/);
  });

  it("n'aperçoit qu'une phrase, pas le texte entier", async () => {
    const { speak } = bridge();
    await synthesizePreview("Première phrase. " + "Autre phrase. ".repeat(50), "voice-en-lessac");
    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak).toHaveBeenCalledWith("Première phrase.");
  });
});

describe("voix disponibles", () => {
  it("propose une voix française et une voix anglaise", () => {
    expect(TTS_VOICES.map((voice) => voice.language).sort()).toEqual(["en", "fr"]);
    expect(TTS_VOICES.every((voice) => /[A-Za-zÀ-ÿ]/.test(voice.label))).toBe(true);
  });

  it("choisit le français par défaut", () => {
    expect(defaultVoice("fr")).toBe("voice-fr-siwis");
    expect(defaultVoice("en")).toBe("voice-en-lessac");
  });

  it("affiche une durée lisible", () => {
    expect(formatDuration(4200)).toBe("4 s");
    expect(formatDuration(192_000)).toBe("3 min 12 s");
  });
});

describe("transcription", () => {
  it("normalise l'audio en 16 kHz mono avant d'appeler le moteur", async () => {
    bridge();
    await transcribe({ file: audioFile, modelId: "stt-base", language: "fr" });
    const exec = invokeMock.mock.calls.find(([command]) => command === "media_exec");
    const args = (exec?.[1] as { params: { args: string[] } }).params.args;
    expect(args).toEqual(expect.arrayContaining(["-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le"]));
  });

  it("renvoie des passages horodatés exploitables", async () => {
    bridge();
    const result = await transcribe({ file: audioFile, modelId: "stt-base", language: "fr" });
    expect(result.segments).toEqual([
      { start: 0, end: 2350, text: "Bonjour, ceci est un test." },
      { start: 2350, end: 5280, text: "Le numéro est 2026." },
    ]);
    expect(result.language).toBe("fr");
    expect(result.durationMs).toBe(5280);
  });

  it("accepte une vidéo par le même chemin (bande son extraite)", async () => {
    bridge();
    const video = selectedFile("reunion.mp4", "mp4", "video/mp4", "video");
    const result = await transcribe({ file: video, modelId: "stt-base", language: "auto" });
    expect(result.segments).toHaveLength(2);
    const exec = invokeMock.mock.calls.find(([command]) => command === "media_exec");
    // `-vn` écarte le flux vidéo : seule la bande son est transcrite.
    expect((exec?.[1] as { params: { args: string[] } }).params.args).toContain("-vn");
  });

  it("dit clairement qu'aucune parole n'a été détectée", async () => {
    bridge({ stt_transcribe: () => JSON.stringify({ transcription: [] }) });
    await expect(transcribe({ file: audioFile, modelId: "stt-base", language: "fr" })).rejects.toThrow(
      /aucune parole/i,
    );
  });

  it("remonte un modèle absent avec un message actionnable", async () => {
    bridge({
      stt_transcribe: () => {
        throw new Error("« Modèle de transcription — Rapide » n'est pas installé. Installez-le depuis l'outil pour continuer.");
      },
    });
    await expect(transcribe({ file: audioFile, modelId: "stt-base", language: "fr" })).rejects.toThrow(
      /n'est pas installé/,
    );
  });

  it("tue le moteur et la préparation à l'annulation", async () => {
    const controller = new AbortController();
    invokeMock.mockImplementation((command: string) => {
      if (command === "media_stage") return Promise.resolve("/tmp/fourtout-media/input.mp3");
      if (command === "media_temp") return Promise.resolve("/tmp/fourtout-media/prepared.wav");
      if (command === "media_exec") {
        controller.abort();
        return Promise.resolve(undefined);
      }
      return Promise.resolve(undefined);
    });

    await expect(
      transcribe(
        { file: audioFile, modelId: "stt-base", language: "fr" },
        { report: () => {}, signal: controller.signal },
      ),
    ).rejects.toBeInstanceOf(JobCancelledError);
    expect(invokeMock).toHaveBeenCalledWith("speech_cancel", expect.anything());
    expect(invokeMock).not.toHaveBeenCalledWith("stt_transcribe", expect.anything());
  });

  it("nettoie ses fichiers préparés dans tous les cas", async () => {
    bridge();
    await transcribe({ file: audioFile, modelId: "stt-base", language: "fr" });
    const cleaned = invokeMock.mock.calls
      .filter(([command]) => command === "media_cleanup")
      .flatMap(([, args]) => (args as { paths: string[] }).paths);
    expect(cleaned).toContain("/tmp/fourtout-media/prepared.wav");
    expect(cleaned).toContain("/tmp/fourtout-media/input.mp3");
  });

  it("propose un modèle rapide et un modèle précis", () => {
    expect(STT_MODELS.map((model) => model.id)).toEqual(["stt-base", "stt-small"]);
  });
});

describe("lecture de la sortie whisper.cpp", () => {
  it("ignore les passages vides et normalise les espaces", () => {
    const { segments } = parseWhisperJson(
      JSON.stringify({
        transcription: [
          { offsets: { from: 0, to: 1000 }, text: "  Bonjour.  " },
          { offsets: { from: 1000, to: 2000 }, text: "   " },
        ],
      }),
    );
    expect(segments).toEqual([{ start: 0, end: 1000, text: "Bonjour." }]);
  });

  it("refuse proprement une sortie illisible", () => {
    expect(() => parseWhisperJson("pas du json")).toThrow(/n'a pas pu être lue/);
  });
});

describe("gestionnaire de modèles", () => {
  const asset = (id: string, installed: boolean): SpeechAsset => ({
    id,
    kind: "voice",
    label: id,
    detail: "",
    size: 1000,
    installed,
    available: true,
    license: "MIT",
    source: "https://example.com",
  });

  it("liste précisément ce qui manque", () => {
    const assets = [asset("engine-piper", true), asset("voice-fr-siwis", false)];
    expect(missingAssets(assets, ["engine-piper", "voice-fr-siwis"]).map((a) => a.id)).toEqual([
      "voice-fr-siwis",
    ]);
    expect(missingAssets(assets, ["engine-piper"])).toEqual([]);
  });

  it("annule une installation en cours par le pont natif", async () => {
    const controller = new AbortController();
    invokeMock.mockImplementation((command: string) => {
      if (command === "models_install") {
        controller.abort();
        return Promise.reject(new Error("cancelled"));
      }
      return Promise.resolve(undefined);
    });
    await expect(installAsset("stt-base", { signal: controller.signal })).rejects.toThrow(/cancelled/);
    expect(invokeMock).toHaveBeenCalledWith("models_cancel", expect.objectContaining({ jobId: expect.any(String) }));
  });

  it("affiche des tailles lisibles", () => {
    expect(formatSize(63_201_294)).toBe("63 Mo");
    expect(formatSize(487_601_967)).toBe("488 Mo");
    expect(formatSize(1_500_000_000)).toBe("1.5 Go");
  });
});
