/**
 * Polyfills ciblés pour la WebView.
 *
 * FourTout tourne dans la WebView du système : WebKitGTK sous Linux, WebView2
 * sous Windows. WebKitGTK 2.46 (Fedora 39) n'implémente pas encore
 * l'itération asynchrone des `ReadableStream`
 * (`ReadableStream.prototype[Symbol.asyncIterator]`, arrivée dans WebKit 18.4).
 *
 * Or pdf.js 6 en a besoin : `getTextContent()` fait `for await (… of stream)`.
 * Sans ce polyfill, l'extraction de texte échoue sur Fedora avec
 * « undefined is not a function ». Le rendu des pages n'est pas concerné (il
 * n'itère pas de flux), d'où le fait que « PDF → images » fonctionnait déjà.
 *
 * Le polyfill est **conforme à la spécification** et **gardé par détection** :
 * il n'a aucun effet là où l'API existe déjà (Chromium/WebView2, WebKit récent).
 *
 * À importer avant tout code utilisant pdf.js.
 */

function installReadableStreamAsyncIterator(): void {
  if (typeof ReadableStream === "undefined") return;

  const proto = ReadableStream.prototype as ReadableStream & {
    [Symbol.asyncIterator]?: unknown;
    values?: unknown;
  };
  if (typeof proto[Symbol.asyncIterator] === "function") return;

  // Implémentation de référence : on lit le stream via son reader, on relâche
  // le verrou à la fin, et on annule la source si l'itération est interrompue.
  async function* iterate(
    this: ReadableStream,
    options?: { preventCancel?: boolean },
  ): AsyncGenerator<unknown> {
    const reader = this.getReader();
    const preventCancel = options?.preventCancel ?? false;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      if (!preventCancel) {
        // Annule la source si on sort avant la fin (break/erreur).
        reader.cancel().catch(() => {});
      }
      reader.releaseLock();
    }
  }

  Object.defineProperty(proto, Symbol.asyncIterator, {
    value: iterate,
    writable: true,
    configurable: true,
  });
  if (typeof proto.values !== "function") {
    Object.defineProperty(proto, "values", {
      value: iterate,
      writable: true,
      configurable: true,
    });
  }
}

/** Installe les polyfills nécessaires à l'environnement courant. */
export function installPolyfills(): void {
  installReadableStreamAsyncIterator();
}
