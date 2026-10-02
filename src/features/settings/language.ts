import { resolveLanguage, setLocale, type LanguagePreference } from "@/i18n";
import { useSettings } from "./store";

/**
 * Relie la préférence de langue des paramètres à la langue affichée.
 *
 * - au démarrage, avant le premier rendu : pas d'écran qui change de langue
 *   sous les yeux ;
 * - à chaque changement de préférence : immédiat, sans redémarrage ;
 * - en mode « Système », quand la langue du système change.
 */
export function applyLanguagePreference(preference: LanguagePreference): Promise<void> {
  return setLocale(resolveLanguage(preference));
}

export function initLanguage(): Promise<void> {
  return applyLanguagePreference(useSettings.getState().language);
}

export function startLanguageSync(): () => void {
  const unsubscribe = useSettings.subscribe((state, previous) => {
    if (state.language !== previous.language) void applyLanguagePreference(state.language);
  });
  const onSystemChange = () => {
    const preference = useSettings.getState().language;
    if (preference === "system") void applyLanguagePreference(preference);
  };
  if (typeof window !== "undefined") window.addEventListener("languagechange", onSystemChange);
  return () => {
    unsubscribe();
    if (typeof window !== "undefined") window.removeEventListener("languagechange", onSystemChange);
  };
}
