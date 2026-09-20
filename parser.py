# -*- coding: utf-8 -*-
import re, json, os

def clean_wrapped(text):
    """Join markdown line-wrap continuations ('> ' prefixed lines) back into flowing text."""
    lines = text.split('\n')
    out = []
    for line in lines:
        line = line.strip()
        if line.startswith('>'):
            line = line.lstrip('>').strip()
            if out:
                out[-1] = out[-1] + ' ' + line
                continue
        if line:
            out.append(line)
    return ' '.join(out)

def strip_md(text):
    text = text.replace('\\.', '.').replace('\\-', '-')
    text = re.sub(r'\*\*(.+?)\*\*', r'\1', text)
    text = re.sub(r'\*(.+?)\*', r'\1', text)
    text = text.replace('---', '\u2014')
    text = text.replace('\\', '')
    return text.strip()

DESCRIPTOR_WORDS = {
    'boneless', 'skinless', 'bone-in', 'skin-on', 'lean', 'extra-lean', 'extra lean',
    'low-fat', 'low fat', 'fat-free', 'fat free', 'nonfat', 'non-fat', 'unsalted', 'salted',
    'fresh', 'frozen', 'canned', 'ripe', 'large', 'small', 'medium', 'jumbo',
    'room temperature', 'softened', 'melted', 'plain', 'reduced-fat', 'reduced fat',
}

def normalize_ingredient_name(raw):
    """Best-effort extraction of a matchable ingredient name from a free-text line."""
    s = raw.lower()
    s = re.sub(r'\([^)]*\)', '', s)  # drop parenthetical notes

    UNIT_WORDS = (
        r'cups?|tbsps?|tablespoons?|tsps?|teaspoons?|lbs?|pounds?|oz|ounces?|g|kg|ml|l|cans?|'
        r'cloves?|slices?|pinch(?:es)?|dash(?:es)?|packets?|sheets?|jars?|packs?|bags?|sticks?|'
        r'bunche?s?|heads?|sprigs?|stalks?|fillets?|pints?|quarts?|blocks?|scoops?'
    )
    # strip a leading quantity (number/fraction, with an optional range like "2-3"), then an optional unit word
    s = re.sub(r'^[\d.\s/\u00bc\u00bd\u00be\u2153\u2154\u215b\-]+\s*', '', s)
    s = re.sub(r'^(?:' + UNIT_WORDS + r')\b\.?\s*(?:of\s+)?', '', s)
    # some lines have a second bare number/size word before the noun ("1 English cucumber" -> already stripped "1 ")
    s = re.sub(r'^(?:large|small|medium|jumbo)\b\s*', '', s)

    # split into comma segments and drop purely-descriptor leading segments
    segments = [seg.strip() for seg in s.split(',') if seg.strip()]
    core = segments[0] if segments else s
    idx = 0
    while idx < len(segments) - 1 and segments[idx] in DESCRIPTOR_WORDS:
        idx += 1
        core = segments[idx]

    # strip leading descriptor words still attached to the chosen segment
    changed = True
    while changed:
        changed = False
        for d in sorted(DESCRIPTOR_WORDS, key=len, reverse=True):
            if core.startswith(d + ' '):
                core = core[len(d):].strip()
                changed = True

    core = re.sub(
        r'\b(fresh|chopped|diced|minced|sliced|grated|crushed|softened|melted|shredded|'
        r'to taste|optional|room temperature|cooked|drained|rinsed|peeled|halved|quartered|'
        r'divided|for serving|for topping|for garnish)\b', '', core
    )
    core = re.sub(r'\s+', ' ', core).strip(' -')
    return core if core else raw.strip().lower()

RECIPE_HEAD = re.compile(r'^# (\d+)\. (.+)$', re.M)
ANY_H1 = re.compile(r'^# .+$', re.M)
NON_RI_H2 = re.compile(r'^## (?!Ingredients$|Instructions$).+$', re.M)

def parse_file(md_text, category_fn):
    """category_fn(recipe_number) -> category/subcategory string"""
    heads = list(RECIPE_HEAD.finditer(md_text))
    boundaries = sorted(
        [m.start() for m in ANY_H1.finditer(md_text)] +
        [m.start() for m in NON_RI_H2.finditer(md_text)]
    )
    recipes = []
    for i, m in enumerate(heads):
        num = int(m.group(1))
        title = strip_md(m.group(2))
        start = m.end()
        end = next((b for b in boundaries if b > m.start()), len(md_text))
        block = md_text[start:end]

        # description: first italic line right after title
        desc_m = re.search(r'\*(.+?)\*', block, re.S)
        description = strip_md(clean_wrapped(desc_m.group(1))) if desc_m else ""

        # macros (optional)
        macros = None
        macros_m = re.search(
            r'\*\*(\d+)\*\*\s*\|?\s*\*\*(\d+)g?\*\*\s*\|?\s*\*\*(\d+)g?\*\*\s*\|?\s*\*\*(\d+)g?\*\*',
            block
        )
        if not macros_m:
            # table form spans multiple lines; grab the row after CALORIES/PROTEIN/CARBS/FAT headers
            table_m = re.search(
                r'\*\*CALORIES\*\*.*?\*\*FAT\*\*\s*\n+-+\s*\n\s*\*\*(\d+)\*\*\s+\*\*(\d+)g\*\*\s+\*\*(\d+)g\*\*\s+\*\*(\d+)g\*\*',
                block, re.S
            )
            if table_m:
                macros_m = table_m
        if macros_m:
            macros = {
                "calories": int(macros_m.group(1)),
                "protein_g": int(macros_m.group(2)),
                "carbs_g": int(macros_m.group(3)),
                "fat_g": int(macros_m.group(4)),
            }

        # ingredients
        ingredients = []
        ing_m = re.search(r'## Ingredients\n(.*?)(?:## Instructions|\Z)', block, re.S)
        if ing_m:
            for item in re.split(r'\n-\s{2,}', '\n' + ing_m.group(1)):
                item = item.strip()
                if not item or item.startswith('#'):
                    continue
                raw = strip_md(clean_wrapped(item))
                if raw:
                    ingredients.append({"raw": raw, "name": normalize_ingredient_name(raw)})

        # instructions
        instructions = []
        instr_m = re.search(r'## Instructions\n(.*?)(?:\*\*Tip:|\Z)', block, re.S)
        if instr_m:
            for item in re.split(r'\n\d+\.\s{1,}', '\n' + instr_m.group(1)):
                item = item.strip()
                if not item or item.startswith('#'):
                    continue
                step = strip_md(clean_wrapped(item))
                if step:
                    instructions.append(step)

        # tip
        tip = None
        tip_m = re.search(r'\*\*Tip:\*\*\s*(.+?)(?:\Z)', block, re.S)
        if tip_m:
            tip = strip_md(clean_wrapped(tip_m.group(1)))

        cat_info = category_fn(num)
        recipes.append({
            "id": num,
            "title": title,
            "category": cat_info["category"],
            "subcategory": cat_info.get("subcategory"),
            "description": description,
            "macros": macros,
            "servings": 4,
            "ingredients": ingredients,
            "instructions": instructions,
            "tip": tip,
        })
    return recipes
