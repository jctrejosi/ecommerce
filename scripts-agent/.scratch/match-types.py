#!/usr/bin/env python3
"""Empareja los 12 tipos originales con los tipos existentes (fuzzy).

Lee por stdin lineas: id|code|name|count
"""
import sys
import unicodedata
from difflib import SequenceMatcher

TARGETS = [
    "Cuidado del Bebé",
    "Carnes, Pollo y Pescado",
    "Cuidado Personal",
    "Despensa",
    "Electrodomésticos",
    "Frutas y Verduras",
    "Hogar",
    "Lácteos y Refrigerados",
    "Limpieza",
    "Mascotas",
    "Tecnología",
    "Vinos y Licores",
]

# Palabras extra que ayudan a emparejar
SYNONYMS = {
    "bebé": ["bebe", "bebes", "infantil", "pa�al", "panal"],
    "carnes": ["carne", "carnicos", "pollo", "pescado", "cerdo", "res"],
    "personal": ["personal", "aseo personal", "higiene"],
    "despensa": ["despensa", "abarrotes", "granos", "enlatados"],
    "electrodomésticos": ["electrodomestico", "electro", "linea blanca"],
    "frutas": ["fruta", "verduras", "hortalizas", "fruver"],
    "hogar": ["hogar", "casa", "menaje", "utensilios"],
    "lácteos": ["lacteo", "leche", "queso", "yogur"],
    "refrigerados": ["refrigerado", "congelado", "carnes frias"],
    "limpieza": ["limpieza", "aseo", "detergente", "jabon"],
    "mascotas": ["mascota", "perro", "gato", "animal"],
    "tecnología": ["tecnologia", "electronico", "celular", "computo"],
    "vinos": ["vino", "licor", "cerveza", "aguardiente", "whisky", "ron"],
}


def norm(s: str) -> str:
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return s.lower().strip()


def tokens(s: str):
    return set(t for t in norm(s).replace(",", " ").replace("-", " ").split() if t)


rows = []
for line in sys.stdin:
    parts = line.rstrip("\n").split("|")
    if len(parts) < 4:
        continue
    pid, code, name, cnt = parts[0], parts[1], parts[2], parts[3]
    try:
        cnt = int(cnt)
    except ValueError:
        cnt = 0
    rows.append((pid, code, name, cnt))

print(f"tipos existentes: {len(rows)}\n")

for target in TARGETS:
    tn = norm(target)
    tt = tokens(target)
    extras = set()
    for k, v in SYNONYMS.items():
        if k in tn:
            extras |= set(v)

    scored = []
    for pid, code, name, cnt in rows:
        nn = norm(name)
        base = SequenceMatcher(None, nn, tn).ratio()
        overlap = len(tt & tokens(name)) / max(len(tt), 1)
        extra_hit = 1.0 if any(e and e in nn for e in extras) else 0.0
        score = 0.55 * base + 0.30 * overlap + 0.15 * extra_hit
        scored.append((score, name, code, cnt))
    scored.sort(reverse=True)

    print(f"· {target}")
    for score, name, code, cnt in scored[:3]:
        print(f"    {score:0.2f}  [{code}] {name}  ({cnt} productos)")
