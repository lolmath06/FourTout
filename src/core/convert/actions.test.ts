import { describe, expect, it } from "vitest";
import { canonicalSource, planActions, type Capabilities } from "./actions";
import { identityFromExtension, type Identity } from "./identity";

const ALL: Capabilities = { ffmpeg: true, webpAnimated: true, avif: true, heic: true, native: true };

function content(id: string, extra: Partial<Identity> = {}): Identity {
  return { id, label: id.toUpperCase(), family: "image", animated: false, mime: null, extensions: [id], basis: "content", ...extra };
}

const targets = (plan: ReturnType<typeof planActions>) => plan.actions.map((a) => a.to);

describe("conversions déduites du contenu", () => {
  it("un WebP animé ne passe jamais par un outil d'image fixe", () => {
    const plan = planActions(content("webp", { animated: true }), "webp", undefined, ALL);
    expect(targets(plan)).toEqual(["gif", "apng", "mp4", "webm", "frames"]);
    expect(plan.actions.every((a) => a.toolId === "animated-image-convert")).toBe(true);
    expect(plan.notes.some((n) => n.kind === "animated")).toBe(true);
    // Aucune conversion d'image fixe (qui aplatirait l'animation) n'est proposée.
    expect(plan.actions.some((a) => a.toolId === "image-convert")).toBe(false);
  });

  it("un APNG propose le WebP animé mais pas lui-même", () => {
    const plan = planActions(content("apng", { animated: true, extensions: ["png", "apng"] }), "png", undefined, ALL);
    expect(targets(plan)).toContain("webp");
    expect(targets(plan)).not.toContain("apng");
    // Un fichier .png qui est en fait un APNG est traité comme tel.
    expect(plan.actions.every((a) => a.toolId === "animated-image-convert")).toBe(true);
  });

  it("n'annonce pas ce que FFmpeg ne peut pas faire", () => {
    const noFfmpeg = { ...ALL, ffmpeg: false };
    const plan = planActions(content("webp", { animated: true }), "webp", undefined, noFfmpeg);
    expect(targets(plan)).toEqual(["frames"]);
    expect(plan.notes.some((n) => n.kind === "no-ffmpeg")).toBe(true);
    const noWebp = planActions(content("apng", { animated: true }), "png", undefined, { ...ALL, webpAnimated: false });
    expect(targets(noWebp)).not.toContain("webp");
  });

  it("un WebP fixe passe par les conversions d'image ordinaires", () => {
    const plan = planActions(content("webp"), "webp", undefined, ALL);
    expect(targets(plan)).toEqual(expect.arrayContaining(["png", "jpg"]));
    expect(plan.actions.some((a) => a.toolId === "animated-image-convert")).toBe(false);
  });

  it("un ISO s'inspecte et s'extrait, il ne se convertit pas", () => {
    const plan = planActions(content("iso", { family: "archive" }), "iso", undefined, ALL);
    expect(plan.actions.map((a) => a.toolId)).toEqual(["iso-inspect", "iso-extract"]);
    expect(plan.actions.every((a) => a.transport === "path")).toBe(true);
  });

  it("HEIC et HEIF mènent aux conversions d'image, si le décodeur existe", () => {
    const heic = planActions(content("heic", { extensions: ["heic", "heif"] }), "heic", undefined, ALL);
    expect(targets(heic)).toEqual(expect.arrayContaining(["jpg", "png", "webp"]));
    const heif = planActions(content("heif", { extensions: ["heif", "heic"] }), "heif", undefined, ALL);
    expect(targets(heif)).toContain("jpg");
    const without = planActions(content("heic"), "heic", undefined, { ...ALL, heic: false });
    expect(without.actions).toEqual([]);
    expect(without.notes[0].kind).toBe("heic-unavailable");
  });

  it("une séquence HEIF n'est pas présentée comme une photo", () => {
    const plan = planActions(content("heic", { animated: true }), "heic", undefined, ALL);
    expect(plan.actions).toEqual([]);
    expect(plan.notes.map((n) => n.kind)).toEqual(["sequence"]);
  });

  it("l'AVIF n'est proposé que si cette machine le décode vraiment", () => {
    expect(targets(planActions(content("avif"), "avif", undefined, ALL))).toContain("jpg");
    const none = planActions(content("avif"), "avif", undefined, { ...ALL, avif: false });
    expect(none.actions).toEqual([]);
    expect(none.notes[0].kind).toBe("avif-unavailable");
  });

  it("WebM : conversions vidéo et audio selon les pistes réellement présentes", () => {
    const webm = content("webm", { family: "video", extensions: ["webm", "mkv"] });
    const full = planActions(webm, "webm", { hasVideo: true, hasAudio: true }, ALL);
    expect(targets(full)).toEqual(expect.arrayContaining(["mp4", "mkv", "gif", "mp3", "wav", "flac", "m4a", "webp"]));
    expect(full.actions.find((a) => a.to === "webp")?.preset).toEqual({ format: "webp" });

    const audioOnly = planActions(webm, "webm", { hasVideo: false, hasAudio: true }, ALL);
    expect(targets(audioOnly)).toEqual(expect.arrayContaining(["mp3", "wav"]));
    expect(targets(audioOnly)).not.toContain("gif");
    expect(targets(audioOnly)).not.toContain("webp");
    expect(audioOnly.notes.some((n) => n.kind === "no-video-stream")).toBe(true);

    const silent = planActions(webm, "webm", { hasVideo: true, hasAudio: false }, ALL);
    expect(targets(silent)).not.toContain("mp3");
    expect(targets(silent)).toContain("gif");
    expect(silent.notes.some((n) => n.kind === "no-audio-stream")).toBe(true);
  });

  it("sans encodeur WebP animé, la vidéo ne propose pas de WebP", () => {
    const mp4 = content("mp4", { family: "video" });
    const plan = planActions(mp4, "mp4", { hasVideo: true, hasAudio: true }, { ...ALL, webpAnimated: false });
    expect(targets(plan)).not.toContain("webp");
  });

  it("le contenu prime sur l'extension, et le dit", () => {
    const png = content("png", { label: "Image PNG" });
    const plan = planActions(png, "jpg", undefined, ALL);
    expect(plan.notes[0]).toEqual({ kind: "extension-mismatch", named: "jpg", actual: "Image PNG" });
    expect(plan.source).toBe("png");
    expect(canonicalSource(png, "jpg", new Set(["png", "jpg"]))).toBe("png");
  });

  it("un fichier sans extension est reconnu par son contenu", () => {
    const plan = planActions(content("png"), "", undefined, ALL);
    expect(targets(plan)).toEqual(expect.arrayContaining(["jpg", "webp"]));
    expect(plan.notes.some((n) => n.kind === "extension-mismatch")).toBe(false);
  });

  it("repli sur l'extension quand le contenu est inconnu", () => {
    const plan = planActions(identityFromExtension("png"), "png", undefined, { ...ALL, native: false });
    expect(targets(plan)).toEqual(expect.arrayContaining(["jpg", "webp", "pdf"]));
  });

  it("chaque action pointe un outil réellement présent au registre", async () => {
    const { toolRegistry } = await import("@/core/tools/registry");
    const samples: [Identity, string, { hasVideo: boolean; hasAudio: boolean } | undefined][] = [
      [content("webp", { animated: true }), "webp", undefined],
      [content("iso", { family: "archive" }), "iso", undefined],
      [content("webm", { family: "video", extensions: ["webm", "mkv"] }), "webm", { hasVideo: true, hasAudio: true }],
      [content("heic"), "heic", undefined],
      [content("pdf", { family: "document" }), "pdf", undefined],
    ];
    for (const [identity, named, facts] of samples) {
      for (const action of planActions(identity, named, facts, ALL).actions) {
        expect(toolRegistry.has(action.toolId), `${identity.id} → ${action.toolId}`).toBe(true);
      }
    }
  });
});
