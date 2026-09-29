import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Recherche d'un exécutable du système, côté scripts de fixtures.
 *
 * Le helper interrogeait `sh -c 'command -v X'` sur toutes les plateformes.
 * Sur un exécuteur Windows, le shell de Git **répond** — mais il répond une
 * route MSYS, « /c/ProgramData/Chocolatey/bin/ffmpeg », que Node ne sait pas
 * lancer. `spawnSync` rendait alors ENOENT : FFmpeg n'était pas absent, il
 * était introuvable *pour Node*, et le garde « moteur absent → on saute les
 * fixtures » ne se déclenchait jamais. `pnpm test:assets` s'interrompait, et
 * le travail Natif (windows-2022) échouait avec un moteur pourtant installé.
 *
 * Faute d'exécuteur Windows sous la main, la branche `win32` est éprouvée dans
 * un Node enfant où l'on déguise la plateforme et où l'on remplace `spawnSync`
 * par un carnet : on observe alors la commande réellement choisie.
 */
const MODULE = join(process.cwd(), "scripts", "lib", "which.mjs");

interface Observed {
  found: string | null;
  calls: [string, string[]][];
}

/**
 * Lance le helper sous une plateforme déguisée. `reply` est ce que `spawnSync`
 * est censé rendre ; le carnet retient ce qu'on lui a demandé de lancer.
 *
 * Le remplacement passe par `require('child_process')` avant l'import ESM :
 * la façade du module natif lit les propriétés au moment de la liaison.
 */
function lookup(platform: string, name: string, reply: { status?: number; stdout?: string }): Observed {
  const script = `
    const cp = require('child_process');
    const calls = [];
    cp.spawnSync = (command, args) => {
      calls.push([command, args]);
      return ${JSON.stringify({ status: reply.status ?? 0, stdout: reply.stdout ?? "" })};
    };
    Object.defineProperty(process, 'platform', { value: ${JSON.stringify(platform)} });
    import(${JSON.stringify("file://" + MODULE)}).then((module) => {
      process.stdout.write(JSON.stringify({ found: module.which(${JSON.stringify(name)}), calls }));
    });
  `;
  return JSON.parse(execFileSync(process.execPath, ["-e", script]).toString()) as Observed;
}

describe("recherche d'un exécutable, par plateforme", () => {
  it("sous Windows, interroge `where` — et jamais le shell MSYS", () => {
    const observed = lookup("win32", "ffmpeg", {
      stdout: "C:\\ProgramData\\Chocolatey\\bin\\ffmpeg.exe\r\n",
    });

    expect(observed.found).toBe("C:\\ProgramData\\Chocolatey\\bin\\ffmpeg.exe");
    expect(observed.calls).toEqual([["where", ["ffmpeg"]]]);
    // Le défaut corrigé : `sh` aurait rendu une route « /c/... » injouable.
    expect(observed.calls[0][0]).not.toBe("sh");
  });

  it("sous Windows, retient la première route quand `where` en donne plusieurs", () => {
    const observed = lookup("win32", "ffmpeg", {
      stdout: "C:\\outils\\ffmpeg.exe\r\nC:\\autre\\ffmpeg.exe\r\n",
    });

    expect(observed.found).toBe("C:\\outils\\ffmpeg.exe");
  });

  it("ailleurs, conserve `command -v`", () => {
    const observed = lookup("linux", "ffmpeg", { stdout: "/usr/bin/ffmpeg\n" });

    expect(observed.found).toBe("/usr/bin/ffmpeg");
    expect(observed.calls).toEqual([["sh", ["-c", "command -v ffmpeg"]]]);
  });

  it("rend null — et non une chaîne vide — quand l'exécutable manque", () => {
    for (const platform of ["win32", "linux"]) {
      expect(lookup(platform, "absent", { status: 1 }).found).toBeNull();
      // Sortie vide mais code 0 : `where` se tait parfois.
      expect(lookup(platform, "absent", { status: 0, stdout: "\r\n" }).found).toBeNull();
    }
  });
});

describe("sur cette machine, pour de vrai", () => {
  /**
   * Le point qui comptait : la route rendue doit être **directement lançable**.
   * On la fait donc chercher par un Node neuf, hors de toute simulation, puis
   * on exécute ce qu'il a trouvé.
   */
  function realLookup(name: string): string {
    const script = `import { which } from ${JSON.stringify("file://" + MODULE)};
      process.stdout.write(String(which(${JSON.stringify(name)})));`;
    return execFileSync(process.execPath, ["--input-type=module", "-e", script]).toString().trim();
  }

  it("trouve un exécutable réel, et cette route se lance telle quelle", () => {
    const found = realLookup("node");

    expect(found).not.toBe("");
    expect(found).not.toBe("null");
    expect(execFileSync(found, ["-e", "process.stdout.write('vivant')"]).toString()).toBe("vivant");
  });

  it("rend null pour un exécutable qui n'existe pas", () => {
    expect(realLookup("outil-qui-nexiste-pas-42")).toBe("null");
  });
});
