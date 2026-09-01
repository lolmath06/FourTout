import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import { applyTheme, useSettings } from "./features/settings/store";
import { setRasterBackend } from "./core/pdf/raster/types";
import { browserRasterBackend } from "./core/pdf/raster/browser";
import { configurePdfJs } from "./core/pdf/pdfjs";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";
import "./styles/app.css";

// Applique le thème avant le premier rendu pour éviter tout clignotement.
applyTheme(useSettings.getState().theme);

// Rendu bitmap et ressources pdf.js : servis par l'application elle-même,
// jamais par un CDN (voir scripts/sync-pdfjs-assets.mjs).
setRasterBackend(browserRasterBackend);
configurePdfJs({ workerSrc: pdfWorkerUrl });

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
