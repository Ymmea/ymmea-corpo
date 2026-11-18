/**
 * Garde-fou deterministe execute APRES l'agent et AVANT tout commit/deploiement.
 *
 * En publication 100% automatique, ce script est le dernier filet de securite :
 * si la FAQ est cassee (structure, nombre de blocs, JSON-LD invalide, desync
 * entre texte visible et donnees structurees), il sort en code != 0 et le
 * workflow s'arrete SANS publier.
 *
 * Lancement : node automation/validate-faq.mjs
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexPath = path.resolve(__dirname, "..", "public", "index.html");

const errors = [];
const warn = [];

if (!fs.existsSync(indexPath)) {
  console.error(`[validate-faq] Fichier introuvable : ${indexPath}`);
  process.exit(3);
}

const html = fs.readFileSync(indexPath, "utf8");

// 1. Marqueurs de maintenance presents
if (!html.includes("<!-- FAQ:START -->")) errors.push("Marqueur <!-- FAQ:START --> manquant.");
if (!html.includes("<!-- FAQ:END -->")) errors.push("Marqueur <!-- FAQ:END --> manquant.");

// 2. Extraction de la section FAQ
const sectionMatch = html.match(/<!-- FAQ:START -->([\s\S]*?)<!-- FAQ:END -->/);
const faqSection = sectionMatch ? sectionMatch[1] : "";
if (!faqSection) errors.push("Impossible d'isoler la section entre FAQ:START et FAQ:END.");

// 3. Un seul H2 dans la section, 4 blocs faq-item, 4 H3, 4 reponses
const h2Count = (faqSection.match(/<h2[\s>]/g) || []).length;
if (h2Count !== 1) errors.push(`Attendu 1 <h2> dans la FAQ, trouve ${h2Count}.`);

const itemCount = (faqSection.match(/class="faq-item[ "]/g) || []).length;
if (itemCount !== 4) errors.push(`Attendu 4 blocs .faq-item, trouve ${itemCount}.`);

const questions = [...faqSection.matchAll(/<h3 class="faq-item__question">([\s\S]*?)<\/h3>/g)].map(
  (m) => cleanText(m[1])
);
if (questions.length !== 4) errors.push(`Attendu 4 questions <h3>, trouve ${questions.length}.`);

const answers = [...faqSection.matchAll(/<p class="faq-item__answer">([\s\S]*?)<\/p>/g)].map((m) =>
  cleanText(m[1])
);
if (answers.length !== 4) errors.push(`Attendu 4 reponses <p>, trouve ${answers.length}.`);

// 4. Reponses non vides et de longueur raisonnable
answers.forEach((a, i) => {
  if (a.length < 40) errors.push(`Reponse #${i + 1} trop courte (${a.length} caracteres).`);
  if (a.length > 600) warn.push(`Reponse #${i + 1} longue (${a.length} caracteres).`);
});

// 5. Presence d'au moins quelques mots-cles SEO sur l'ensemble des reponses
const joined = answers.join(" ").toLowerCase();
const keywords = ["vefa", "commercial", "data", "performance", "promoteur"];
const missing = keywords.filter((k) => !joined.includes(k));
if (missing.length > 2) {
  errors.push(`Mots-cles SEO majoritairement absents : ${missing.join(", ")}.`);
} else if (missing.length > 0) {
  warn.push(`Mots-cles SEO absents : ${missing.join(", ")}.`);
}

// 6. JSON-LD : tous les blocs doivent parser, et le FAQPage doit exister avec 4 questions
const ldBlocks = [
  ...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g),
].map((m) => m[1]);

let faqPage = null;
for (const block of ldBlocks) {
  let parsed;
  try {
    parsed = JSON.parse(block);
  } catch (e) {
    errors.push(`JSON-LD invalide : ${e.message}`);
    continue;
  }
  const nodes = parsed["@graph"] || [parsed];
  for (const node of nodes) {
    if (node && node["@type"] === "FAQPage") faqPage = node;
  }
}

if (!faqPage) {
  errors.push("Aucun noeud JSON-LD FAQPage trouve.");
} else {
  const entities = faqPage.mainEntity || [];
  if (entities.length !== 4) {
    errors.push(`FAQPage : attendu 4 Question, trouve ${entities.length}.`);
  }
  // 7. Synchronisation texte visible <-> donnees structurees
  entities.forEach((q, i) => {
    const ldAnswer = cleanText(q?.acceptedAnswer?.text || "");
    if (!answers.includes(ldAnswer)) {
      errors.push(
        `FAQPage : la reponse structuree #${i + 1} ne correspond a aucune reponse visible (desync SEO).`
      );
    }
  });
}

// --- Rapport ---
warn.forEach((w) => console.warn(`[validate-faq] AVERTISSEMENT : ${w}`));

if (errors.length > 0) {
  console.error("[validate-faq] VALIDATION ECHOUEE :");
  errors.forEach((e) => console.error("  - " + e));
  process.exit(4);
}

console.log("[validate-faq] OK : FAQ valide (4 Q/R, JSON-LD synchronise, mots-cles presents).");
process.exit(0);

/** Normalise un fragment HTML en texte brut comparable. */
function cleanText(s) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
