import type { OperationContext } from "@/core/pdf/types";
import { JobCancelledError } from "@/core/jobs/types";
import { ImageError } from "@/core/image/errors";
import type {
  OcrEngine,
  OcrInput,
  OcrLanguage,
  OcrLayout,
  OcrResult,
  OcrWord,
  RecognizeRequest,
} from "./types";

/**
 * Moteur OCR reposant sur tesseract.js.
 *
 * Tout est servi localement : le script du worker, le cœur WebAssembly et les
 * modèles de langue proviennent des ressources de l'application
 * (`/tesseract/…`, `/tessdata/…`), jamais d'un CDN. Un worker est créé par
 * combinaison de langues puis réutilisé d'une image à l'autre.
 *
 * Trois propriétés sont tenues ici, et nulle part ailleurs :
 *
 * 1. **Une reconnaissance à la fois par worker.** Un worker porte un unique
 *    `TessBaseAPI` : deux reconnaissances lancées en parallèle partageraient la
 *    même image et le même état natif. Ce moteur est un singleton de module
 *    utilisé par trois outils, et une annulation n'interrompt pas le calcul
 *    déjà lancé — les chevauchements sont donc possibles en usage réel.
 * 2. **Un worker fautif n'est jamais réutilisé.** Un piège WebAssembly laisse
 *    le tas de Tesseract dans un état indéfini ; tout ce qui suivrait sur cette
 *    instance serait faux, ou s'arrêterait à son tour.
 * 3. **La progression va au travail en cours**, et non à celui qui se trouvait
 *    là quand le worker a été créé.
 */

// Emplacements des ressources embarquées (voir scripts/sync-tesseract-assets.mjs).
const CORE_PATH = "/tesseract";
const WORKER_PATH = "/tesseract/worker.min.js";
const LANG_PATH = "/tessdata";

/**
 * Emplacement des ressources de tesseract.js.
 *
 * Dans l'application, ce sont des URL servies par la WebView. Les tests, qui
 * tournent sous Node, ont besoin de chemins de fichiers : les rendre
 * paramétrables permet d'éprouver **cette classe-ci**, celle que l'application
 * utilise réellement, plutôt qu'une copie écrite pour les tests.
 */
export interface TesseractPaths {
  corePath?: string;
  workerPath?: string;
  langPath?: string;
}

/**
 * Forme minimale de ce que l'on consomme dans tesseract.js. `blocks` est la
 * hiérarchie bloc → paragraphe → ligne → mot, chaque niveau portant sa boîte
 * englobante en pixels image.
 */
export interface TesseractBlocks {
  paragraphs?: {
    lines?: {
      words?: { text?: string; confidence?: number; bbox?: { x0: number; y0: number; x1: number; y1: number } }[];
    }[];
  }[];
}

type TesseractWorker = {
  recognize(
    image: Uint8Array | Blob | string,
    options?: unknown,
    output?: Record<string, boolean>,
  ): Promise<{ data: { text: string; confidence: number; blocks?: TesseractBlocks[] | null } }>;
  terminate(): Promise<void>;
};

/**
 * Un worker et son état d'utilisation.
 *
 * `active` porte le contexte de la reconnaissance en cours. Le journal de
 * tesseract.js est branché une fois pour toutes à la création du worker, alors
 * que la progression doit aboutir au travail du moment : sans cette
 * indirection, toutes les reconnaissances suivantes rapporteraient leur
 * avancement au tout premier appel — c'est-à-dire à un travail terminé.
 */
interface WorkerHandle {
  worker: TesseractWorker;
  active?: OperationContext;
}

/**
 * Chargement de tesseract.js, fait une seule fois.
 *
 * La bibliothèque est importée paresseusement — elle pèse lourd et n'a pas à
 * ralentir le démarrage — mais **une seule fois** : deux créations de workers
 * simultanées (deux langues lancées de front) déclencheraient sinon deux
 * imports dynamiques concurrents du même module.
 */
interface TesseractModule {
  createWorker(
    langs: string,
    oem: number,
    options: Record<string, unknown>,
  ): Promise<unknown>;
}

let tesseractModule: Promise<TesseractModule> | undefined;

function loadTesseract(): Promise<TesseractModule> {
  if (!tesseractModule) {
    tesseractModule = import("tesseract.js") as unknown as Promise<TesseractModule>;
    // Un échec de chargement ne doit pas être mémorisé pour toute la session.
    tesseractModule.catch(() => {
      tesseractModule = undefined;
    });
  }
  return tesseractModule;
}

/**
 * Ce défaut-là n'est pas une erreur métier : c'est le moteur WebAssembly qui
 * s'est arrêté net.
 *
 * tesseract.js sérialise l'erreur de son worker avec `toString()` : elle
 * parvient donc **sous forme de chaîne**, jamais d'`Error`. C'est la raison
 * pour laquelle un piège WebAssembly ressemblait jusqu'ici à une erreur
 * ordinaire — et pour laquelle le worker fautif restait en cache.
 */
export function isFatalEngineFault(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return /RuntimeError|out of bounds|memory access|unreachable|table index|null function|Aborted|abort\(|Cannot enlarge memory/i.test(
    message,
  );
}

export class TesseractEngine implements OcrEngine {
  readonly id = "tesseract.js";
  private handles = new Map<OcrLanguage, Promise<WorkerHandle>>();
  /** File d'attente par langue : garantit une reconnaissance à la fois. */
  private queues = new Map<OcrLanguage, Promise<unknown>>();

  constructor(private readonly paths: TesseractPaths = {}) {}

  private handleFor(language: OcrLanguage): Promise<WorkerHandle> {
    let existing = this.handles.get(language);
    if (!existing) {
      existing = this.createHandle(language);
      this.handles.set(language, existing);
      // Un échec de création ne doit pas rester en cache : le prochain appel
      // doit pouvoir retenter, sans quoi une panne passagère condamnerait la
      // langue pour toute la session.
      existing.catch(() => {
        if (this.handles.get(language) === existing) this.handles.delete(language);
      });
    }
    return existing;
  }

  private async createHandle(language: OcrLanguage): Promise<WorkerHandle> {
    const { createWorker } = await loadTesseract();
    const handle: Partial<WorkerHandle> = {};
    const worker = await createWorker(language, 1, {
      corePath: this.paths.corePath ?? CORE_PATH,
      // Sous Node, tesseract.js trouve son worker seul : forcer un chemin de
      // WebView le ferait échouer.
      ...(this.paths.workerPath === undefined
        ? { workerPath: WORKER_PATH }
        : this.paths.workerPath
          ? { workerPath: this.paths.workerPath }
          : {}),
      langPath: this.paths.langPath ?? LANG_PATH,
      gzip: false,
      cacheMethod: "none",
      logger: (message: { status?: string; progress?: number }) => {
        if (message.status === "recognizing text") {
          handle.active?.report?.({ ratio: message.progress, label: "Reconnaissance du texte…" });
        }
      },
      // Sans ce gestionnaire, tesseract.js fait **en plus** un `throw` global à
      // chaque tâche rejetée, alors même que la promesse correspondante est
      // déjà rejetée — et traitée juste en dessous par `recognize`. Cette
      // exception surnuméraire n'apporte aucune information : elle remonte
      // hors de toute pile d'appel, échappe aux `try` de l'application, et
      // transforme un échec récupérable en erreur non interceptée dans la
      // WebView. On l'absorbe donc ici, à la source.
      errorHandler: () => {},
    });
    handle.worker = worker as unknown as TesseractWorker;
    return handle as WorkerHandle;
  }

  /** Arrête et oublie le worker d'une langue. Ne lève jamais. */
  private async discard(language: OcrLanguage): Promise<void> {
    const existing = this.handles.get(language);
    this.handles.delete(language);
    if (!existing) return;
    try {
      const handle = await existing;
      handle.active = undefined;
      await handle.worker.terminate();
    } catch {
      // Un worker déjà mort, ou jamais né, n'a rien à libérer.
    }
  }

  /**
   * Sérialise les traitements d'une même langue.
   *
   * La tâche suivante démarre après la précédente, **qu'elle ait réussi ou
   * échoué** : une annulation ne doit pas laisser une reconnaissance abandonnée
   * tourner en même temps que la nouvelle. C'est ce qui rend « annuler puis
   * relancer aussitôt » sûr, sans la moindre temporisation artificielle.
   */
  private enqueue<T>(language: OcrLanguage, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(language) ?? Promise.resolve();
    const next = previous.then(task, task);
    // La chaîne conservée n'échoue jamais : l'échec d'un travail ne doit pas
    // empoisonner ceux qui le suivent.
    this.queues.set(
      language,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  }

  private async attempt(
    input: OcrInput,
    language: OcrLanguage,
    context: OperationContext | undefined,
    request: RecognizeRequest | undefined,
  ): Promise<OcrResult> {
    let handle: WorkerHandle;
    try {
      handle = await this.handleFor(language);
    } catch (error) {
      throw new ImageError("ocr-unavailable", undefined, { cause: error });
    }

    handle.active = context;
    try {
      // `blocks` n'est demandé que si l'appelant veut les positions : la
      // hiérarchie complète coûte du temps et de la mémoire pour rien sinon.
      const { data } = await handle.worker.recognize(input.bytes, undefined, {
        text: true,
        blocks: Boolean(request?.layout),
      });
      const result = normalizeResult(data.text, data.confidence);
      if (!request?.layout) return result;
      return {
        ...result,
        layout: collectWords(data.blocks ?? undefined, input.width ?? 0, input.height ?? 0),
      };
    } finally {
      if (handle.active === context) handle.active = undefined;
    }
  }

  async recognize(
    input: OcrInput,
    language: OcrLanguage,
    context?: OperationContext,
    request?: RecognizeRequest,
  ): Promise<OcrResult> {
    if (context?.signal?.aborted) throw new JobCancelledError();

    return this.enqueue(language, async () => {
      // L'attente en file peut avoir duré : on revérifie avant de lancer un
      // calcul dont plus personne ne veut.
      if (context?.signal?.aborted) throw new JobCancelledError();

      try {
        return await this.attempt(input, language, context, request);
      } catch (error) {
        if (!isFatalEngineFault(error)) throw error;

        // Le moteur WebAssembly s'est arrêté net : son tas est dans un état
        // indéfini. On le jette — c'est indispensable même sans reprise, sans
        // quoi toutes les opérations suivantes de la session s'exécuteraient
        // sur une instance corrompue.
        await this.discard(language);
        if (context?.signal?.aborted) throw new JobCancelledError();

        // Une seule reprise, sur un worker neuf. Bornée volontairement : si un
        // moteur propre échoue à son tour sur la même image, le défaut vient de
        // l'image ou de la machine, et insister ne ferait que perdre du temps.
        try {
          return await this.attempt(input, language, context, request);
        } catch (retryError) {
          if (isFatalEngineFault(retryError)) await this.discard(language);
          throw new ImageError(
            "ocr-unavailable",
            "Le moteur de reconnaissance s'est interrompu sur cette image, y compris après redémarrage.",
            { cause: retryError },
          );
        }
      }
    });
  }

  async dispose(): Promise<void> {
    const languages = [...this.handles.keys()];
    this.queues.clear();
    await Promise.all(languages.map((language) => this.discard(language)));
  }
}

/**
 * Aplatit la hiérarchie de tesseract en une liste de mots positionnés.
 *
 * Les mots vides ou sans boîte sont écartés : une couche texte ne doit contenir
 * que ce qui a réellement été lu quelque part sur la page.
 */
export function collectWords(
  blocks: TesseractBlocks[] | undefined,
  imageWidth: number,
  imageHeight: number,
): OcrLayout {
  const words: OcrWord[] = [];
  for (const block of blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        for (const word of line.words ?? []) {
          const text = (word.text ?? "").trim();
          const box = word.bbox;
          if (!text || !box) continue;
          if (box.x1 <= box.x0 || box.y1 <= box.y0) continue;
          words.push({ text, confidence: word.confidence ?? 0, box });
        }
      }
    }
  }
  return { imageWidth, imageHeight, words };
}

/** Met en forme un résultat brut de tesseract.js. */
export function normalizeResult(rawText: string, confidence: number): OcrResult {
  const text = rawText.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const words = text.length === 0 ? 0 : text.split(/\s+/).filter(Boolean).length;
  const chars = text.replace(/\s/g, "").length;
  return {
    text,
    confidence: Math.round(Math.max(0, Math.min(100, confidence))),
    words,
    chars,
  };
}
