# Automation YMMEA — FAQ SEO + Actualités LinkedIn

Ce dossier contient les scripts qui rafraîchissent automatiquement le contenu
du site, puis publient via un push Git (Vercel redéploie automatiquement).

---

## 1. FAQ SEO (hebdomadaire)

```
GitHub Actions (cron lundi 06:00 UTC)
        │
        ├─ node update-faq.mjs      → l'agent réécrit les 4 réponses FAQ + le JSON-LD FAQPage
        │
        ├─ node validate-faq.mjs    → garde-fou : structure, 4 Q/R, JSON-LD valide & synchronisé
        │                             (si échec → arrêt, rien n'est publié)
        │
        └─ git commit + git push    → Vercel détecte le push et redéploie le site
```

L'agent ne modifie **que** le contenu entre les marqueurs `<!-- FAQ:START -->` et
`<!-- FAQ:END -->` dans `public/index.html`, plus le bloc JSON-LD `FAQPage` du `<head>`.

### Configuration FAQ (une seule fois)

1. Clé API Cursor sur https://cursor.com/dashboard/integrations  
   Secret GitHub : `CURSOR_API_KEY`  
   (Optionnel) variable `CURSOR_MODEL` (ex. `composer-2.5`).
2. `Settings → Actions → General → Workflow permissions` = **Read and write permissions**.

Lancer manuellement : **Actions → Mise a jour FAQ hebdomadaire → Run workflow**.

```bash
cd automation
npm install
export CURSOR_API_KEY="cursor_..."   # PowerShell : $env:CURSOR_API_KEY="cursor_..."
npm run update:faq
npm run validate:faq
```

Workflow : [`../.github/workflows/weekly-faq-update.yml`](../.github/workflows/weekly-faq-update.yml)

---

## 2. Actualités LinkedIn (quotidien, lecture seule, 100 % gratuit)

Affiche les posts de la page [linkedin.com/company/ymmea](https://www.linkedin.com/company/ymmea/)
dans la section `#actualites` du site, aux couleurs YMMEA (pas le widget LinkedIn).

**Aucun service payant** (pas de RSS.app, pas de widget Elfsight/Tagembed, etc.).
Le flux est produit par [RSSHub](https://github.com/DIYgod/RSSHub) lancé en Docker
dans GitHub Actions, puis normalisé vers `public/data/actualites.json`.

```
GitHub Actions (cron quotidien 07:00 UTC)
        │
        ├─ docker run diygod/rsshub:chromium-bundled
        │     → http://127.0.0.1:1200/linkedin/company/ymmea/posts
        │
        ├─ node update-actualites.mjs  → écrit public/data/actualites.json
        │
        ├─ node validate-actualites.mjs → JSON valide, ≥ 1 post, champs requis
        │
        └─ git commit + git push       → Vercel redéploie
```

Aucune écriture sur LinkedIn. Aucun secret obligatoire.

### Configuration Actualités

Rien à payer, rien à créer chez un tiers. Vérifier seulement :

1. `Settings → Actions → General → Workflow permissions` = **Read and write permissions**.
2. Lancer une fois : **Actions → Mise a jour Actualites LinkedIn → Run workflow**.

Le site affiche déjà le seed `public/data/actualites.json` ; le workflow le remplace
dès que RSSHub renvoie les posts publics de la page.

### Test local (optionnel)

```bash
docker run -d --name rsshub -p 1200:1200 diygod/rsshub:chromium-bundled
cd automation
npm run update:actualites
npm run validate:actualites
docker rm -f rsshub
```

(Optionnel) Surcharger l’URL : variable / secret `LINKEDIN_RSS_URL`.

Workflow : [`../.github/workflows/daily-actualites-update.yml`](../.github/workflows/daily-actualites-update.yml)

### Fichiers Actualités

| Fichier | Rôle |
|---------|------|
| `update-actualites.mjs` | Fetch RSSHub → normalise posts → `public/data/actualites.json`. |
| `validate-actualites.mjs` | Validation déterministe avant publication. |
| `../public/data/actualites.json` | Données consommées par le site (rendu client). |

---

## Fichiers communs

| Fichier | Rôle |
|---------|------|
| `package.json` | Scripts npm + dépendance `@cursor/sdk` (FAQ). |
| `update-faq.mjs` / `validate-faq.mjs` | Pipeline FAQ. |

## Modifier les fréquences

Éditer le `cron` dans les workflows (syntaxe : https://crontab.guru). Exemples :
- `0 6 * * 1` → chaque lundi 06:00 UTC (FAQ)
- `0 7 * * *` → chaque jour 07:00 UTC (Actualités)
