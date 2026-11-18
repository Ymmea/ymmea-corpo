/**
 * Mise a jour hebdomadaire de la FAQ SEO de YMMEA via le Cursor SDK.
 *
 * L'agent reecrit UNIQUEMENT les reponses de la FAQ (entre les marqueurs
 * <!-- FAQ:START --> et <!-- FAQ:END --> dans public/index.html) et synchronise
 * le bloc JSON-LD FAQPage. Le reste du site n'est jamais touche.
 *
 * Lancement : node automation/update-faq.mjs
 * Requiert  : variable d'environnement CURSOR_API_KEY
 */

import { Agent, CursorAgentError } from "@cursor/sdk";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Racine du depot = dossier parent de /automation
const repoRoot = path.resolve(__dirname, "..");

const apiKey = process.env.CURSOR_API_KEY;
if (!apiKey) {
  console.error("[update-faq] CURSOR_API_KEY manquante. Abandon.");
  process.exit(1);
}

const model = process.env.CURSOR_MODEL || "auto";

const prompt = `
Tu es un expert SEO immobilier francais. Tu edites le fichier public/index.html de ce depot.

OBJECTIF
Rafraichir le contenu de la section FAQ pour garder la page vivante aux yeux de Google,
sans jamais casser la structure ni le referencement.

PERIMETRE STRICT (ne touche a RIEN d'autre)
1. Le contenu entre les marqueurs HTML <!-- FAQ:START --> et <!-- FAQ:END -->.
2. Le noeud JSON-LD de type "FAQPage" situe dans le <script type="application/ld+json"> du <head>.

CE QUE TU DOIS FAIRE
- Conserver EXACTEMENT les 4 memes questions (texte des balises <h3 class="faq-item__question">).
  Ne change pas les questions : elles servent d'ancrage SEO stable.
- Reecrire les 4 reponses (<p class="faq-item__answer">) avec un angle neuf cette semaine :
  nouvelle formulation, nouveaux benefices concrets, ton percutant.
- Chaque reponse : 2 a 3 phrases maximum, en francais, orientee promoteurs immobiliers.
- Reutiliser naturellement ces mots-cles (sans bourrage) : VEFA, pilotage commercial, data,
  performance, promoteurs, commercialisation, IA.
- Mettre a jour le JSON-LD FAQPage pour que chaque "acceptedAnswer.text" soit STRICTEMENT
  identique au texte visible de la reponse correspondante (exigence Google pour les rich results).
  Dans le JSON, remplacer l'entite &nbsp; par une espace normale et echapper correctement.

CONTRAINTES SEO / TECHNIQUES
- Ne modifie pas la hierarchie H2 > H3, ni les classes CSS, ni les marqueurs de commentaires.
- Garde exactement 4 blocs <article class="faq-item">.
- Le HTML doit rester valide et le JSON-LD doit rester du JSON valide.
- N'ajoute aucune dependance, ne cree aucun fichier, ne modifie aucun autre fichier.

A la fin, applique les modifications directement dans public/index.html.
`.trim();

console.log(`[update-faq] Demarrage (model=${model}, cwd=${repoRoot})`);

try {
  const result = await Agent.prompt(prompt, {
    apiKey,
    model: { id: model },
    local: {
      cwd: repoRoot,
      // Config inline uniquement : on n'importe pas les reglages ambiants.
      settingSources: [],
    },
  });

  console.log(`[update-faq] run id=${result.id} status=${result.status}`);

  if (result.status === "error") {
    console.error("[update-faq] Le run a demarre mais a echoue.");
    process.exit(2);
  }

  console.log("[update-faq] Termine avec succes.");
  process.exit(0);
} catch (err) {
  if (err instanceof CursorAgentError) {
    console.error(
      `[update-faq] Echec de demarrage : ${err.message} (retryable=${err.isRetryable})`
    );
    process.exit(1);
  }
  throw err;
}
