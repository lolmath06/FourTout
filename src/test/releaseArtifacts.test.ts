import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Garde de publication : un artefact ne doit jamais mentir sur sa version.
 *
 * L'étape de rassemblement choisissait auparavant ses fichiers avec
 * `find … | head -1`. Aucun test ne pouvait voir le défaut : tant que le
 * dossier de construction ne contient qu'une version, le premier résultat est
 * le bon. Le jour où il en contient deux, le paquet publié sous le nom de la
 * nouvelle version peut être l'ancien — et rien n'échoue.
 *
 * Ces tests reconstituent exactement cette situation sur un faux dossier de
 * construction, et exercent le script réellement invoqué par le workflow, avec
 * ses codes de sortie.
 */
const SCRIPT = join(process.cwd(), "scripts", "collect-release-artifacts.mjs");

let workspace: string;

/** Un faux paquet : seul son nom compte pour la sélection. */
function bundle(relativePath: string, content = "paquet") {
  const full = join(workspace, relativePath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
  return full;
}

function collect(version: string, os: "Linux" | "Windows") {
  return execFileSync(
    "node",
    [
      SCRIPT,
      "--version", version,
      "--os", os,
      "--bundle-dir", join(workspace, "bundle"),
      "--release-dir", join(workspace, "release"),
      "--out", join(workspace, "artefacts"),
      "--stage", join(workspace, "portable"),
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

/** Rend le message d'erreur du script, et échoue s'il a réussi. */
function collectExpectingFailure(version: string, os: "Linux" | "Windows"): string {
  try {
    collect(version, os);
  } catch (error) {
    const failure = error as { status?: number; stderr?: string };
    expect(failure.status, "le script doit sortir en erreur").not.toBe(0);
    return failure.stderr ?? "";
  }
  throw new Error("la collecte a réussi alors qu'elle devait échouer");
}

function produced(): string[] {
  return readdirSync(join(workspace, "artefacts")).sort();
}

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "fourtout-release-"));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("collecte des paquets d'une publication Linux", () => {
  /** Les trois formats Linux, dans la version demandée. */
  function linuxBundles(version: string) {
    bundle(`bundle/rpm/FourTout-${version}-1.x86_64.rpm`, `rpm ${version}`);
    bundle(`bundle/deb/FourTout_${version}_amd64.deb`, `deb ${version}`);
    bundle(`bundle/appimage/FourTout_${version}_amd64.AppImage`, `appimage ${version}`);
  }

  it("publie les trois formats sous leur nom public", () => {
    linuxBundles("1.0.0");
    collect("1.0.0", "Linux");

    expect(produced()).toEqual([
      "FourTout-1.0.0-Fedora-x86_64.rpm",
      "FourTout-1.0.0-Linux-amd64.deb",
      "FourTout-1.0.0-Linux-x86_64.AppImage",
    ]);
  });

  it("ignore un paquet d'une version antérieure resté sur place", () => {
    // Le cas qui a motivé ce script : une construction précédente a laissé ses
    // paquets dans le même dossier.
    linuxBundles("0.1.0");
    linuxBundles("1.0.0");
    collect("1.0.0", "Linux");

    expect(produced()).toHaveLength(3);
    // Ce qui compte n'est pas le nom du fichier écrit, mais son contenu : c'est
    // là que la sélection se trahirait.
    const written = readdirSync(join(workspace, "artefacts")).map((name) =>
      execFileSync("cat", [join(workspace, "artefacts", name)], { encoding: "utf8" }),
    );
    expect(written.sort()).toEqual(["appimage 1.0.0", "deb 1.0.0", "rpm 1.0.0"]);
  });

  it("échoue plutôt que de publier l'ancienne version quand la nouvelle manque", () => {
    linuxBundles("0.1.0");
    const message = collectExpectingFailure("1.0.0", "Linux");

    expect(message).toContain("aucun paquet en version 1.0.0");
    // L'erreur nomme ce qui a été écarté : le dossier périmé est visible.
    expect(message).toContain("FourTout-0.1.0-1.x86_64.rpm");
    // Rien n'a été écrit : une publication partielle serait pire qu'aucune.
    expect(() => produced()).toThrow();
  });

  it("nomme tous les formats manquants d'un coup", () => {
    bundle("bundle/rpm/FourTout-1.0.0-1.x86_64.rpm");
    const message = collectExpectingFailure("1.0.0", "Linux");

    expect(message).toContain("DEB");
    expect(message).toContain("AppImage");
    expect(message).not.toContain("RPM :");
  });

  it("refuse de trancher entre deux paquets de la même version", () => {
    // Deux candidats légitimes au même format : aucun critère ne permet de
    // choisir, et un choix par ordre de parcours serait arbitraire.
    linuxBundles("1.0.0");
    bundle("bundle/rpm/autre/FourTout-1.0.0-2.x86_64.rpm");
    const message = collectExpectingFailure("1.0.0", "Linux");

    expect(message).toContain("2 paquets portent la version 1.0.0");
  });

  it("ne confond pas une version avec celle qui la prolonge", () => {
    // `1.0.0` ne doit être satisfaite ni par `1.0.0.1`, ni par `11.0.0`.
    bundle("bundle/rpm/FourTout-1.0.0.1-1.x86_64.rpm");
    bundle("bundle/deb/FourTout_11.0.0_amd64.deb");
    bundle("bundle/appimage/FourTout_1.0.0_amd64.AppImage");
    const message = collectExpectingFailure("1.0.0", "Linux");

    expect(message).toContain("RPM");
    expect(message).toContain("DEB");
    expect(message).not.toContain("AppImage :");
  });
});

describe("collecte des paquets d'une publication Windows", () => {
  function windowsBundles(version: string) {
    bundle(`bundle/nsis/FourTout_${version}_x64-setup.exe`, `nsis ${version}`);
    bundle(`bundle/msi/FourTout_${version}_x64_en-US.msi`, `msi ${version}`);
  }

  it("publie l'installeur et le MSI, et prépare la version portable", () => {
    windowsBundles("1.0.0");
    bundle("release/fourtout.exe", "exécutable");
    bundle("release/resources/wordlists/seeds.meta", "graines");
    collect("1.0.0", "Windows");

    expect(produced()).toEqual([
      "FourTout-1.0.0-Windows-x64-Setup.exe",
      "FourTout-1.0.0-Windows-x64.msi",
    ]);
    expect(readdirSync(join(workspace, "portable", "FourTout")).sort()).toEqual([
      "FourTout.exe",
      "resources",
    ]);
  });

  it("ignore l'installeur d'une version antérieure resté sur place", () => {
    windowsBundles("0.1.0");
    windowsBundles("1.0.0");
    bundle("release/fourtout.exe", "exécutable");
    collect("1.0.0", "Windows");

    const setup = execFileSync(
      "cat",
      [join(workspace, "artefacts", "FourTout-1.0.0-Windows-x64-Setup.exe")],
      { encoding: "utf8" },
    );
    expect(setup).toBe("nsis 1.0.0");
  });

  it("échoue quand l'exécutable de la version portable est absent", () => {
    windowsBundles("1.0.0");
    const message = collectExpectingFailure("1.0.0", "Windows");

    expect(message).toContain("Exécutable Windows introuvable");
  });

  it("livre la version portable sans les listes de mots plutôt que d'échouer", () => {
    windowsBundles("1.0.0");
    bundle("release/fourtout.exe", "exécutable");
    const output = collect("1.0.0", "Windows");

    expect(output).toContain("version portable préparée");
    expect(readdirSync(join(workspace, "portable", "FourTout"))).toEqual(["FourTout.exe"]);
  });
});

describe("le workflow de publication emploie cette collecte", () => {
  it("n'y subsiste aucune sélection par ordre de parcours", () => {
    const workflow = execFileSync(
      "cat",
      [join(process.cwd(), ".github", "workflows", "release.yml")],
      { encoding: "utf8" },
    );

    expect(workflow).toContain("scripts/collect-release-artifacts.mjs");
    // `head -1` sur un `find` est précisément ce que ce script remplace.
    expect(workflow).not.toMatch(/find[^\n]*\|\s*head\s+-1/);
  });
});
