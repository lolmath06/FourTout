import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Ouverture d'un lien issu d'un contenu externe (QR code).
 *
 * Le bouton « Ouvrir le lien » passait par `openPath`, réservé aux chemins du
 * disque : la portée « chemins » du plugin `opener` le rejetait et la promesse
 * échouait sans rien afficher. L'ouverture passe désormais par `openUrl`, avec
 * une liste blanche de protocoles.
 */

const openUrlMock = vi.fn();
let inTauri = true;

vi.mock("@/core/platform", () => ({
  isTauri: () => inTauri,
  detectPlatform: () => "linux",
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: openUrlMock }));

import { isOpenableUrl, openExternalUrl } from "./externalUrl";
import { looksLikeUrl } from "@/core/image/qr";

beforeEach(() => {
  inTauri = true;
  openUrlMock.mockReset();
  openUrlMock.mockResolvedValue(undefined);
});

describe("protocoles autorisés", () => {
  it("accepte http, https et mailto", () => {
    expect(isOpenableUrl("https://example.com/fourtout-test")).toBe(true);
    expect(isOpenableUrl("http://example.com/fourtout-test")).toBe(true);
    expect(isOpenableUrl("mailto:contact@example.com")).toBe(true);
  });

  it("refuse les protocoles actifs ou locaux", () => {
    expect(isOpenableUrl("javascript:alert(1)")).toBe(false);
    expect(isOpenableUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isOpenableUrl("file:///etc/passwd")).toBe(false);
    expect(isOpenableUrl("ftp://example.com/x")).toBe(false);
    expect(isOpenableUrl("fourtout-custom://run")).toBe(false);
  });

  it("refuse un texte qui n'est pas une URL", () => {
    expect(isOpenableUrl("FOURTOUT-QR-2026")).toBe(false);
    expect(isOpenableUrl("https://")).toBe(false);
    expect(isOpenableUrl("")).toBe(false);
  });

  it("gouverne aussi l'affichage du bouton dans le lecteur de QR", () => {
    // Pas de bouton « Ouvrir le lien » pour du texte simple.
    expect(looksLikeUrl("https://example.com/fourtout-test")).toBe(true);
    expect(looksLikeUrl("FOURTOUT-QR-2026")).toBe(false);
    expect(looksLikeUrl("javascript:alert(1)")).toBe(false);
  });
});

describe("ouverture via le pont Tauri", () => {
  it("passe une URL https à openUrl (et non à openPath)", async () => {
    await expect(openExternalUrl("https://example.com/fourtout-test")).resolves.toBe(true);
    expect(openUrlMock).toHaveBeenCalledWith("https://example.com/fourtout-test");
  });

  it("accepte http et normalise les espaces autour", async () => {
    await expect(openExternalUrl("  http://example.com/x  ")).resolves.toBe(true);
    expect(openUrlMock).toHaveBeenCalledWith("http://example.com/x");
  });

  it("ne confie jamais un protocole refusé au système", async () => {
    for (const bad of ["javascript:alert(1)", "data:text/plain,x", "file:///etc/passwd", "FOURTOUT-QR-2026"]) {
      await expect(openExternalUrl(bad)).resolves.toBe(false);
    }
    expect(openUrlMock).not.toHaveBeenCalled();
  });

  it("retombe sur le navigateur hors application", async () => {
    inTauri = false;
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    await expect(openExternalUrl("https://example.com/x")).resolves.toBe(true);
    expect(open).toHaveBeenCalledWith("https://example.com/x", "_blank", "noopener,noreferrer");
    expect(openUrlMock).not.toHaveBeenCalled();
  });
});
