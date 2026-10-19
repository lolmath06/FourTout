#!/usr/bin/env node
/**
 * Serveur local pour essayer à la main les outils Internet, sans Internet.
 *
 *   node scripts/serve-web-fixture.mjs        (ou : pnpm fixtures:serve)
 *
 * Écoute sur 127.0.0.1:8765 uniquement. Routes :
 *
 *   /                      page de test (capture web PDF / image / MHTML)
 *   /fichier.bin           5 Mo, avec ETag et reprise par plages (Range)
 *   /sans-reprise.bin      5 Mo, ignore Range : la reprise doit repartir de zéro
 *   /lent.bin              5 Mo servis à ~1 Mo/s : le temps d'essayer « Annuler »
 *   /redirige              302 vers /fichier.bin
 *   /nom                   fichier.bin sous un nom Content-Disposition (accentué)
 *   /absent                404
 *   /__down?bytes=N        octets de test, comme le fait un service de mesure
 *   /__up                  reçoit un POST et répond « ok »
 */
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WEB = join(ROOT, "test-assets", "generated", "web-sample");
const PORT = Number(process.env.PORT ?? 8765);

const file = (name) => readFileSync(join(WEB, name));
const big = file("fichier.bin");
const etag = `"${createHash("sha1").update(big).digest("hex").slice(0, 12)}"`;

createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${PORT}`);
  const send = (status, body, headers = {}) => {
    response.writeHead(status, { "Content-Length": body.length, ...headers });
    response.end(request.method === "HEAD" ? undefined : body);
  };

  switch (url.pathname) {
    case "/":
      return send(200, file("index.html"), { "Content-Type": "text/html; charset=utf-8" });
    case "/style.css":
      return send(200, file("style.css"), { "Content-Type": "text/css" });
    case "/fichier.bin": {
      const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? "");
      if (range && request.headers["if-range"] !== undefined && request.headers["if-range"] !== etag) {
        return send(200, big, { "Accept-Ranges": "bytes", ETag: etag });
      }
      if (range) {
        const start = Number(range[1]);
        const end = range[2] ? Math.min(Number(range[2]), big.length - 1) : big.length - 1;
        if (start >= big.length) return send(416, Buffer.alloc(0), { "Content-Range": `bytes */${big.length}` });
        return send(206, big.subarray(start, end + 1), {
          "Content-Range": `bytes ${start}-${end}/${big.length}`, "Accept-Ranges": "bytes", ETag: etag, "Content-Type": "application/octet-stream",
        });
      }
      return send(200, big, { "Accept-Ranges": "bytes", ETag: etag, "Content-Type": "application/octet-stream" });
    }
    case "/sans-reprise.bin":
      return send(200, big, { ETag: etag, "Content-Type": "application/octet-stream" });
    case "/lent.bin": {
      response.writeHead(200, { "Content-Length": big.length, "Accept-Ranges": "bytes", ETag: etag, "Content-Type": "application/octet-stream" });
      let sent = 0;
      const timer = setInterval(() => {
        if (sent >= big.length || response.destroyed) {
          clearInterval(timer);
          return response.end();
        }
        response.write(big.subarray(sent, sent + 100_000));
        sent += 100_000;
      }, 100);
      request.on("close", () => clearInterval(timer));
      return;
    }
    case "/redirige":
      return send(302, Buffer.alloc(0), { Location: "/fichier.bin" });
    case "/nom":
      return send(200, big.subarray(0, 100_000), {
        "Content-Disposition": "attachment; filename*=UTF-8''Rapport%20%C3%A9t%C3%A9%202026.bin", "Content-Type": "application/octet-stream",
      });
    case "/__down": {
      const bytes = Math.min(Number(url.searchParams.get("bytes") ?? 0), 100_000_000);
      return send(200, Buffer.alloc(bytes, 1), { "Content-Type": "application/octet-stream", "cf-meta-city": "Localhost" });
    }
    case "/__up": {
      request.resume();
      request.on("end", () => send(200, Buffer.from("ok")));
      return;
    }
    default:
      return send(404, Buffer.from("introuvable"), { "Content-Type": "text/plain" });
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log(`Serveur de test : http://127.0.0.1:${PORT}/  (Ctrl+C pour arrêter)`);
});
