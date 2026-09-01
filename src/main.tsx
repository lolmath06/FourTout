import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import { applyTheme, useSettings } from "./features/settings/store";
import "./styles/app.css";

// Applique le thème avant le premier rendu pour éviter tout clignotement.
applyTheme(useSettings.getState().theme);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
