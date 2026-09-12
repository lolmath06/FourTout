import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type * as RouterModule from "react-router-dom";
import type * as NativeModule from "@/core/files/native";
import { FolderSyncTool } from "./FolderSyncTool";
import { toolRegistry } from "@/core/tools/registry";

/**
 * Le résumé annonçait « 5 à copier » devant une liste de sept lignes, sans
 * rien dire des deux autres. Les deux chiffres comptent des choses
 * différentes — encore faut-il que l'écran le dise.
 */
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof RouterModule>("react-router-dom");
  return { ...actual, useNavigate: () => vi.fn() };
});

const buildSyncPlan = vi.fn();

vi.mock("@/core/files/native", async () => {
  const actual = await vi.importActual<typeof NativeModule>("@/core/files/native");
  return {
    ...actual,
    isFilesEngineAvailable: () => true,
    buildSyncPlan: (request: unknown) => buildSyncPlan(request),
  };
});

vi.mock("@/components/files/PathPicker", () => ({
  PathPicker: ({ label, onChange }: { label: string; onChange: (paths: string[]) => void }) => (
    <button
      type="button"
      data-testid={`picker:${label}`}
      onClick={() => onChange([`/essai/${label.toLowerCase()}`])}
    >
      {label}
    </button>
  ),
}));

/** Le plan réellement produit par la fixture du dépôt : 7 opérations. */
const PLAN = {
  source: "/essai/source",
  destination: "/essai/destination",
  mode: "update" as const,
  operations: [
    { action: "create-directory" as const, relative: "sous-dossier", size: 0, sourceModified: 0, reason: "Dossier absent de la destination." },
    { action: "copy" as const, relative: "accents éàü çñ.txt", size: 30, sourceModified: 0, reason: "Nouveau fichier." },
    { action: "copy" as const, relative: "données.bin", size: 8192, sourceModified: 0, reason: "Nouveau fichier." },
    { action: "copy" as const, relative: "nouveau.txt", size: 34, sourceModified: 0, reason: "Nouveau fichier." },
    { action: "copy" as const, relative: "sous-dossier/imbriqué.txt", size: 23, sourceModified: 0, reason: "Nouveau fichier." },
    { action: "copy" as const, relative: "sous-dossier/nom avec espaces.txt", size: 23, sourceModified: 0, reason: "Nouveau fichier." },
    { action: "replace" as const, relative: "modifie.txt", size: 47, sourceModified: 0, reason: "Taille différente." },
  ],
  directories: 1,
  copies: 5,
  replacements: 1,
  deletions: 0,
  unchanged: 1,
  bytes: 8343,
  freedBytes: 0,
  sourceNotes: { symlinks: [], unreadable: [], files: 7, directories: 1, bytes: 8343 },
  destinationNotes: { symlinks: [], unreadable: [], files: 3, directories: 1, bytes: 0 },
  warnings: [],
};

beforeEach(() => {
  buildSyncPlan.mockReset();
  buildSyncPlan.mockResolvedValue(PLAN);
});

async function plan() {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <FolderSyncTool tool={toolRegistry.get("folder-sync")!} />
    </MemoryRouter>,
  );
  await user.click(screen.getByTestId("picker:Source"));
  await user.click(screen.getByTestId("picker:Destination"));
  await user.click(screen.getByRole("button", { name: /Calculer le plan/i }));
  await screen.findByTestId("sync-plan");
  return user;
}

describe("résumé du plan de synchronisation", () => {
  it("distingue les fichiers copiés du total d'opérations", async () => {
    await plan();

    const total = screen.getByTestId("sync-plan-total");
    // Le total et sa composition, pour que « 5 » devant sept lignes cesse
    // d'être une énigme.
    expect(total).toHaveTextContent("7 opérations");
    expect(total).toHaveTextContent("1 création(s) de dossier");
    expect(total).toHaveTextContent("5 copie(s)");
    expect(total).toHaveTextContent("1 remplacement(s)");

    // Un dossier créé n'est jamais compté comme un fichier copié.
    const grid = screen.getByTestId("stat-grid");
    expect(grid).toHaveTextContent("Fichiers à copier");
    expect(grid).toHaveTextContent("Dossiers à créer");
  });

  it("donne le volume exact, pas seulement un arrondi", async () => {
    await plan();
    // Le séparateur de milliers français est une espace fine insécable, que
    // la comparaison de texte normalise : la regex accepte l'une comme l'autre.
    expect(screen.getByTestId("sync-plan-total")).toHaveTextContent(/8[\s\u202f]343 octets/);
    expect(screen.getByTestId("sync-plan-total")).toHaveTextContent(/8,15 Kio/);
  });

  it("compte autant d'opérations dans la liste que dans le total annoncé", async () => {
    await plan();
    const operations = screen.getByTestId("sync-operations");
    for (const entry of PLAN.operations) {
      expect(operations).toHaveTextContent(entry.relative);
    }
  });
});
