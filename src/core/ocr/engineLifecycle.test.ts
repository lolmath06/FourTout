// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { HEAVY_TIMEOUT } from "@/test/timeouts";
import { isFatalEngineFault, TesseractEngine } from "./engine";
import type { OcrLanguage } from "./types";

/**
 * Cycle de vie du moteur de reconnaissance.
 *
 * Ces essais ne reconnaissent aucun texte : ils vérifient les trois propriétés
 * qui, elles, ne dépendent pas de Tesseract — une reconnaissance à la fois par
 * worker, aucun worker fautif réutilisé, progression adressée au bon travail.
 *
 * Elles se prouvent avec un faux worker, et **seulement** ainsi : provoquer un
 * vrai piège WebAssembly à la demande n'est pas reproductible, alors que la
 * politique qui l'entoure doit l'être. La reconnaissance réelle est éprouvée
 * séparément, dans `ocr.test.ts` et `searchablePdf.test.ts`.
 */

/**
 * Faux tesseract.js, installé une fois pour tout le fichier.
 *
 * `vi.mock` est hissé avant les imports : la fabrique ne peut donc lire que des
 * variables elles-mêmes hissées. Ce détour évite d'avoir à réinitialiser les
 * modules entre chaque essai — une manœuvre dont l'ordre d'exécution s'est
 * révélé dépendant du reste de la suite.
 */
const fake = vi.hoisted(() => ({
  created: [] as string[],
  terminated: [] as string[],
  options: [] as Record<string, unknown>[],
  maxConcurrent: 0,
  running: 0,
  calls: 0,
  workers: 0,
  delayMs: 5,
  onRecognize: undefined as ((call: number, workerIndex: number) => unknown) | undefined,
  createFails: undefined as ((attempt: number) => void) | undefined,
}));

vi.mock("tesseract.js", () => ({
  createWorker: async (langs: string, _oem: number, options: Record<string, unknown>) => {
    fake.workers += 1;
    fake.createFails?.(fake.workers);
    const index = fake.workers - 1;
    fake.created.push(`${langs}#${index}`);
    fake.options.push(options ?? {});
    return {
      async recognize() {
        const call = fake.calls;
        fake.calls += 1;
        fake.running += 1;
        fake.maxConcurrent = Math.max(fake.maxConcurrent, fake.running);
        try {
          // Une vraie reconnaissance cède la main : on reproduit ce point de
          // bascule, faute de quoi le test ne prouverait rien.
          await new Promise((resolve) => setTimeout(resolve, fake.delayMs));
          const outcome = fake.onRecognize?.(call, index);
          if (outcome !== undefined) return outcome;
          return { data: { text: `texte ${call}`, confidence: 90, blocks: null } };
        } finally {
          fake.running -= 1;
        }
      },
      async terminate() {
        fake.terminated.push(`${langs}#${index}`);
      },
    };
  },
}));

/** Remet le faux moteur à zéro et applique le comportement voulu. */
function installFakeTesseract(behaviour: {
  onRecognize?: (call: number, workerIndex: number) => unknown;
  delayMs?: number;
  createFails?: (attempt: number) => void;
} = {}): typeof fake {
  fake.created = [];
  fake.terminated = [];
  fake.options = [];
  fake.maxConcurrent = 0;
  fake.running = 0;
  fake.calls = 0;
  fake.workers = 0;
  fake.delayMs = behaviour.delayMs ?? 5;
  fake.onRecognize = behaviour.onRecognize;
  fake.createFails = behaviour.createFails;
  return fake;
}

const input = (name = "page.png") => ({ name, bytes: new Uint8Array([1, 2, 3]) });

/** Une instance neuve : l'état du moteur vit dans l'objet, pas dans le module. */
function freshEngine(): TesseractEngine {
  return new TesseractEngine({ workerPath: "" });
}

describe("reconnaissance d'un défaut fatal", () => {
  it("reconnaît un piège WebAssembly, y compris transmis en chaîne", () => {
    // tesseract.js sérialise l'erreur de son worker : elle arrive en chaîne.
    expect(
      isFatalEngineFault(
        "RuntimeError: Out of bounds memory access (evaluating '(Tf=b._emscripten_bind_TessBaseAPI_Recognize_1=b.asm.ld).apply(null,arguments)')",
      ),
    ).toBe(true);
    expect(isFatalEngineFault("RuntimeError: Unreachable code should not be executed")).toBe(true);
    expect(isFatalEngineFault("Aborted(). Build with -sASSERTIONS")).toBe(true);
    expect(isFatalEngineFault("Cannot enlarge memory arrays")).toBe(true);
    expect(isFatalEngineFault(new RangeError("table index is out of range"))).toBe(true);
  });

  it("ne confond pas une erreur métier avec un défaut du moteur", () => {
    expect(isFatalEngineFault("Error attempting to read image.")).toBe(false);
    expect(isFatalEngineFault(new Error("Opération annulée"))).toBe(false);
    expect(isFatalEngineFault("Aucun texte n'a été détecté.")).toBe(false);
  });
});

describe("branchement de tesseract.js", { timeout: HEAVY_TIMEOUT }, () => {
  it("fournit un gestionnaire d'erreur, faute de quoi chaque rejet lève en plus une exception globale", async () => {
    // Sans `errorHandler`, tesseract.js exécute `throw Error(data)` dans son
    // propre gestionnaire de messages, hors de toute pile d'appel : un échec
    // pourtant récupérable devient une erreur non interceptée dans la WebView.
    const log = installFakeTesseract({});
    const engine = freshEngine();
    await engine.recognize(input(), "fra");
    expect(typeof log.options[0].errorHandler).toBe("function");
    expect(typeof log.options[0].logger).toBe("function");
  });

  it("sert ses ressources localement, jamais depuis un CDN", async () => {
    const log = installFakeTesseract({});
    const module = await import("./engine");
    // Sans chemins imposés, ce sont ceux servis par l'application.
    const engine = new module.TesseractEngine();
    await engine.recognize(input(), "fra");
    expect(log.options[0].corePath).toBe("/tesseract");
    expect(log.options[0].langPath).toBe("/tessdata");
    expect(log.options[0].workerPath).toBe("/tesseract/worker.min.js");
  });
});

describe("une reconnaissance à la fois par worker", { timeout: HEAVY_TIMEOUT }, () => {
  it("sérialise des appels lancés en parallèle", async () => {
    const log = installFakeTesseract({ delayMs: 8 });
    const engine = freshEngine();

    // Trois reconnaissances lancées sans attendre : c'est ce que produit un
    // double-clic, ou une annulation suivie d'une relance immédiate.
    await Promise.all([
      engine.recognize(input("a.png"), "fra"),
      engine.recognize(input("b.png"), "fra"),
      engine.recognize(input("c.png"), "fra"),
    ]);

    expect(log.maxConcurrent).toBe(1);
    // Un seul worker : la file ne doit pas non plus en multiplier les instances.
    expect(log.created).toEqual(["fra#0"]);
  });

  it("n'entrave pas deux langues différentes", async () => {
    const log = installFakeTesseract({ delayMs: 10 });
    const engine = freshEngine();
    await Promise.all([
      engine.recognize(input(), "fra"),
      engine.recognize(input(), "eng"),
    ]);
    // Deux workers distincts, donc deux moteurs natifs distincts : rien à
    // sérialiser entre eux.
    expect(log.created.sort()).toEqual(["eng#1", "fra#0"].sort());
  });

  it("laisse passer la suite après l'échec de l'une d'elles", async () => {
    installFakeTesseract({
      delayMs: 5,
      onRecognize: (call) => {
        if (call === 0) throw new Error("Error attempting to read image.");
      },
    });
    const engine = freshEngine();

    await expect(engine.recognize(input(), "fra")).rejects.toThrow(/read image/);
    // La file ne doit pas rester bloquée par l'échec précédent.
    const second = await engine.recognize(input(), "fra");
    expect(second.text).toBe("texte 1");
  });

  it("ne démarre pas un travail déjà annulé pendant son attente", async () => {
    const log = installFakeTesseract({ delayMs: 20 });
    const engine = freshEngine();
    const controller = new AbortController();

    const first = engine.recognize(input(), "fra");
    const second = engine.recognize(input(), "fra", { signal: controller.signal });
    controller.abort();

    await first;
    await expect(second).rejects.toThrow(/annul/i);
    // Le travail annulé n'a jamais atteint le moteur.
    expect(log.maxConcurrent).toBe(1);
  });
});

describe("worker fautif", { timeout: HEAVY_TIMEOUT }, () => {
  const fatal = "RuntimeError: Out of bounds memory access";

  it("jette le worker et reprend une fois sur une instance neuve", async () => {
    const log = installFakeTesseract({
      onRecognize: (call) => {
        // Seul le tout premier appel déclenche le piège.
        if (call === 0) throw fatal;
      },
    });
    const engine = freshEngine();

    const result = await engine.recognize(input(), "fra");
    expect(result.text).toBe("texte 1");
    // L'instance fautive est réellement arrêtée, et une neuve créée.
    expect(log.terminated).toEqual(["fra#0"]);
    expect(log.created).toEqual(["fra#0", "fra#1"]);
  });

  it("ne reprend qu'une seule fois", async () => {
    const log = installFakeTesseract({ onRecognize: () => { throw fatal; } });
    const engine = freshEngine();

    await expect(engine.recognize(input(), "fra")).rejects.toMatchObject({
      code: "ocr-unavailable",
    });
    // Deux tentatives, pas davantage : la reprise est bornée.
    expect(log.created).toEqual(["fra#0", "fra#1"]);
    // Et la seconde instance fautive est jetée elle aussi.
    expect(log.terminated).toEqual(["fra#0", "fra#1"]);
  });

  it("laisse le moteur utilisable pour l'opération suivante", async () => {
    // Exigence explicite : après une panne, relancer immédiatement doit
    // fonctionner sans redémarrer l'application.
    const log = installFakeTesseract({
      onRecognize: (call) => {
        if (call <= 1) throw fatal;
      },
    });
    const engine = freshEngine();

    await expect(engine.recognize(input(), "fra")).rejects.toMatchObject({
      code: "ocr-unavailable",
    });
    const after = await engine.recognize(input(), "fra");
    expect(after.text).toBe("texte 2");
    // Aucun worker fautif n'a survécu à sa panne.
    expect(log.created).toEqual(["fra#0", "fra#1", "fra#2"]);
    expect(log.terminated).toEqual(["fra#0", "fra#1"]);
  });

  it("ne jette pas le worker pour une simple erreur métier", async () => {
    const log = installFakeTesseract({
      onRecognize: (call) => {
        if (call === 0) throw new Error("Error attempting to read image.");
      },
    });
    const engine = freshEngine();

    await expect(engine.recognize(input(), "fra")).rejects.toThrow(/read image/);
    expect(log.terminated).toEqual([]);
    expect(log.created).toEqual(["fra#0"]);
  });
});

describe("libération", { timeout: HEAVY_TIMEOUT }, () => {
  it("arrête tous les workers", async () => {
    const log = installFakeTesseract({});
    const engine = freshEngine();
    await engine.recognize(input(), "fra");
    await engine.recognize(input(), "eng");
    await engine.dispose();
    expect(log.terminated.sort()).toEqual(["eng#1", "fra#0"].sort());
  });

  it("ne garde pas en cache un worker qui n'a jamais pu naître", async () => {
    const log = installFakeTesseract({
      createFails: (attempt) => {
        if (attempt === 1) throw new Error("modèle de langue introuvable");
      },
    });
    const engine = freshEngine();

    await expect(engine.recognize(input(), "deu" as OcrLanguage)).rejects.toMatchObject({
      code: "ocr-unavailable",
    });
    // Un second essai doit pouvoir aboutir : l'échec n'est pas mémorisé.
    const result = await engine.recognize(input(), "deu" as OcrLanguage);
    expect(result.text).toBe("texte 0");
    expect(log.created).toEqual(["deu#1"]);
  });
});
