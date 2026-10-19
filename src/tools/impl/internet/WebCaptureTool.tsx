import { useEffect, useState } from "react";
import { Callout } from "@/components/ui/Callout";
import { Field, Fieldset, NumberInput, OptionGroup, Select, Slider } from "@/components/pdf/Field";
import { CheckOption } from "@/components/text/TextToolShell";
import { RunBar } from "@/components/files/NativeRun";
import { useNativeAction } from "@/components/files/useNativeAction";
import { Contacts, NativeGate, SavedFile, UrlField } from "@/components/internet/parts";
import {
  captureWeb,
  detectBrowsers,
  type CaptureSummary,
  type DetectedBrowser,
  type WebCapture,
} from "@/core/internet/native";
import { looksLikeWebUrl } from "@/core/internet/format";
import { pickSavePath } from "@/core/files/native";
import type { ToolComponentProps } from "@/tools/implementations";
import { localized, t, tx } from "@/i18n";

export type CaptureVariant = "pdf" | "image" | "mhtml";

const PAPER = localized(() => [
  { value: "a4", label: "A4", width: 8.27, height: 11.69 },
  { value: "a3", label: "A3", width: 11.69, height: 16.54 },
  { value: "letter", label: "Letter", width: 8.5, height: 11 },
  { value: "legal", label: "Legal", width: 8.5, height: 14 },
]);

const FORMATS = localized(() => [
  { value: "png" as const, label: "PNG" },
  { value: "jpeg" as const, label: "JPEG" },
  { value: "webp" as const, label: "WebP" },
]);

const VIEWPORTS = localized(() => [
  { value: "1280x800", label: t("Ordinateur (1280 × 800)"), width: 1280, height: 800 },
  { value: "1920x1080", label: t("Grand écran (1920 × 1080)"), width: 1920, height: 1080 },
  { value: "820x1180", label: t("Tablette (820 × 1180)"), width: 820, height: 1180 },
  { value: "390x844", label: t("Téléphone (390 × 844)"), width: 390, height: 844 },
]);

const BROWSER_NAMES = localized(() => ({
  chrome: "Google Chrome",
  chromium: "Chromium",
  edge: "Microsoft Edge",
  brave: "Brave",
}));

/**
 * Capture d'une page web — PDF, image, ou instantané MHTML.
 *
 * FourTout n'embarque pas de navigateur : il pilote un Chromium déjà installé,
 * dans un profil temporaire vierge (ni cookies ni historique de l'utilisateur).
 * La page est vue comme par un visiteur anonyme.
 */
function WebCapturePanel({ variant }: { variant: CaptureVariant }) {
  const [url, setUrl] = useState("");
  const [browsers, setBrowsers] = useState<DetectedBrowser[] | null>(null);
  const [browserPath, setBrowserPath] = useState("");
  const [paper, setPaper] = useState("a4");
  const [landscape, setLandscape] = useState(false);
  const [margin, setMargin] = useState(10);
  const [background, setBackground] = useState(true);
  const [format, setFormat] = useState<"png" | "jpeg" | "webp">("png");
  const [quality, setQuality] = useState(90);
  const [viewport, setViewport] = useState("1280x800");
  const [fullPage, setFullPage] = useState(true);
  const [timeout, setTimeoutSecs] = useState(60);
  const action = useNativeAction<CaptureSummary>();

  useEffect(() => {
    let alive = true;
    detectBrowsers().then((found) => {
      if (!alive) return;
      setBrowsers(found);
      if (found[0]) setBrowserPath(found[0].path);
    }).catch(() => alive && setBrowsers([]));
    return () => {
      alive = false;
    };
  }, []);

  const build = (): WebCapture => {
    if (variant === "pdf") {
      const size = PAPER.find((p) => p.value === paper) ?? PAPER[0];
      return { kind: "pdf", paperWidth: size.width, paperHeight: size.height, landscape, marginMm: margin, background };
    }
    if (variant === "image") {
      const size = VIEWPORTS.find((v) => v.value === viewport) ?? VIEWPORTS[0];
      return { kind: "image", format, quality, viewportWidth: size.width, viewportHeight: size.height, fullPage };
    }
    return { kind: "mhtml" };
  };

  const extension = variant === "pdf" ? "pdf" : variant === "mhtml" ? "mhtml" : format === "jpeg" ? "jpg" : format;
  const run = async () => {
    let host = "page";
    try {
      host = new URL(url).hostname.replace(/^www\./, "") || "page";
    } catch {
      /* l'adresse a déjà été validée plus haut */
    }
    const output = await pickSavePath(`${host}.${extension}`);
    if (!output) return;
    await action.execute((context) =>
      captureWeb({ url: url.trim(), capture: build(), output, overwrite: true, browserPath: browserPath || undefined, timeoutSecs: timeout }, context),
    );
  };

  const busy = action.job.isRunning;
  const noBrowser = browsers !== null && browsers.length === 0;
  const result = action.result;

  return (
    <div className="space-y-4">
      <Contacts>
        {t("Le site est chargé par un navigateur isolé (profil temporaire vierge) : ni vos cookies, ni votre historique, ni vos sessions.")}
      </Contacts>

      {noBrowser && (
        <Callout tone="warning" title={t("Aucun navigateur Chromium trouvé")} data-testid="no-browser">
          {t("Cet outil a besoin de Google Chrome, de Chromium ou de Microsoft Edge, déjà installé : FourTout n'en embarque pas. Installez l'un d'eux, puis rouvrez cet outil.")}
        </Callout>
      )}
      {browsers && browsers.length > 0 && (
        <p className="ft-meta" data-testid="browser-status">
          {t("Navigateur utilisé : {name}{version}", {
            name: tx(BROWSER_NAMES[browsers.find((b) => b.path === browserPath)?.family ?? browsers[0].family]),
            version: (browsers.find((b) => b.path === browserPath) ?? browsers[0]).version ? ` ${(browsers.find((b) => b.path === browserPath) ?? browsers[0]).version}` : "",
          })}
        </p>
      )}

      <UrlField value={url} onChange={setUrl} disabled={busy || noBrowser} onSubmit={run} />

      <Fieldset columns={2}>
        {variant === "pdf" && (
          <>
            <Field label={t("Format du papier")}>
              <Select value={paper} onChange={setPaper} options={PAPER.map((p) => ({ value: p.value, label: p.label }))} aria-label={t("Format du papier")} />
            </Field>
            <Field label={t("Marges ({value} mm)", { value: margin })}>
              <Slider value={margin} onChange={setMargin} min={0} max={40} />
            </Field>
            <CheckOption checked={landscape} onChange={setLandscape} label={t("Orientation paysage")} />
            <CheckOption checked={background} onChange={setBackground} label={t("Imprimer les arrière-plans")} hint={t("Couleurs et images de fond de la page.")} />
          </>
        )}
        {variant === "image" && (
          <>
            <Field label={t("Format")}>
              <OptionGroup value={format} onChange={setFormat} options={FORMATS} ariaLabel={t("Format de l'image")} />
            </Field>
            {format !== "png" && (
              <Field label={t("Qualité ({value} %)", { value: quality })}>
                <Slider value={quality} onChange={setQuality} min={40} max={100} />
              </Field>
            )}
            <Field label={t("Taille de la fenêtre")}>
              <Select value={viewport} onChange={setViewport} options={VIEWPORTS.map((v) => ({ value: v.value, label: v.label }))} aria-label={t("Taille de la fenêtre")} />
            </Field>
            <CheckOption checked={fullPage} onChange={setFullPage} label={t("Page entière")} hint={t("Sinon, seule la partie visible dans la fenêtre. Plafonnée à 20 000 pixels de haut.")} />
          </>
        )}
        {variant === "mhtml" && (
          <p className="ft-meta sm:col-span-full">
            {t("La page et ses ressources (images, styles) sont réunies dans un seul fichier MHTML, que Chrome et Edge ouvrent hors connexion.")}
          </p>
        )}
        <Field label={t("Délai maximal ({value} s)", { value: timeout })} hint={t("Au-delà, la capture est abandonnée.")}>
          <NumberInput value={timeout} min={10} max={300} onChange={(e) => setTimeoutSecs(Math.min(300, Math.max(10, Number(e.target.value) || 60)))} />
        </Field>
        {browsers && browsers.length > 1 && (
          <Field label={t("Navigateur")}>
            <Select
              value={browserPath}
              onChange={setBrowserPath}
              options={browsers.map((b) => ({ value: b.path, label: `${tx(BROWSER_NAMES[b.family])}${b.version ? ` ${b.version}` : ""}` }))}
              aria-label={t("Navigateur")}
            />
          </Field>
        )}
      </Fieldset>

      <RunBar
        label={variant === "pdf" ? t("Créer le PDF…") : variant === "image" ? t("Capturer…") : t("Enregistrer la page…")}
        icon={variant === "pdf" ? "Printer" : variant === "image" ? "Camera" : "FileDown"}
        onRun={run}
        running={busy}
        progress={{ ratio: undefined, label: t("Chargement de la page…") }}
        disabled={!looksLikeWebUrl(url) || noBrowser || browsers === null}
        cancel={action.job.cancel}
        status={action.job.status}
        error={action.error}
      />

      {result && (
        <SavedFile path={result.path} bytes={result.bytes}>
          <span className="mt-1 block text-[11px] text-[var(--ft-text-muted)]">
            {t("Page chargée : {url}", { url: result.finalUrl })}
            {result.httpStatus && result.httpStatus >= 400 ? ` — ${t("le serveur a répondu HTTP {code}", { code: result.httpStatus })}` : ""}
            {result.width && result.height ? ` — ${result.width} × ${result.height} px` : ""}
          </span>
        </SavedFile>
      )}
    </div>
  );
}

function make(variant: CaptureVariant) {
  return function WebCaptureTool(_props: ToolComponentProps) {
    return (
      <NativeGate>
        <WebCapturePanel variant={variant} />
      </NativeGate>
    );
  };
}

export const WebToPdfTool = make("pdf");
export const WebToImageTool = make("image");
export const WebSaveOfflineTool = make("mhtml");
