import { HashRouter, useRoutes } from "react-router-dom";
import { useEffect } from "react";
import { routes } from "./routes";
import { applyTheme, useSettings } from "@/features/settings/store";

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

  return (
    <HashRouter>
      <Routes />
    </HashRouter>
  );
}
