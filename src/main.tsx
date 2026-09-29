import React from "react";
import ReactDOM from "react-dom/client";
import { installPolyfills } from "./core/platform/polyfills";
import { App } from "./app/App";
import { applyTheme, useSettings } from "./features/settings/store";
import { setRasterBackend } from "./core/pdf/raster/types";
import { browserRasterBackend } from "./core/pdf/raster/browser";
import { configurePdfJs } from "./core/pdf/pdfjs";
import { installRecoveryShutdownGuard } from "./features/jobs/recovery";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";
import "./styles/app.css";

// Comble les API manquantes de la WebView (WebKitGTK) avant tout usage de
// pdf.js, qui est chargé paresseusement — donc toujours après cette ligne.
installPolyfills();

// Applique le thème avant le premier rendu pour éviter tout clignotement.
applyTheme(useSettings.getState().theme);

// Rendu bitmap et ressources pdf.js : servis par l'application elle-même,
// jamais par un CDN (voir scripts/sync-pdfjs-assets.mjs).
setRasterBackend(browserRasterBackend);
configurePdfJs({ workerSrc: pdfWorkerUrl });

// Un vrai rechargement / une fermeture ne doit pas laisser un calcul natif
// tourner sans interface pour le suivre : on l'arrête proprement. La navigation
// interne (SPA), elle, ne déclenche pas cet événement et laisse le job vivre.
installRecoveryShutdownGuard();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
