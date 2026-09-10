/**
 * Socle texte de FourTout : fonctions pures, sans dépendance, sans interface.
 *
 * Les outils Texte n'appellent que ces fonctions ; toute la logique est donc
 * testable sans rendre un seul composant, et réutilisable par le convertisseur
 * universel comme par les outils Fichiers.
 */
export * from "./clean";
export * from "./diff";
export * from "./encoding";
export * from "./errors";
export * from "./extract";
export * from "./html";
export * from "./lines";
export * from "./lorem";
export * from "./markdown";
export * from "./replace";
export * from "./stats";
export * from "./unicode";
export * from "./url";
