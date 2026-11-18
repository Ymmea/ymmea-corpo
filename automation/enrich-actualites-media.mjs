/**
 * Enrichit public/data/actualites.json avec les images OG LinkedIn (lecture seule).
 * Usage : node automation/enrich-actualites-media.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataPath = path.resolve(__dirname, "..", "public", "data", "actualites.json");

function decode(str) {
  return String(str || "").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
}

function pickMeta(html, prop) {
  const re = new RegExp(
    `property=["']${prop}["']\\s+content=["']([^"']+)["']|content=["']([^"']+)["']\\s+property=["']${prop}["']`,
    "i"
  );
  const m = html.match(re);
  return decode((m && (m[1] || m[2])) || "");
}

function isVideoThumb(url) {
  return /videocover|playlist\/vid|thumbnail-with-play/i.test(url);
}

async function fetchOg(post) {
  const candidates = [];
  if (post.urn) {
    candidates.push(`https://www.linkedin.com/embed/feed/update/${post.urn}`);
    candidates.push(`https://www.linkedin.com/embed/feed/update/${post.urn}?compact=1`);
  }
  if (post.url) candidates.push(post.url);

  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; YMMEA-ActualitesBot/1.0)",
          Accept: "text/html",
        },
        redirect: "follow",
      });
      if (!res.ok) continue;
      const html = await res.text();
      const image = pickMeta(html, "og:image");
      if (!image) continue;
      const type = isVideoThumb(image) ? "video" : "image";
      const media = {
        type,
        url: type === "image" ? image : post.url || image,
        thumbnail: image,
      };
      if (type === "video" && post.urn) {
        media.embedUrl = `https://www.linkedin.com/embed/feed/update/${post.urn}?compact=1`;
      }
      return media;
    } catch {
      // try next candidate
    }
  }
  return null;
}

const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
let enriched = 0;

for (const post of data.posts || []) {
  const hasVisual = Array.isArray(post.media) && post.media.some((m) => m.thumbnail || m.url);
  if (hasVisual) continue;
  const media = await fetchOg(post);
  if (media) {
    post.media = [media];
    enriched += 1;
    console.log(`[enrich] ${post.id} → ${media.type}`);
  } else {
    console.warn(`[enrich] pas d'image pour ${post.id}`);
  }
}

data.updatedAt = new Date().toISOString();
fs.writeFileSync(dataPath, JSON.stringify(data, null, 2) + "\n", "utf8");
console.log(`[enrich] termine — ${enriched} post(s) enrichis`);
