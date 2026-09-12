import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AudioPreview } from "./AudioPreview";
import { OutputVideoPreview } from "./VideoPreview";
import { AUDIO_MIME } from "@/core/media/types";
import { CONTAINER_MIME } from "@/core/media/capabilities";

/**
 * Aperçu d'un résultat média.
 *
 * Le défaut corrigé ici ne venait ni du code d'aperçu ni de FFmpeg : la
 * conversion produisait un fichier parfaitement lisible, mais la politique de
 * sécurité de contenu ne déclarait pas `media-src`. Les `<audio>` et `<video>`
 * retombaient donc sur `default-src 'self'`, qui n'autorise pas `blob:` — le
 * lecteur audio affichait « Error » et la vidéo restait noire, sans le moindre
 * message ailleurs que dans la console de la WebView. `img-src` mentionnait
 * déjà `blob:`, ce qui explique que seuls les aperçus d'images fonctionnaient.
 *
 * La garde porte donc sur la politique elle-même, là où était la faute, et sur
 * le fait que les lecteurs produisent bien une source à charger.
 */
describe("politique de sécurité de contenu", () => {
  const csp: string = JSON.parse(
    readFileSync(join(process.cwd(), "src-tauri", "tauri.conf.json"), "utf-8"),
  ).app.security.csp;

  const directive = (name: string) =>
    csp
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name} `));

  it("autorise les URL objets pour les médias, sans quoi aucun aperçu ne se charge", () => {
    const media = directive("media-src");
    expect(media, "media-src doit être déclarée explicitement").toBeDefined();
    expect(media).toContain("blob:");
  });

  it("autorise toujours les URL objets pour les images", () => {
    expect(directive("img-src")).toContain("blob:");
  });
});

describe("lecteurs de résultat", () => {
  const bytes = new Uint8Array([0, 1, 2, 3]);

  it("donne une source au lecteur audio à partir des octets produits", async () => {
    render(<AudioPreview bytes={bytes} mimeType={AUDIO_MIME.wav} label="Écouter le résultat" />);
    await waitFor(() => expect(screen.getByText("Écouter le résultat")).toBeInTheDocument());
    const player = document.querySelector("audio")!;
    expect(player).toHaveAttribute("src", expect.stringMatching(/^blob:/));
    expect(player).toHaveAttribute("controls");
  });

  it("donne une source au lecteur vidéo à partir des octets produits", async () => {
    render(<OutputVideoPreview bytes={bytes} mimeType={CONTAINER_MIME.mp4} label="Aperçu du résultat" />);
    await waitFor(() => expect(screen.getByText("Aperçu du résultat")).toBeInTheDocument());
    expect(document.querySelector("video")).toHaveAttribute("src", expect.stringMatching(/^blob:/));
  });

  it("annonce un type MIME que la WebView sait reconnaître", () => {
    expect(AUDIO_MIME.wav).toBe("audio/wav");
    expect(CONTAINER_MIME.mp4).toBe("video/mp4");
  });
});
