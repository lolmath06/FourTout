import { HashRouter, useRoutes } from "react-router-dom";
import { useEffect } from "react";
import { routes } from "./routes";
import { applyTheme, useSettings } from "@/features/settings/store";
import { startLanguageSync } from "@/features/settings/language";
import { useI18n } from "@/i18n";
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
  const locale = useI18n((state) => state.locale);
  const revision = useI18n((state) => state.revision);

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

  // La langue suit les paramètres, et ceux du système en mode « Système ».
  useEffect(() => startLanguageSync(), []);

  // Changer de langue remonte l'interface : chaque texte est traduit au rendu,
  // y compris ceux que des composants avaient mémorisés. L'URL (fragment) et
  // les données des magasins — favoris, récents, travaux en cours — survivent.
  return (
    <HashRouter key={`${locale}:${revision}`}>
      <Routes />
    </HashRouter>
  );
}
