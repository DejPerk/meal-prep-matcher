# Meal Prep Recipe Dataset

Structured, machine-readable dataset generated from a personal collection of
7 meal-prep recipe books (Breakfast, Chicken, Red Meat, Fish & Seafood,
Vegetarian, Dessert, and Sides/Snacks/Marinades/Butters).

## What's in here

- **`index.html`** — the web app: a pantry matcher plus a full recipe browser,
  loading data at runtime via `fetch('./recipes.json')` (must be hosted, e.g.
  on GitHub Pages — `fetch()` of a local file doesn't work from `file://`).
- **`recipes.json`** — the full dataset: 356 recipes, each with macros,
  structured ingredients, step-by-step instructions, and a tip.
- **`parser.py`** — the core parsing logic (markdown → structured recipe
  objects, including a heuristic ingredient-name normalizer for pantry
  matching).
- **`build_dataset.py`** — the pipeline entry point: loads all 7 source
  documents, tags each recipe with its category, and writes `recipes.json`.

## App features

- **Pantry Match** — type what you have, get recipes ranked by how much of
  the ingredient list you already own, split into "Ready to make" (100%)
  and "Almost there" (ranked by closeness, with exactly what's missing).
  An "assume basic staples" toggle skips having to type salt/oil/etc. every
  time, but a recipe only qualifies if at least one *real* typed ingredient
  matches — staples alone won't surface something irrelevant.
- **Browse All Recipes** — search by title or ingredient, sort by calories
  or protein, filter by category, or hit "Surprise me" for a random pick.
- **What Can I Eat?** — enter your remaining calories (and optionally a
  minimum protein), and see every recipe that fits — including sides,
  snacks, and desserts, not just full meals.
- **Add a Recipe** — paste recipe text and/or upload a screenshot; Claude
  reads it and fills in title, category, macros (scaled to 4 servings),
  ingredients, instructions, and a tip. Review and edit before adding it to
  your in-browser dataset, then download the updated `recipes.json` to
  commit back to the repo.
- **Ingredient checklists** — check off ingredients as you shop or prep;
  state is saved per-recipe in your browser (`localStorage`).
- Dark-mode aware throughout.

## Setting up "Add a Recipe" (requires Vercel + an Anthropic API key)

GitHub Pages only serves static files — it can't run the code that talks to
Claude on your behalf. The `api/parse-recipe.js` function needs a host that
can execute server-side code and keep your API key private. Vercel's free
tier handles this well and deploys straight from this GitHub repo.

1. Get an API key at [console.anthropic.com](https://console.anthropic.com)
   (this is billed separately from a claude.ai subscription — usage-based,
   typically a fraction of a cent per recipe parsed, but not free).
2. Go to [vercel.com](https://vercel.com), sign up with your GitHub account,
   and import this repository as a new project.
3. In the project's Settings → Environment Variables, add
   `ANTHROPIC_API_KEY` with your key as the value.
4. Deploy. Vercel serves `index.html` at the root and automatically turns
   `api/parse-recipe.js` into a live endpoint at `/api/parse-recipe` — no
   extra configuration needed.
5. Every future `git push` to this repo redeploys automatically.

Note: once this is live on Vercel, that becomes the URL to actually use for
the "Add a Recipe" feature — GitHub Pages can still host the rest of the
site, but only the Vercel deployment can run the API function.

## Pipeline

```
Word doc (.docx)
      │  pandoc
      ▼
Markdown
      │  parser.py
      ▼
recipes.json
```

Each source recipe book follows a consistent structure (title → italic
description → macros table → Ingredients bullets → Instructions numbered
list → optional Tip), which the parser leans on instead of anything
ML-based. To point this at a new document, convert it to markdown with
`pandoc -t markdown input.docx -o output.md` and feed it into
`parse_file()` with the category you want tagged.

## Schema

```json
{
  "id": 1,
  "uid": "chicken-1",
  "title": "Quinoa Salad + Blackened Chicken",
  "category": "chicken",
  "subcategory": null,
  "description": "Mediterranean-style quinoa & chickpea salad topped with blackened chicken breast",
  "macros": { "calories": 460, "protein_g": 42, "carbs_g": 38, "fat_g": 15 },
  "servings": 4,
  "ingredients": [
    { "raw": "1 cup dry tri-color quinoa, rinsed", "name": "dry tri-color quinoa" }
  ],
  "instructions": ["Cook quinoa in chicken broth...", "..."],
  "tip": "Swap chickpeas for white beans if you want a change..."
}
```

- **`category`** is one of: `breakfast`, `chicken`, `red_meat`,
  `fish_seafood`, `vegetarian`, `dessert`, `sides`, `snacks`,
  `marinades_sauces`, `butters`.
- **`macros`** is `null` for marinades and compound butters (they're
  per-recipe condiments, not standalone servings).
- **`ingredients[].raw`** is the original ingredient line as written.
  **`.name`** is a best-effort normalized name (quantities, units, and
  prep words like "diced" or "boneless" stripped out) meant for pantry
  matching — see Known limitations below.

## Dataset stats

| Category | Count |
|---|---|
| Chicken | 124 |
| Red Meat | 83 |
| Dessert | 39 |
| Fish & Seafood | 30 |
| Vegetarian | 24 |
| Marinades & Sauces | 16 |
| Breakfast | 17 |
| Butters | 11 |
| Snacks | 9 |
| Sides | 3 |
| **Total** | **356** |

## Known limitations (a.k.a. good v2 ideas)

- **Ingredient normalization is rule-based, not NLP.** It handles the
  common cases (quantities, units, "diced/chopped/boneless" prep words)
  but won't catch every edge case in 356 recipes' worth of free-text
  ingredients. A v2 could swap this for an LLM call per ingredient line,
  or a proper food-entity recognition model, for much cleaner matching.
- **No ingredient de-duplication/synonyms yet** — "chicken breast" and
  "boneless skinless chicken breast" are currently treated as different
  strings. Worth building a small synonym map (or embedding-based fuzzy
  match) before the pantry matcher goes live.
- **No unit conversion** — quantities are kept as free text, not
  normalized to a common unit, since the matcher only needs "do I have
  this ingredient at all," not amounts (yet).
