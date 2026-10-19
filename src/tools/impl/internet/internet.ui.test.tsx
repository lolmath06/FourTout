import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { toolRegistry } from "@/core/tools/registry";

/**
 * Les écrans Internet, éprouvés sans réseau : le client natif est remplacé par
 * des doublures qui enregistrent ce qu'on leur demande. Ce qu'on vérifie, c'est
 * ce que l'écran **fait** — rien ne part avant un clic, l'installation d'un
 * composant est explicite, chaque appel porte les bons paramètres.
 */
const native = vi.hoisted(() => ({
  available: true,
  probeUrl: vi.fn(),
  downloadUrl: vi.fn(),
  shortenUrl: vi.fn(),
  runSpeedTest: vi.fn(),
  ytdlpStatus: vi.fn(),
  ytdlpCapabilities: vi.fn(),
  ytdlpInstall: vi.fn(),
  ytdlpInfo: vi.fn(),
  ytdlpPreview: vi.fn(),
  ytdlpDownload: vi.fn(),
  ytdlpAnimate: vi.fn(),
  ytdlpLatest: vi.fn(),
  ytdlpRemove: vi.fn(),
  detectBrowsers: vi.fn(),
  captureWeb: vi.fn(),
  pickSavePath: vi.fn(),
  pickDirectory: vi.fn(),
}));

vi.mock("@/core/internet/native", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/core/internet/native");
  return {
    ...actual,
    isInternetAvailable: () => native.available,
    probeUrl: native.probeUrl,
    downloadUrl: native.downloadUrl,
    shortenUrl: native.shortenUrl,
    runSpeedTest: native.runSpeedTest,
    ytdlpStatus: native.ytdlpStatus,
    ytdlpCapabilities: native.ytdlpCapabilities,
    ytdlpInstall: native.ytdlpInstall,
    ytdlpInfo: native.ytdlpInfo,
    ytdlpPreview: native.ytdlpPreview,
    ytdlpDownload: native.ytdlpDownload,
    ytdlpAnimate: native.ytdlpAnimate,
    ytdlpLatest: native.ytdlpLatest,
    ytdlpRemove: native.ytdlpRemove,
    detectBrowsers: native.detectBrowsers,
    captureWeb: native.captureWeb,
  };
});

vi.mock("@/core/files/native", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/core/files/native");
  return {
    ...actual,
    isFilesEngineAvailable: () => native.available,
    pickSavePath: native.pickSavePath,
    pickDirectory: native.pickDirectory,
  };
});

import { UrlDownloadTool } from "./UrlDownloadTool";
import { UrlShortenTool } from "./UrlShortenTool";
import { SpeedTestTool } from "./SpeedTestTool";
import { MediaDownloadTool, MediaUrlGifTool } from "./MediaTools";
import { WebToPdfTool, WebToImageTool } from "./WebCaptureTool";

function mount(id: string, Component: (props: { tool: never }) => React.ReactNode) {
  const tool = toolRegistry.get(id);
  expect(tool, id).toBeDefined();
  return render(
    <MemoryRouter>
      <Component tool={tool as never} />
    </MemoryRouter>,
  );
}

const PROBE = {
  requestedUrl: "https://exemple.org/dl",
  finalUrl: "https://cdn.exemple.org/rapport.pdf",
  redirects: 1,
  status: 200,
  mime: "application/pdf",
  size: 1_500_000,
  filename: "rapport.pdf",
  acceptsRanges: true,
  etag: "\"v1\"",
  lastModified: null,
};

beforeEach(() => {
  native.available = true;
  for (const key of Object.keys(native) as (keyof typeof native)[]) {
    const value = native[key];
    if (typeof value === "function" && "mockReset" in value) (value as ReturnType<typeof vi.fn>).mockReset();
  }
  native.pickSavePath.mockResolvedValue("/tmp/rapport.pdf");
  native.pickDirectory.mockResolvedValue("/tmp/sortie");
});

describe("hors de l'application", () => {
  it.each([
    ["url-download", UrlDownloadTool],
    ["url-shorten", UrlShortenTool],
    ["speed-test", SpeedTestTool],
    ["media-download", MediaDownloadTool],
    ["web-to-pdf", WebToPdfTool],
  ])("%s dit qu'il faut l'application, sans rien envoyer", (id, Component) => {
    native.available = false;
    mount(id, Component as never);
    expect(screen.getByText("Application installée requise")).toBeInTheDocument();
    expect(native.probeUrl).not.toHaveBeenCalled();
    expect(native.shortenUrl).not.toHaveBeenCalled();
  });
});

describe("Télécharger un fichier depuis une URL", () => {
  it("n'envoie rien avant le clic, inspecte, puis télécharge vers l'emplacement choisi", async () => {
    const user = userEvent.setup();
    native.probeUrl.mockResolvedValue(PROBE);
    native.downloadUrl.mockResolvedValue({ path: "/tmp/rapport.pdf", bytes: 1_500_000, sha256: "ab".repeat(32), resumedFrom: 0, finalUrl: PROBE.finalUrl, mime: "application/pdf", elapsedMs: 900, bytesPerSecond: 1_000_000, restarted: false });
    mount("url-download", UrlDownloadTool);

    expect(screen.getByTestId("internet-contacts")).toHaveTextContent(/contacte l'adresse que vous indiquez/);
    await user.type(screen.getByPlaceholderText("https://"), "https://exemple.org/dl");
    expect(native.probeUrl).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /Inspecter/ }));
    expect(await screen.findByTestId("final-url")).toHaveTextContent("https://cdn.exemple.org/rapport.pdf");
    expect(native.downloadUrl).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /Télécharger…/ }));
    await waitFor(() => expect(native.downloadUrl).toHaveBeenCalled());
    const [params] = native.downloadUrl.mock.calls[0];
    // On télécharge l'adresse FINALE, vers le chemin choisi, avec reprise.
    expect(params).toMatchObject({ url: "https://cdn.exemple.org/rapport.pdf", destination: "/tmp/rapport.pdf", resume: true });
    expect(native.pickSavePath).toHaveBeenCalledWith("rapport.pdf");
    expect(await screen.findByText("Téléchargement terminé")).toBeInTheDocument();
    expect(screen.getAllByText(/SHA-256/).length).toBeGreaterThan(0);
  });

  it("refuse une adresse qui n'est pas HTTP(S) et montre l'erreur d'un serveur", async () => {
    const user = userEvent.setup();
    mount("url-download", UrlDownloadTool);
    await user.type(screen.getByPlaceholderText("https://"), "ftp://exemple.org/x");
    expect(screen.getByText(/doit commencer par http/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Inspecter/ })).toBeDisabled();

    native.probeUrl.mockRejectedValue(new Error("Fichier introuvable sur le serveur (HTTP 404)."));
    await user.clear(screen.getByPlaceholderText("https://"));
    await user.type(screen.getByPlaceholderText("https://"), "https://exemple.org/absent");
    await user.click(screen.getByRole("button", { name: /Inspecter/ }));
    expect(await screen.findByText(/HTTP 404/)).toBeInTheDocument();
  });
});

describe("Raccourcir une URL", () => {
  it("nomme le service contacté, affiche le lien court et le copie", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    native.shortenUrl.mockResolvedValue({ provider: "is.gd", original: "https://exemple.org/long", shortUrl: "https://is.gd/abc", endpoint: "https://is.gd/create.php" });
    mount("url-shorten", UrlShortenTool);

    expect(screen.getByTestId("internet-contacts")).toHaveTextContent(/is\.gd/);
    expect(screen.getByTestId("internet-contacts")).toHaveTextContent(/qui la conserve/);
    await user.type(screen.getByPlaceholderText("https://"), "https://exemple.org/long");
    await user.click(screen.getByRole("button", { name: /^Raccourcir$/ }));

    expect(native.shortenUrl).toHaveBeenCalledWith("https://exemple.org/long", "is-gd");
    expect(await screen.findByTestId("short-url")).toHaveTextContent("https://is.gd/abc");
    await user.click(screen.getByRole("button", { name: /Copier/ }));
    expect(writeText).toHaveBeenCalledWith("https://is.gd/abc");
    // Le lien n'est jamais ouvert automatiquement.
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});

describe("Test de débit", () => {
  it("annonce le service contacté, puis affiche les quatre mesures et leurs unités", async () => {
    const user = userEvent.setup();
    native.runSpeedTest.mockResolvedValue({
      endpoint: "https://speed.cloudflare.com", server: "Paris", latencyMs: 12.4, jitterMs: 1.3, latencySamples: 12,
      downloadMbps: 94.3, uploadMbps: 21.8, downloadBytes: 50_000_000, uploadBytes: 10_000_000, durationMs: 14_000,
    });
    mount("speed-test", SpeedTestTool);
    expect(screen.getByTestId("internet-contacts")).toHaveTextContent(/speed\.cloudflare\.com/);
    expect(native.runSpeedTest).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /Lancer le test/ }));
    const result = await screen.findByTestId("speed-result");
    expect(result).toHaveTextContent(/94[.,]3 Mb\/s/);
    expect(result).toHaveTextContent(/21[.,]8 Mb\/s/);
    expect(result).toHaveTextContent(/12[.,]4 ms/);
    expect(result).toHaveTextContent(/1[.,]3 ms/);
    expect(result).toHaveTextContent(/Paris/);
    // 94,3 Mb/s ≈ 11,8 Mo/s : la conversion en octets est donnée.
    expect(result).toHaveTextContent(/11[.,]8/);
  });
});

describe("Télécharger un média depuis Internet", () => {
  const status = (installed: boolean) => ({ installed, origin: installed ? "managed" : null, path: null, version: installed ? "2026.10.01" : null, supported: true, directory: "/data/engines/yt-dlp", jsRuntime: null });
  const caps = { ffmpeg: true, webpAnimated: true, audioEncoders: ["libmp3lame", "aac", "flac"] };
  const INFO = {
    id: "abc", title: "Mon clip", uploader: "Une chaîne", durationSecs: 120, thumbnailUrl: null, thumbnailData: null, webpageUrl: "https://x.org/v",
    extractor: "Youtube", isLive: false, formats: [], heights: [1080, 720, 360], hasAudio: true, hasVideo: true,
  };

  it("n'installe jamais yt-dlp sans clic, et décrit l'installation", async () => {
    const user = userEvent.setup();
    native.ytdlpStatus.mockResolvedValue(status(false));
    native.ytdlpCapabilities.mockResolvedValue(caps);
    native.ytdlpInstall.mockResolvedValue({ version: "2026.10.01", sha256: "x", path: "/p" });
    mount("media-download", MediaDownloadTool);

    const missing = await screen.findByTestId("ytdlp-missing");
    expect(missing).toHaveTextContent(/SHA-256/);
    expect(missing).toHaveTextContent(/GitHub/);
    expect(native.ytdlpInstall).not.toHaveBeenCalled();
    // Sans yt-dlp, on ne peut pas analyser d'adresse.
    expect(screen.getByRole("button", { name: /Analyser/ })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /Installer yt-dlp/ }));
    expect(native.ytdlpInstall).toHaveBeenCalledTimes(1);
  });

  it("annonce ce qui n'est pas pris en charge : DRM, comptes, cookies", async () => {
    native.ytdlpStatus.mockResolvedValue(status(true));
    native.ytdlpCapabilities.mockResolvedValue(caps);
    mount("media-download", MediaDownloadTool);
    expect(screen.getByTestId("internet-contacts")).toHaveTextContent(/ne contourne ni DRM/);
    expect(screen.getByTestId("internet-contacts")).toHaveTextContent(/aucun cookie/);
  });

  it("signale l'absence de FFmpeg", async () => {
    native.ytdlpStatus.mockResolvedValue(status(true));
    native.ytdlpCapabilities.mockResolvedValue({ ffmpeg: false, webpAnimated: false, audioEncoders: [] });
    mount("media-download", MediaDownloadTool);
    expect(await screen.findByTestId("ffmpeg-missing")).toBeInTheDocument();
  });

  it("analyse, propose les résolutions de la source, et télécharge avec la demande exacte", async () => {
    const user = userEvent.setup();
    native.ytdlpStatus.mockResolvedValue(status(true));
    native.ytdlpCapabilities.mockResolvedValue(caps);
    native.ytdlpInfo.mockResolvedValue(INFO);
    native.ytdlpPreview.mockResolvedValue({ resolvedHeight: 720, estimatedBytes: 40_000_000, video: null, audio: null });
    native.ytdlpDownload.mockResolvedValue({ path: "/tmp/sortie/Mon clip.mp4", bytes: 39_000_000, container: "mp4", method: "full", reencoded: false, warnings: [] });
    mount("media-download", MediaDownloadTool);

    await screen.findByTestId("ytdlp-ready");
    await user.type(screen.getByPlaceholderText("https://"), "https://x.org/v");
    await user.click(screen.getByRole("button", { name: /Analyser/ }));
    await screen.findByTestId("media-info");

    // Jamais de 2160p proposé pour une source qui plafonne à 1080p.
    const select = screen.getByLabelText("Résolution maximale");
    const options = Array.from(select.querySelectorAll("option")).map((o) => o.textContent);
    expect(options).toContain("1080p");
    expect(options).not.toContain("2160p");
    expect(options).not.toContain("1440p");

    await user.selectOptions(select, "720");
    await user.click(screen.getByRole("button", { name: /Choisir le dossier/ }));
    await user.click(screen.getByRole("button", { name: /^Télécharger$/ }));

    await waitFor(() => expect(native.ytdlpDownload).toHaveBeenCalled());
    const [params] = native.ytdlpDownload.mock.calls[0];
    expect(params.destination).toBe("/tmp/sortie");
    expect(params.request).toMatchObject({ url: "https://x.org/v", mode: "video", container: "mp4", maxHeight: 720, maxBytes: null, section: null });
    // Le titre est transmis assaini, jamais comme chemin.
    expect(params.title).toBe("Mon clip");
    expect(await screen.findByText("Média enregistré")).toBeInTheDocument();
  });

  it("n'offre que les formats audio que ce FFmpeg sait encoder", async () => {
    const user = userEvent.setup();
    native.ytdlpStatus.mockResolvedValue(status(true));
    native.ytdlpCapabilities.mockResolvedValue(caps); // pas d'Opus ni de Vorbis
    native.ytdlpInfo.mockResolvedValue(INFO);
    native.ytdlpPreview.mockResolvedValue(null);
    mount("media-download", MediaDownloadTool);
    await screen.findByTestId("ytdlp-ready");
    await user.type(screen.getByPlaceholderText("https://"), "https://x.org/v");
    await user.click(screen.getByRole("button", { name: /Analyser/ }));
    await screen.findByTestId("media-info");
    await user.click(screen.getByRole("radio", { name: "Audio seul" }));
    const options = Array.from(screen.getByLabelText("Format audio").querySelectorAll("option")).map((o) => o.textContent);
    expect(options).toEqual(["MP3", "M4A (AAC)", "FLAC"]);
  });

  it("l'outil GIF propose le WebP animé seulement si l'encodeur existe", async () => {
    const user = userEvent.setup();
    native.ytdlpStatus.mockResolvedValue(status(true));
    native.ytdlpCapabilities.mockResolvedValue({ ...caps, webpAnimated: false });
    native.ytdlpInfo.mockResolvedValue(INFO);
    native.ytdlpPreview.mockResolvedValue(null);
    mount("media-url-gif", MediaUrlGifTool);
    await screen.findByTestId("ytdlp-ready");
    await user.type(screen.getByPlaceholderText("https://"), "https://x.org/v");
    await user.click(screen.getByRole("button", { name: /Analyser/ }));
    await screen.findByTestId("media-info");
    expect(screen.getByRole("radio", { name: "GIF" })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "WebP animé" })).not.toBeInTheDocument();
  });
});

describe("Capture web", () => {
  it("explique la dépendance quand aucun navigateur n'est installé", async () => {
    native.detectBrowsers.mockResolvedValue([]);
    mount("web-to-pdf", WebToPdfTool);
    expect(await screen.findByTestId("no-browser")).toHaveTextContent(/Chrome, de Chromium ou de Microsoft Edge/);
    expect(screen.getByPlaceholderText("https://")).toBeDisabled();
  });

  it("montre le navigateur détecté, et capture avec le papier et les marges choisis", async () => {
    const user = userEvent.setup();
    native.detectBrowsers.mockResolvedValue([{ family: "chromium", path: "/usr/bin/chromium", version: "126.0.1" }]);
    native.captureWeb.mockResolvedValue({ path: "/tmp/rapport.pdf", bytes: 5000, browser: "Chromium 126.0.1", finalUrl: "https://exemple.org/", httpStatus: 200, width: null, height: null });
    mount("web-to-pdf", WebToPdfTool);
    expect(await screen.findByTestId("browser-status")).toHaveTextContent(/Chromium 126\.0\.1/);

    await user.type(screen.getByPlaceholderText("https://"), "https://exemple.org/");
    await user.click(screen.getByRole("checkbox", { name: /Orientation paysage/ }));
    await user.click(screen.getByRole("button", { name: /Créer le PDF…/ }));

    await waitFor(() => expect(native.captureWeb).toHaveBeenCalled());
    const [params] = native.captureWeb.mock.calls[0];
    expect(params).toMatchObject({ url: "https://exemple.org/", output: "/tmp/rapport.pdf", browserPath: "/usr/bin/chromium" });
    expect(params.capture).toMatchObject({ kind: "pdf", paperWidth: 8.27, paperHeight: 11.69, landscape: true, marginMm: 10, background: true });
    expect(native.pickSavePath).toHaveBeenCalledWith("exemple.org.pdf");
  });

  it("la capture d'image transmet le format, la fenêtre et la pleine page", async () => {
    const user = userEvent.setup();
    native.detectBrowsers.mockResolvedValue([{ family: "edge", path: "C:\\Edge\\msedge.exe", version: null }]);
    native.captureWeb.mockResolvedValue({ path: "/tmp/x.webp", bytes: 1, browser: "Edge", finalUrl: "https://exemple.org/", httpStatus: 404, width: 1280, height: 3000 });
    native.pickSavePath.mockResolvedValue("/tmp/x.webp");
    mount("web-to-image", WebToImageTool);
    await screen.findByTestId("browser-status");
    await user.type(screen.getByPlaceholderText("https://"), "https://exemple.org/");
    await user.click(screen.getByRole("radio", { name: "WebP" }));
    await user.click(screen.getByRole("button", { name: /Capturer…/ }));
    await waitFor(() => expect(native.captureWeb).toHaveBeenCalled());
    expect(native.captureWeb.mock.calls[0][0].capture).toMatchObject({ kind: "image", format: "webp", viewportWidth: 1280, viewportHeight: 800, fullPage: true });
    // Une page en erreur est capturée, mais l'utilisateur est prévenu.
    expect(await screen.findByText(/HTTP 404/)).toBeInTheDocument();
  });
});
