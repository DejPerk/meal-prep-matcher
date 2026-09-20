# Meal Prep Recipe Dataset

Structured, machine-readable dataset generated from a personal collection of
7 meal-prep recipe books (Breakfast, Chicken, Red Meat, Fish & Seafood,
Vegetarian, Dessert, and Sides/Snacks/Marinades/Butters).

## What's in here

- **`recipes.json`** — the full dataset: 356 recipes, each with macros,
  structured ingredients, step-by-step instructions, and a tip.
- **`parser.py`** — the core parsing logic (markdown → structured recipe
  objects, including a heuristic ingredient-name normalizer for pantry
  matching).
- **`build_dataset.py`** — the pipeline entry point: loads all 7 source
  documents, tags each recipe with its category, and writes `recipes.json`.

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
