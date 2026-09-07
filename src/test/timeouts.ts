/**
 * Délais des tests qui font autre chose que du JavaScript pur.
 *
 * Le délai par défaut de Vitest — cinq secondes — est taillé pour un test
 * unitaire : appeler une fonction, comparer un résultat. Il ne dit rien de
 * juste sur un test qui lance trois compressions FFmpeg ou qui fait tourner un
 * moteur d'inférence.
 *
 * La machine de développement n'est pas la mesure. Un exécutant GitHub partagé
 * offre quatre cœurs, plus lents, à toute la suite en parallèle : une opération
 * mesurée à deux secondes ici peut en demander quinze là-bas sans que rien ne
 * soit cassé. Un échec au bout de cinq secondes ne signalerait alors qu'une
 * chose — le mauvais délai.
 *
 * Ces valeurs ne sont donc pas des budgets de performance : rien ne les
 * consomme quand tout va bien. Elles bornent l'attente avant de déclarer un
 * blocage. Les tests unitaires ordinaires gardent le délai court par défaut,
 * qui les protège des boucles infinies et des promesses jamais tenues.
 */

/**
 * Test qui exécute de vrais processus natifs — FFmpeg, ffprobe — ou un calcul
 * volontairement coûteux. Mesuré ici : jusqu'à cinq secondes pour la détection
 * des encodeurs, la suite complète tournant en parallèle.
 */
export const HEAVY_TIMEOUT = 60_000;

/**
 * Test qui fait tourner un moteur d'inférence : ONNX Runtime en WebAssembly
 * (détourage), tesseract.js (reconnaissance de texte). Chargement du modèle
 * compris, et sans accélération matérielle sur un exécutant d'intégration.
 */
export const ENGINE_TIMEOUT = 180_000;

/**
 * Test qui monte l'application entière dans jsdom et la pilote comme un
 * utilisateur. Chaque rendu traverse le catalogue réel et des bibliothèques
 * lourdes (formatage de code, analyse de mots de passe).
 */
export const APP_TIMEOUT = 20_000;
