// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Correctif du bug critique des exports : la WebView WebKitGTK n'encode pas le
 * WebP (`toBlob` y renvoie du PNG). Dans l'application, l'encodage WebP passe
 * donc par la commande native `encode_webp`. Ce test vérifie le routage : en
 * contexte Tauri, `encodeCanvas(…, "webp")` envoie bien un PNG valide à la
 * commande et renvoie les octets WebP qu'elle produit.
 */
const invokeMock = vi.fn();

vi.mock("@/core/platform", () => ({
  isTauri: () => true,
  detectPlatform: () => "linux",
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { setRasterBackend } from "@/core/pdf/raster/types";
import { nodeRasterBackend } from "@/test/nodeRaster";
import { encodeCanvas } from "./codec";

beforeAll(() => setRasterBackend(nodeRasterBackend));

describe("routage WebP natif (contexte Tauri)", () => {
  it("transcode via la commande native et non via le canvas", async () => {
    // Octets WebP renvoyés par la commande native (simulée).
    const fakeWebp = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x10, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2, 3, 4,
    ]);
    invokeMock.mockResolvedValue(fakeWebp.buffer);

    const canvas = nodeRasterBackend.createCanvas(8, 8);
    const out = await encodeCanvas(canvas, "webp");

    // Appelée avec un PNG (signature 0x89 P N G) comme corps.
    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [cmd, body] = invokeMock.mock.calls[0];
    expect(cmd).toBe("encode_webp");
    expect([...new Uint8Array(body).slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);

    // Renvoie exactement les octets WebP de la commande.
    expect(Buffer.from(out.subarray(0, 4)).toString("latin1")).toBe("RIFF");
    expect(Buffer.from(out.subarray(8, 12)).toString("latin1")).toBe("WEBP");
  });
});
