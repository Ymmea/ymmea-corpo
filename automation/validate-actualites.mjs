/**
 * Garde-fou deterministe avant publication des actualites LinkedIn.
 *
 * Lancement : node automation/validate-actualites.mjs
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataPath = path.resolve(__dirname, "..", "public", "data", "actualites.json");

const errors = [];
const warn = [];

if (!fs.existsSync(dataPath)) {
  console.error(`[validate-actualites] Fichier introuvable : ${dataPath}`);
  process.exit(3);
}

let data;
try {
  data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
} catch (err) {
  console.error(`[validate-actualites] JSON invalide : ${err.message}`);
  process.exit(2);
}

if (!data || typeof data !== "object") {
  errors.push("La racine doit etre un objet JSON.");
}

if (!data.updatedAt || Number.isNaN(Date.parse(data.updatedAt))) {
  errors.push("updatedAt manquant ou invalide.");
}

if (data.source !== "linkedin") {
  warn.push(`source inattendue : ${data.source}`);
}

if (!Array.isArray(data.posts) || data.posts.length < 1) {
  errors.push("Attendu au moins 1 post dans posts[].");
} else {
  data.posts.forEach((post, i) => {
    const n = i + 1;
    if (!post || typeof post !== "object") {
      errors.push(`Post #${n} invalide.`);
      return;
    }
    if (!post.id) errors.push(`Post #${n} : id manquant.`);
    if (!post.url) errors.push(`Post #${n} : url manquante.`);
    if (!post.text || String(post.text).trim().length < 10) {
      errors.push(`Post #${n} : texte trop court ou manquant.`);
    }
    if (!post.publishedAt || Number.isNaN(Date.parse(post.publishedAt))) {
      errors.push(`Post #${n} : publishedAt manquant ou invalide.`);
    }
    if (post.media != null && !Array.isArray(post.media)) {
      errors.push(`Post #${n} : media doit etre un tableau.`);
    }
    if (Array.isArray(post.media)) {
      post.media.forEach((m, j) => {
        if (!m || typeof m !== "object") {
          errors.push(`Post #${n} media #${j + 1} invalide.`);
          return;
        }
        if (!["image", "video"].includes(m.type)) {
          errors.push(`Post #${n} media #${j + 1} : type invalide (${m.type}).`);
        }
        if (!m.url && !m.embedUrl && !m.thumbnail) {
          errors.push(`Post #${n} media #${j + 1} : url/embed/thumbnail manquant.`);
        }
      });
    }
  });
}

if (data.posts && data.posts.length > 50) {
  warn.push(`Beaucoup de posts (${data.posts.length}) — verifier le flux.`);
}

warn.forEach((w) => console.warn(`[validate-actualites] WARN ${w}`));

if (errors.length) {
  console.error("[validate-actualites] Echec :");
  errors.forEach((e) => console.error(`  - ${e}`));
  process.exit(1);
}

console.log(
  `[validate-actualites] OK — ${data.posts.length} post(s), updatedAt=${data.updatedAt}`
);
process.exit(0);
