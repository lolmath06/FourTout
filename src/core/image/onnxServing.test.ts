/**
 * Le runtime ONNX est-il **servi** correctement ?
 *
 * `onnxAssets.test.ts` vérifie que les fichiers sont là. Celui-ci vérifie ce
 * qui a réellement cassé : ce qu'un client reçoit quand il les demande.
 *
 * La panne d'origine ne venait pas d'un fichier corrompu mais d'un fichier
 * **absent** : la requête tombait sur le repli SPA, qui répondait `index.html`
 * avec le type `text/html`. ONNX Runtime affichait alors « 'text/html' is not
 * a valid JavaScript MIME type », puis « no available backend found » — sans
 * jamais nommer le fichier manquant.
 *
 * On monte donc un serveur sur le build de production, avec le même repli SPA
 * que l'application, et on regarde le type de contenu reçu. Un test qui
 * lirait le disque directement ne verrait pas ce repli, et laisserait passer
 * exactement le défaut qu'il est censé attraper.
 */
import { createServer, type Server } from "node:http";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ENGINE_TIMEOUT } from "@/test/timeouts";
import { ORT_RUNTIME_FILES } from "./segmentation";

/** Le modèle installé par le gestionnaire de modèles, s'il est présent. */
function findSegmentationModel(): string | undefined {
  return [
    process.env.FOURTOUT_SEG_MODEL,
    join(homedir(), ".local/share/app.fourtout.desktop/models/segmentation/u2netp.onnx"),
    join(homedir(), ".cache/ft-models/u2netp.onnx"),
  ]
    .filter((path): path is string => Boolean(path))
    .find((path) => existsSync(path));
}

const DIST = join(process.cwd(), "dist");
const BUILT = existsSync(join(DIST, "index.html"));

if (!BUILT) {
  console.warn("dist/ absent : lancez `pnpm build` — tests de service ONNX ignorés");
}

/** Types renvoyés par le serveur, alignés sur ceux de Tauri. */
const MIME: Record<string, string> = {
  ".mjs": "text/javascript",
  ".js": "text/javascript",
  ".wasm": "application/wasm",
  ".html": "text/html",
  ".json": "application/json",
  ".css": "text/css",
};

let server: Server;
let origin = "";

beforeAll(async () => {
  if (!BUILT) return;
  server = createServer((request, response) => {
    // `normalize` neutralise les `..` : on ne sert rien hors de `dist/`.
    const path = normalize(decodeURIComponent(new URL(request.url ?? "/", "http://x").pathname));
    const file = join(DIST, path);

    if (file.startsWith(DIST) && existsSync(file) && statSync(file).isFile()) {
      response.writeHead(200, {
        "content-type": MIME[extname(file)] ?? "application/octet-stream",
      });
      createReadStream(file).pipe(response);
      return;
    }
    // Repli SPA : c'est lui qui transformait un fichier manquant en page HTML,
    // et donc une panne claire en énigme.
    response.writeHead(200, { "content-type": "text/html" });
    createReadStream(join(DIST, "index.html")).pipe(response);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  origin = typeof address === "object" && address ? `http://127.0.0.1:${address.port}` : "";
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe.skipIf(!BUILT)("service du runtime ONNX depuis le build", () => {
  it("sert la glu JavaScript comme du JavaScript, pas comme une page", async () => {
    const response = await fetch(`${origin}/ort/ort-wasm-simd-threaded.mjs`);
    expect(response.status).toBe(200);

    const type = response.headers.get("content-type") ?? "";
    // Le cœur de la régression : `text/html` ici, et le moteur refuse de
    // démarrer avec un message qui ne dit pas pourquoi.
    expect(type).not.toContain("text/html");
    expect(type).toContain("javascript");

    const body = await response.text();
    expect(body.trimStart().startsWith("<")).toBe(false);
    expect(body).toMatch(/export/);
  });

  it("sert le binaire WebAssembly avec son en-tête", async () => {
    const response = await fetch(`${origin}/ort/ort-wasm-simd-threaded.wasm`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("wasm");

    const head = new Uint8Array(await response.arrayBuffer()).subarray(0, 8);
    expect(Array.from(head)).toEqual([0x00, 0x61, 0x73, 0x6d, 1, 0, 0, 0]);
  });

  it("montre que le repli SPA répond bien du HTML pour un fichier absent", async () => {
    // Preuve que le serveur reproduit le piège : sans cette bascule, les deux
    // tests ci-dessus passeraient même en cas de régression.
    const response = await fetch(`${origin}/ort/fichier-inexistant.mjs`);
    expect(response.headers.get("content-type")).toContain("text/html");
  });

  it(
    "démarre réellement le moteur sur les fichiers copiés",
    async () => {
      const model = findSegmentationModel();
      if (!model) {
        console.warn(
          "modèle de détourage absent : installez « Détourage — Rapide » dans " +
            "Paramètres → Modèles — démarrage réel du moteur non vérifié",
        );
        return;
      }

      const ort = await import("onnxruntime-web/wasm");
      ort.env.wasm.numThreads = 1;
      ort.env.logLevel = "error";

      // Les fichiers visés sont ceux de `public/ort/`, ceux-là mêmes que le
      // build recopie et que la WebView ira chercher — et non ceux que Node
      // résoudrait tout seul depuis `node_modules`.
      //
      // Ils sont désignés par des URL `file:` : le chargeur ESM de Node refuse
      // le schéma `http:`, que seuls un navigateur et la WebView savent
      // charger. Le service HTTP est donc éprouvé par les trois tests
      // ci-dessus, et le couple de fichiers par celui-ci.
      const served = join(process.cwd(), "public", "ort");
      ort.env.wasm.wasmPaths = {
        mjs: pathToFileURL(join(served, ORT_RUNTIME_FILES[0])).href,
        wasm: pathToFileURL(join(served, ORT_RUNTIME_FILES[1])).href,
      };

      // Une glu et un binaire dépareillés — ou une glu qui serait en fait une
      // page HTML — échoueraient ici sur « no available backend found », le
      // message exact de la panne d'origine.
      //
      // Le modèle est passé en octets, comme dans l'application : `readAssetFile`
      // rend un `Uint8Array`, et ce build du runtime interpréterait une chaîne
      // comme une URL.
      const session = await ort.InferenceSession.create(new Uint8Array(readFileSync(model)), {
        executionProviders: ["wasm"],
      });
      expect(session.inputNames.length).toBeGreaterThan(0);
      expect(session.outputNames.length).toBeGreaterThan(0);
    },
    ENGINE_TIMEOUT,
  );
});
