/**
 * Façade d'exécution du testeur d'expressions régulières.
 *
 * Elle délègue à un worker (voir `regex.worker.ts`) et **tue** ce worker quand
 * le délai est dépassé. C'est la seule interruption réelle disponible : le
 * budget de temps interne à `runRegex` ne peut vérifier l'heure qu'entre deux
 * correspondances, jamais pendant l'appel à `exec` qui part en retour sur
 * trace.
 *
 * Là où aucun worker n'existe — environnement de test, WebView qui refuse le
 * script —, on retombe sur l'exécution directe. La protection est alors celle,
 * partielle, de `runRegex` : c'est dit tel quel plutôt que promis à tort.
 */
import { RegexError, replaceAll, runRegex, type RegexRun } from "./regex";

/** Au-delà, le worker est tué : mieux vaut un message qu'une interface figée. */
export const HARD_TIMEOUT_MS = 2000;

export const TIMEOUT_MESSAGE =
  "Recherche interrompue au bout de 2 secondes : cette expression part en retour " +
  "sur trace catastrophique sur ce texte (des motifs comme « (a+)+ » en sont la " +
  "cause habituelle). Simplifiez l'expression ou réduisez le texte.";

interface Pending {
  resolve: (value: { run?: RegexRun; replaced?: string }) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

let worker: Worker | undefined;
let workerUnavailable = false;
let nextId = 1;
const pending = new Map<number, Pending>();

/** Vrai quand l'exécution passe réellement par un fil séparé, tuable. */
export function isIsolated(): boolean {
  return !workerUnavailable && typeof Worker !== "undefined";
}

function ensureWorker(): Worker | undefined {
  if (workerUnavailable || typeof Worker === "undefined") return undefined;
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./regex.worker.ts", import.meta.url));
    worker.onmessage = (event: MessageEvent) => {
      const data = event.data as { id: number; ok: boolean; message?: string } & Record<
        string,
        unknown
      >;
      const entry = pending.get(data.id);
      if (!entry) return;
      pending.delete(data.id);
      clearTimeout(entry.timer);
      if (data.ok) {
        entry.resolve({ run: data.run as RegexRun | undefined, replaced: data.replaced as string | undefined });
      } else {
        entry.reject(new RegexError(data.message ?? "Expression invalide."));
      }
    };
    worker.onerror = () => kill(new RegexError("Le moteur d'expressions régulières s'est arrêté."));
    return worker;
  } catch {
    // Worker indisponible : on le note une fois pour ne pas réessayer à chaque
    // frappe, et on bascule sur l'exécution directe.
    workerUnavailable = true;
    return undefined;
  }
}

/** Tue le worker et solde toutes les demandes en attente. */
function kill(error: Error) {
  worker?.terminate();
  worker = undefined;
  for (const [, entry] of pending) {
    clearTimeout(entry.timer);
    entry.reject(error);
  }
  pending.clear();
}

function send(
  request: { pattern: string; flags: string; subject: string; replacement?: string },
): Promise<{ run?: RegexRun; replaced?: string }> | undefined {
  const instance = ensureWorker();
  if (!instance) return undefined;
  const id = nextId;
  nextId += 1;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      // Le fil est parti en boucle : le tuer est la seule sortie.
      kill(new RegexError(TIMEOUT_MESSAGE));
      reject(new RegexError(TIMEOUT_MESSAGE));
    }, HARD_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    instance.postMessage({ id, ...request });
  });
}

export async function runRegexIsolated(
  pattern: string,
  flags: string,
  subject: string,
): Promise<RegexRun> {
  const promise = send({ pattern, flags, subject });
  if (!promise) return runRegex(pattern, flags, subject);
  const { run } = await promise;
  return run!;
}

export async function replaceAllIsolated(
  pattern: string,
  flags: string,
  subject: string,
  replacement: string,
): Promise<string> {
  const promise = send({ pattern, flags, subject, replacement });
  if (!promise) return replaceAll(pattern, flags, subject, replacement);
  const { replaced } = await promise;
  return replaced!;
}
