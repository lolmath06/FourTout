import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type * as RouterModule from "react-router-dom";
import { toolRegistry } from "@/core/tools/registry";
import { clearHandoff, peekHandoff } from "@/features/handoff/store";
import type { Identity } from "@/core/convert/identity";

/**
 * Le convertisseur dans l'application : le fichier est identifié par son
 * **contenu**, ses flux sont lus, les capacités de la machine sont vérifiées,
 * et seules les conversions réelles sont proposées.
 */
const world = vi.hoisted(() => ({
  identity: null as Identity | null,
  named: "fichier.bin",
  media: { hasVideo: true, hasAudio: true },
  formats: { heic: true, avif: true, animatedWebp: true, apng: true, ffmpeg: true },
  encoders: ["libwebp_anim"] as string[],
}));

vi.mock("@/core/platform", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/core/platform");
  return { ...actual, isTauri: () => true };
});
vi.mock("@/components/files/PathPicker", () => ({
  PathPicker: ({ onChange, label }: { onChange: (paths: string[]) => void; label?: string }) => (
    <button type="button" onClick={() => onChange([`/home/u/${world.named}`])}>{label}</button>
  ),
}));
vi.mock("@/core/convert/identity", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/core/convert/identity");
  return { ...actual, identifyPath: async () => world.identity! };
});
vi.mock("@/core/files/native", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/core/files/native");
  return {
    ...actual,
    fileInfo: async (path: string) => ({ name: path.split("/").pop(), size: 4096, extension: path.split(".").pop() }),
    readBytes: async () => new Uint8Array([1, 2, 3]),
  };
});
vi.mock("@/core/internet/native", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/core/internet/native");
  return {
    ...actual,
    nativeImageFormats: async () => world.formats,
    probeMediaPath: async () => JSON.stringify({ format: { format_name: "matroska,webm", duration: "10" }, streams: [
      ...(world.media.hasVideo ? [{ index: 0, codec_type: "video", codec_name: "vp9", width: 640, height: 360 }] : []),
      ...(world.media.hasAudio ? [{ index: 1, codec_type: "audio", codec_name: "opus", channels: 2 }] : []),
    ] }),
  };
});
vi.mock("@/core/media/client", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/core/media/client");
  return { ...actual, availableEncoders: async () => world.encoders };
});

const navigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof RouterModule>("react-router-dom");
  return { ...actual, useNavigate: () => navigate };
});

import { UniversalConverterTool } from "./UniversalConverterTool";

function identity(id: string, extra: Partial<Identity> = {}): Identity {
  return { id, label: id.toUpperCase(), family: "image", animated: false, mime: null, extensions: [id], basis: "content", ...extra };
}

async function open(named: string, found: Identity) {
  world.named = named;
  world.identity = found;
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <UniversalConverterTool tool={toolRegistry.get("universal-converter")!} />
    </MemoryRouter>,
  );
  await user.click(screen.getByRole("button", { name: /Déposez un fichier/ }));
  await screen.findByTestId("converter-detection");
  return user;
}

const offered = () => screen.queryAllByTestId(/^convert-to-/).map((node) => node.getAttribute("data-testid")!.replace("convert-to-", ""));

beforeEach(() => {
  navigate.mockReset();
  clearHandoff();
  world.formats = { heic: true, avif: true, animatedWebp: true, apng: true, ffmpeg: true };
  world.encoders = ["libwebp_anim"];
  world.media = { hasVideo: true, hasAudio: true };
});

describe("convertisseur universel — identification par le contenu", () => {
  it("un WebP animé propose des conversions qui gardent l'animation, via le bon outil", async () => {
    const user = await open("sticker.webp", identity("webp", { animated: true, label: "Image WebP animée" }));
    await waitFor(() => expect(offered()).toContain("mp4"));
    expect(offered()).toEqual(expect.arrayContaining(["gif", "apng", "mp4", "webm", "frames"]));
    expect(offered()).not.toContain("webp");
    expect(screen.getByTestId("note-animated")).toBeInTheDocument();
    expect(screen.getByTestId("converter-detection")).toHaveTextContent("Image WebP animée");
    expect(screen.getByTestId("converter-detection")).toHaveTextContent(/identifié par son contenu/);

    await user.click(screen.getByTestId("convert-to-gif"));
    expect(navigate).toHaveBeenCalledWith("/tools/t/animated-image-convert");
    const handoff = peekHandoff("animated-image-convert");
    expect(handoff?.paths).toEqual(["/home/u/sticker.webp"]);
    expect(handoff?.preset).toEqual({ target: "gif" });
  });

  it("n'annonce pas ce que FFmpeg ne sait pas faire", async () => {
    world.formats = { ...world.formats, ffmpeg: false };
    await open("sticker.webp", identity("webp", { animated: true }));
    await waitFor(() => expect(offered()).toContain("frames"));
    expect(offered()).toEqual(["frames"]);
    expect(screen.getByTestId("note-no-ffmpeg")).toBeInTheDocument();
  });

  it("un fichier .jpg qui est un PNG est traité comme un PNG, et le dit", async () => {
    await open("photo.jpg", identity("png", { label: "Image PNG", extensions: ["png"] }));
    await waitFor(() => expect(offered()).toContain("webp"));
    expect(screen.getByTestId("note-extension-mismatch")).toHaveTextContent(/se nomme « \.jpg » mais contient Image PNG/);
  });

  it("un ISO s'inspecte et s'extrait, sans conversion", async () => {
    const user = await open("debian.iso", identity("iso", { family: "archive", label: "Image disque ISO 9660" }));
    await waitFor(() => expect([...offered()].sort()).toEqual(["extract", "inspect"]));
    await user.click(screen.getByTestId("convert-to-inspect"));
    expect(navigate).toHaveBeenCalledWith("/tools/t/iso-inspect");
    expect(peekHandoff("iso-inspect")?.paths).toEqual(["/home/u/debian.iso"]);
  });

  it("un WebM sans image n'offre que de l'audio", async () => {
    world.media = { hasVideo: false, hasAudio: true };
    await open("podcast.webm", identity("webm", { family: "video", extensions: ["webm", "mkv"], label: "Vidéo WebM" }));
    await waitFor(() => expect(offered()).toContain("mp3"));
    expect(offered()).not.toContain("gif");
    expect(offered()).not.toContain("png");
    expect(screen.getByTestId("note-no-video-stream")).toBeInTheDocument();
  });

  it("un WebM complet propose vidéo, GIF, WebP animé et audio", async () => {
    await open("clip.webm", identity("webm", { family: "video", extensions: ["webm", "mkv"] }));
    await waitFor(() => expect(offered()).toContain("mp3"));
    expect(offered()).toEqual(expect.arrayContaining(["mp4", "gif", "webp", "mp3", "flac"]));
  });

  it("un HEIC est proposé en JPG, PNG et WebP, et lu avant l'ouverture de l'outil", async () => {
    const user = await open("IMG_0001.heic", identity("heic", { extensions: ["heic", "heif"] }));
    await waitFor(() => expect(offered()).toContain("jpg"));
    expect(offered()).toEqual(expect.arrayContaining(["jpg", "png", "webp"]));
    await user.click(screen.getByTestId("convert-to-jpg"));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/tools/t/image-convert"));
    const handoff = peekHandoff("image-convert");
    expect(handoff?.preset).toEqual({ format: "jpg" });
    expect(handoff?.files?.[0].name).toBe("IMG_0001.heic");
  });

  it("une séquence HEIF n'est pas présentée comme une photo", async () => {
    await open("burst.heic", identity("heic", { animated: true }));
    expect(await screen.findByTestId("note-sequence")).toBeInTheDocument();
    expect(offered()).toEqual([]);
  });

  it("l'AVIF n'est proposé que si ce système sait le décoder", async () => {
    world.formats = { ...world.formats, avif: false };
    await open("photo.avif", identity("avif"));
    expect(await screen.findByTestId("note-avif-unavailable")).toBeInTheDocument();
    expect(offered()).toEqual([]);
  });
});
