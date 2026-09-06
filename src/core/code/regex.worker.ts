/**
 * Exécution des expressions régulières, hors du fil principal.
 *
 * Le moteur d'expressions régulières de JavaScript n'est pas interruptible :
 * un motif à retour sur trace catastrophique (`(a+)+$` sur « aaaa…b ») occupe
 * le processeur pendant des secondes, et aucun budget de temps mesuré *entre*
 * deux appels ne peut l'arrêter. Trente et un caractères suffisent à bloquer
 * quatre secondes.
 *
 * La seule protection réelle est donc d'exécuter le motif ailleurs et de
 * pouvoir tuer ce fil : c'est le rôle de ce worker. Le fil principal reste
 * libre, et `terminate()` interrompt vraiment le calcul.
 */
import { replaceAll, runRegex } from "./regex";

export interface RegexWorkerRequest {
  id: number;
  pattern: string;
  flags: string;
  subject: string;
  /** Présent uniquement pour un remplacement. */
  replacement?: string;
}

export type RegexWorkerResponse =
  | { id: number; ok: true; run?: ReturnType<typeof runRegex>; replaced?: string }
  | { id: number; ok: false; message: string };

self.onmessage = (event: MessageEvent<RegexWorkerRequest>) => {
  const { id, pattern, flags, subject, replacement } = event.data;
  try {
    const response: RegexWorkerResponse =
      replacement === undefined
        ? { id, ok: true, run: runRegex(pattern, flags, subject) }
        : { id, ok: true, replaced: replaceAll(pattern, flags, subject, replacement) };
    self.postMessage(response);
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      message: error instanceof Error ? error.message : "Expression invalide.",
    } satisfies RegexWorkerResponse);
  }
};
