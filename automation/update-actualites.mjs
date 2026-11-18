/**
 * Mise a jour automatique des actualites LinkedIn YMMEA (lecture seule).
 *
 * Source 100% gratuite : flux RSSHub de la page entreprise
 *   /linkedin/company/ymmea/posts
 * En CI, RSSHub tourne en Docker local (voir daily-actualites-update.yml).
 * Aucun abonnement (RSS.app, widget payant, etc.).
 *
 * Lancement : node automation/update-actualites.mjs
 * Env       : LINKEDIN_RSS_URL (defaut http://127.0.0.1:1200/linkedin/company/ymmea/posts)
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const outPath = path.resolve(repoRoot, "public", "data", "actualites.json");
const companyUrl = "https://www.linkedin.com/company/ymmea/";
const defaultRssUrl = "http://127.0.0.1:1200/linkedin/company/ymmea/posts";

const rssUrl = (process.env.LINKEDIN_RSS_URL || defaultRssUrl).trim();
if (!rssUrl) {
  console.error("[update-actualites] LINKEDIN_RSS_URL vide. Abandon.");
  process.exit(1);
}

function decodeXmlEntities(str) {
  return String(str || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function stripHtml(html) {
  return decodeXmlEntities(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function tagContent(block, tag) {
  const re = new RegExp(
    `<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`,
    "i"
  );
  const m = block.match(re);
  return m ? decodeXmlEntities(m[1].trim()) : "";
}

function attr(tag, name) {
  const re = new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i");
  const m = tag.match(re);
  return m ? decodeXmlEntities(m[1]) : "";
}

function extractImagesFromHtml(html) {
  const urls = [];
  const re = /<img[^>]+src=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    if (m[1] && !urls.includes(m[1])) urls.push(m[1]);
  }
  return urls;
}

function extractMedia(itemXml) {
  const media = [];
  const seen = new Set();

  function push(type, url, extra = {}) {
    if (!url || seen.has(url)) return;
    seen.add(url);
    media.push({ type, url, ...extra });
  }

  const enclosureRe = /<enclosure\b[^>]*>/gi;
  let enc;
  while ((enc = enclosureRe.exec(itemXml))) {
    const tag = enc[0];
    const url = attr(tag, "url");
    const type = (attr(tag, "type") || "").toLowerCase();
    if (type.startsWith("video/") || /\.(mp4|webm|mov)(\?|$)/i.test(url)) {
      push("video", url, { thumbnail: "" });
    } else if (type.startsWith("image/") || url) {
      push("image", url);
    }
  }

  const mediaContentRe = /<media:content\b[^>]*\/?>/gi;
  let mc;
  while ((mc = mediaContentRe.exec(itemXml))) {
    const tag = mc[0];
    const url = attr(tag, "url");
    const medium = (attr(tag, "medium") || "").toLowerCase();
    const type = (attr(tag, "type") || "").toLowerCase();
    if (medium === "video" || type.startsWith("video/")) {
      push("video", url, { thumbnail: "" });
    } else {
      push("image", url);
    }
  }

  const mediaThumbRe = /<media:thumbnail\b[^>]*\/?>/gi;
  let mt;
  while ((mt = mediaThumbRe.exec(itemXml))) {
    const url = attr(mt[0], "url");
    const video = media.find((m) => m.type === "video" && !m.thumbnail);
    if (video && url) video.thumbnail = url;
    else push("image", url);
  }

  const encoded =
    tagContent(itemXml, "content:encoded") ||
    tagContent(itemXml, "description") ||
    "";
  for (const img of extractImagesFromHtml(encoded)) {
    push("image", img);
  }

  return media;
}

function extractUrn(url, title, description) {
  const hay = [url, title, description].join(" ");
  const ugc = hay.match(/urn:li:ugcPost:(\d+)/i);
  if (ugc) return `urn:li:ugcPost:${ugc[1]}`;
  const share = hay.match(/urn:li:share:(\d+)/i);
  if (share) return `urn:li:share:${share[1]}`;
  const activity = hay.match(/urn:li:activity:(\d+)/i);
  if (activity) return `urn:li:activity:${activity[1]}`;
  const activityPath = hay.match(/activity[_-](\d+)/i);
  if (activityPath) return `urn:li:activity:${activityPath[1]}`;
  return "";
}

function postIdFrom(urn, url, index) {
  if (urn) {
    const m = urn.match(/:(\d+)$/);
    if (m) return m[1];
  }
  if (url) {
    const m = url.match(/(\d{10,})/);
    if (m) return m[1];
  }
  return `post-${index + 1}`;
}

function toIsoDate(raw) {
  if (!raw) return new Date().toISOString();
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString();
}

function parseRssItems(xml) {
  const items = [];
  const re = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml))) items.push(m[1]);
  return items;
}

function normalizePost(itemXml, index) {
  const title = stripHtml(tagContent(itemXml, "title"));
  const link =
    tagContent(itemXml, "link") ||
    attr((itemXml.match(/<link\b[^>]*\/?>/i) || [""])[0], "href");
  const pubDate =
    tagContent(itemXml, "pubDate") ||
    tagContent(itemXml, "published") ||
    tagContent(itemXml, "dc:date");
  const rawDesc =
    tagContent(itemXml, "content:encoded") ||
    tagContent(itemXml, "description") ||
    title;
  const text = stripHtml(rawDesc) || title;
  const urn = extractUrn(link, title, rawDesc);
  const media = extractMedia(itemXml);

  if (urn) {
    const embedUrl = `https://www.linkedin.com/embed/feed/update/${urn}?compact=1`;
    for (const item of media) {
      if (item.type === "video" && !item.embedUrl) {
        item.embedUrl = embedUrl;
      }
    }
  }

  return {
    id: postIdFrom(urn, link, index),
    urn: urn || "",
    url: link || companyUrl,
    publishedAt: toIsoDate(pubDate),
    text,
    media,
  };
}

console.log(`[update-actualites] Fetch RSS…`);

const res = await fetch(rssUrl, {
  headers: {
    "User-Agent": "YMMEA-ActualitesBot/1.0 (+https://ymmea.com)",
    Accept: "application/rss+xml, application/xml, text/xml, */*",
  },
});

if (!res.ok) {
  console.error(`[update-actualites] HTTP ${res.status} sur le flux RSS.`);
  process.exit(2);
}

const xml = await res.text();
const items = parseRssItems(xml);

if (!items.length) {
  console.error("[update-actualites] Aucun <item> trouve dans le flux RSS.");
  process.exit(2);
}

const posts = items
  .map((item, i) => normalizePost(item, i))
  .filter((p) => p.text)
  .slice(0, 30);

function pickOg(html, prop) {
  const re = new RegExp(
    `property=["']${prop}["']\\s+content=["']([^"']+)["']|content=["']([^"']+)["']\\s+property=["']${prop}["']`,
    "i"
  );
  const m = html.match(re);
  return decodeXmlEntities((m && (m[1] || m[2])) || "");
}

function isVideoThumb(url) {
  return /videocover|playlist\/vid|thumbnail-with-play/i.test(url);
}

async function enrichMedia(post) {
  const hasVisual =
    Array.isArray(post.media) &&
    post.media.some((m) => m.thumbnail || (m.type === "image" && m.url));
  if (hasVisual) return post;

  const candidates = [];
  if (post.urn) {
    candidates.push(`https://www.linkedin.com/embed/feed/update/${post.urn}`);
    candidates.push(
      `https://www.linkedin.com/embed/feed/update/${post.urn}?compact=1`
    );
  }
  if (post.url) candidates.push(post.url);

  for (const url of candidates) {
    try {
      const r = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; YMMEA-ActualitesBot/1.0)",
          Accept: "text/html",
        },
        redirect: "follow",
      });
      if (!r.ok) continue;
      const html = await r.text();
      const image = pickOg(html, "og:image");
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
      post.media = [media];
      return post;
    } catch {
      // next candidate
    }
  }
  return post;
}

console.log(`[update-actualites] Enrichissement images OG…`);
for (let i = 0; i < posts.length; i++) {
  posts[i] = await enrichMedia(posts[i]);
}

const payload = {
  updatedAt: new Date().toISOString(),
  source: "linkedin",
  companyUrl,
  posts,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + "\n", "utf8");

console.log(
  `[update-actualites] ${posts.length} post(s) ecrits dans ${path.relative(repoRoot, outPath)}`
);
process.exit(0);
