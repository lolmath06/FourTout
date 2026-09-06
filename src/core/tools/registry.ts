import { ALL_TOOLS } from "./catalog";
import { CATEGORIES, listCategories } from "./categories";
import type {
  CategoryDefinition,
  CategoryId,
  DataKind,
  ToolCapability,
  ToolDefinition,
} from "./types";

/**
 * Registre des outils : l'autorité unique sur ce qui existe dans FourTout.
 *
 * Tout le reste de l'application (navigation, recherche, favoris, récents,
 * assistant) interroge ce registre et ne maintient jamais sa propre liste.
 */
export class ToolRegistry {
  private readonly tools: ToolDefinition[];
  private readonly byId: Map<string, ToolDefinition>;
  private readonly byCategory: Map<CategoryId, ToolDefinition[]>;

  constructor(tools: ToolDefinition[], categories: CategoryDefinition[]) {
    const byId = new Map<string, ToolDefinition>();
    const duplicates: string[] = [];
    const knownCategories = new Set(categories.map((c) => c.id));
    const unknownCategories: string[] = [];

    for (const tool of tools) {
      if (byId.has(tool.id)) duplicates.push(tool.id);
      byId.set(tool.id, tool);
      for (const id of [tool.category, ...(tool.alsoIn ?? [])]) {
        if (!knownCategories.has(id)) unknownCategories.push(`${tool.id} → ${id}`);
      }
    }

    // Une erreur ici est une erreur de développement : elle doit être bruyante
    // et attrapée par les tests, pas dégrader silencieusement l'application.
    if (duplicates.length > 0) {
      throw new Error(`Identifiants d'outils dupliqués : ${duplicates.join(", ")}`);
    }
    if (unknownCategories.length > 0) {
      throw new Error(`Catégories inconnues référencées : ${unknownCategories.join(", ")}`);
    }

    this.tools = tools;
    this.byId = byId;
    this.byCategory = new Map(
      categories.map((category) => [
        category.id,
        tools.filter(
          (tool) => tool.category === category.id || tool.alsoIn?.includes(category.id),
        ),
      ]),
    );
  }

  /** Tous les outils, dans l'ordre du catalogue. */
  all(): ToolDefinition[] {
    return this.tools;
  }

  get(id: string): ToolDefinition | undefined {
    return this.byId.get(id);
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  /** Outils d'une catégorie, catégorie principale et secondaires confondues. */
  byCategoryId(id: CategoryId): ToolDefinition[] {
    return this.byCategory.get(id) ?? [];
  }

  categories(): CategoryDefinition[] {
    return listCategories();
  }

  /** Nombre d'outils par catégorie, pour les compteurs de l'interface. */
  countsByCategory(): Record<CategoryId, number> {
    const counts = {} as Record<CategoryId, number>;
    for (const category of this.categories()) {
      counts[category.id] = this.byCategoryId(category.id).length;
    }
    return counts;
  }

  withCapability(capability: ToolCapability): ToolDefinition[] {
    return this.tools.filter((tool) => tool.capabilities.includes(capability));
  }

  /**
   * Outils sachant traiter un type de donnée. Base du futur convertisseur
   * universel et du routage par glisser-déposer.
   */
  acceptingKind(kind: DataKind): ToolDefinition[] {
    return this.tools.filter((tool) =>
      tool.acceptedInputs.some((input) => input.kind === kind),
    );
  }

  /**
   * Outils sachant traiter une extension donnée (sans point, insensible à la
   * casse). `"*"` dans une définition signifie « toute extension de ce type ».
   */
  acceptingExtension(extension: string): ToolDefinition[] {
    const ext = extension.replace(/^\./, "").toLowerCase();
    return this.tools.filter((tool) =>
      tool.acceptedInputs.some(
        (input) => input.extensions.includes("*") || input.extensions.includes(ext),
      ),
    );
  }

  /** Résout une liste d'ids en outils, en ignorant silencieusement les inconnus. */
  resolveMany(ids: readonly string[]): ToolDefinition[] {
    return ids
      .map((id) => this.byId.get(id))
      .filter((tool): tool is ToolDefinition => tool !== undefined);
  }
}

/** Registre par défaut de l'application. */
export const toolRegistry = new ToolRegistry(ALL_TOOLS, CATEGORIES);
