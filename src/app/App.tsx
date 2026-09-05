import { HashRouter, useRoutes } from "react-router-dom";
import { useEffect } from "react";
import { routes } from "./routes";
import { applyTheme, useSettings } from "@/features/settings/store";
import { warmMediaCapabilities } from "@/core/media/capabilities";

function Routes() {
  return useRoutes(routes);
}

/**
 * `HashRouter` plutôt que `BrowserRouter` : en application empaquetée, les
 * pages sont servies par un protocole personnalisé sans serveur capable de
 * réécrire les URL. Le routage par fragment fonctionne à l'identique sur
 * Windows et Linux, y compris après un rechargement.
 */
export function App() {
  const theme = useSettings((state) => state.theme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Détecter les encodeurs réellement utilisables demande d'en essayer
  // plusieurs pour de bon : quelques secondes, une fois par session. On lance
  // la détection au démarrage pour qu'elle soit terminée avant que
  // l'utilisateur n'ouvre un outil vidéo.
  useEffect(() => {
    warmMediaCapabilities();
  }, []);

  return (
    <HashRouter>
      <Routes />
    </HashRouter>
  );
}
