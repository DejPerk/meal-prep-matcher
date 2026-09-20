# -*- coding: utf-8 -*-
import json
from parser import parse_file

all_recipes = []

def load(path, category_fn):
    with open(path, encoding='utf-8') as f:
        md = f.read()
    return parse_file(md, category_fn)

all_recipes += load('BREAKFAST_MEAL_PREP_RECIPE_BOOK.md', lambda n: {"category": "breakfast"})
all_recipes += load('CHICKEN_MEAL_PREP_RECIPE_BOOK.md', lambda n: {"category": "chicken"})
all_recipes += load('RED_MEAT_MEAL_PREP_RECIPE_BOOK.md', lambda n: {"category": "red_meat"})
all_recipes += load('FISH_AND_SEAFOOD_MEAL_PREP_RECIPE_BOOK.md', lambda n: {"category": "fish_seafood"})
all_recipes += load('VEGETARIAN_MEAL_PREP_RECIPE_BOOK.md', lambda n: {"category": "vegetarian"})
all_recipes += load('DESSERT_MEAL_PREP_RECIPE_BOOK.md', lambda n: {"category": "dessert"})

def snacks_sides_marinades_cat(n):
    if 280 <= n <= 282:
        return {"category": "sides"}
    elif 283 <= n <= 291:
        return {"category": "snacks"}
    elif 331 <= n <= 346:
        return {"category": "marinades_sauces"}
    elif 347 <= n <= 357:
        return {"category": "butters"}
    return {"category": "unknown"}

all_recipes += load('SNACKS_SIDES_MARINADES.md', snacks_sides_marinades_cat)

# re-key ids to be globally unique across the whole dataset (category + original number)
for r in all_recipes:
    r["uid"] = f"{r['category']}-{r['id']}"

print("Total recipes parsed:", len(all_recipes))
from collections import Counter
cnt = Counter(r["category"] for r in all_recipes)
for cat, n in sorted(cnt.items()):
    print(f"  {cat}: {n}")

missing_macros = [r["uid"] for r in all_recipes if r["macros"] is None and r["category"] not in ("marinades_sauces", "butters")]
print("\nRecipes missing macros (excluding marinades/butters, which never have them):", len(missing_macros))
if missing_macros:
    print(missing_macros[:20])

empty_ingredients = [r["uid"] for r in all_recipes if not r["ingredients"]]
print("Recipes with zero parsed ingredients:", len(empty_ingredients), empty_ingredients[:10])

empty_instructions = [r["uid"] for r in all_recipes if not r["instructions"]]
print("Recipes with zero parsed instructions:", len(empty_instructions), empty_instructions[:10])

with open("recipes.json", "w", encoding="utf-8") as f:
    json.dump(all_recipes, f, indent=2, ensure_ascii=False)

print("\nWrote recipes.json")
