"""Recetas curadas de MercAldas.

Cuando el cliente pide una receta conocida, se usa ESTA lista (ingredientes y
pasos canónicos) en lugar de lo que el modelo invente, para garantizar que
todo lo que se sugiera/agregue al carrito pertenezca realmente a la receta.

Los nombres de ingredientes están elegidos para matchear bien el catálogo
(regla de `tools._score_coincidencia`: el primer token del ingrediente debe
ser la primera palabra del producto).
"""
import re

_ACCENT_MAP = str.maketrans("áéíóúüñ", "aeiouun")


def _tokens(text: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]+", text.casefold().translate(_ACCENT_MAP)))


RECIPES: list[dict] = [
    {
        "nombre": "sancocho de pollo",
        "alias": ["sancocho", "sancocho trifasico"],
        "ingredientes": [
            {"nombre": "pechuga de pollo", "cantidad": 2},
            {"nombre": "papa", "cantidad": 4},
            {"nombre": "platano", "cantidad": 2},
            {"nombre": "yuca", "cantidad": 1},
            {"nombre": "cebolla", "cantidad": 2},
            {"nombre": "cilantro", "cantidad": 1},
            {"nombre": "ajo", "cantidad": 1},
            {"nombre": "sal", "cantidad": 1},
            {"nombre": "aceite", "cantidad": 1},
        ],
        "pasos": [
            "Sofríe la cebolla, el ajo y el cilantro picados en un poco de aceite.",
            "Agrega el pollo (pechuga) y dóralo unos minutos.",
            "Añade agua, la papa, el plátano y la yuca; cocina a fuego medio.",
            "Sazona con sal y cocina hasta que los tubérculos estén blandos (30-40 min).",
            "Sirve caliente, con aguacate o arroz blanco.",
        ],
    },
    {
        "nombre": "arroz con pollo",
        "alias": ["arroz con pollo"],
        "ingredientes": [
            {"nombre": "arroz", "cantidad": 2},
            {"nombre": "pechuga de pollo", "cantidad": 2},
            {"nombre": "cebolla", "cantidad": 1},
            {"nombre": "ajo", "cantidad": 1},
            {"nombre": "arveja", "cantidad": 1},
            {"nombre": "zanahoria", "cantidad": 1},
            {"nombre": "sal", "cantidad": 1},
            {"nombre": "aceite", "cantidad": 1},
        ],
        "pasos": [
            "Sofríe cebolla y ajo en aceite; agrega el pollo en trozos y dóralo.",
            "Añade el arroz, la arveja y la zanahoria; mezcla bien.",
            "Vierte el agua (el doble del volumen de arroz) y la sal.",
            "Tapa y cocina a fuego bajo hasta que el arroz absorba el líquido (20 min).",
            "Deja reposar 5 minutos y sirve.",
        ],
    },
    {
        "nombre": "frijoles",
        "alias": ["frijoles", "frijolada", "frijol"],
        "ingredientes": [
            {"nombre": "frijol", "cantidad": 2},
            {"nombre": "cebolla", "cantidad": 1},
            {"nombre": "ajo", "cantidad": 1},
            {"nombre": "zanahoria", "cantidad": 1},
            {"nombre": "sal", "cantidad": 1},
            {"nombre": "aceite", "cantidad": 1},
        ],
        "pasos": [
            "Remoja los frijoles la noche anterior (o usa los de lata).",
            "Sofríe cebolla y ajo en aceite; agrega los frijoles con su caldo.",
            "Añade zanahoria en trozos y sal; cocina a fuego medio hasta espesar.",
            "Sirve con arroz, carne molida, chicharrón o aguacate.",
        ],
    },
    {
        "nombre": "lentejas",
        "alias": ["lentejas", "sopa de lentejas"],
        "ingredientes": [
            {"nombre": "lenteja", "cantidad": 2},
            {"nombre": "cebolla", "cantidad": 1},
            {"nombre": "ajo", "cantidad": 1},
            {"nombre": "zanahoria", "cantidad": 1},
            {"nombre": "sal", "cantidad": 1},
            {"nombre": "aceite", "cantidad": 1},
        ],
        "pasos": [
            "Sofríe cebolla y ajo en aceite.",
            "Agrega las lentejas, la zanahoria en cubos y el agua.",
            "Cocina a fuego medio hasta que estén blandas (30 min); sazona con sal.",
            "Sirve caliente con arroz blanco.",
        ],
    },
    {
        "nombre": "ajiaco",
        "alias": ["ajiaco", "ajiaco santafereño"],
        "ingredientes": [
            {"nombre": "pechuga de pollo", "cantidad": 2},
            {"nombre": "papa", "cantidad": 4},
            {"nombre": "mazorca", "cantidad": 1},
            {"nombre": "cebolla", "cantidad": 1},
            {"nombre": "ajo", "cantidad": 1},
            {"nombre": "cilantro", "cantidad": 1},
            {"nombre": "crema de leche", "cantidad": 1},
            {"nombre": "sal", "cantidad": 1},
        ],
        "pasos": [
            "Cocina el pollo en agua con cebolla, ajo y sal hasta que esté tierno.",
            "Agrega las papas y la mazorca partida; cocina hasta espesar.",
            "Desmenuza el pollo y revuélvelo; rectifica la sal.",
            "Sirve con crema de leche, alcaparras y cilantro fresco.",
        ],
    },
    {
        "nombre": "arepa de huevo",
        "alias": ["arepa de huevo", "arepa con huevo"],
        "ingredientes": [
            {"nombre": "arepa", "cantidad": 1},
            {"nombre": "huevo", "cantidad": 6},
            {"nombre": "aceite", "cantidad": 1},
            {"nombre": "sal", "cantidad": 1},
        ],
        "pasos": [
            "Calienta abundante aceite en una sartén profunda.",
            "Fríe la arepa hasta que infle; retira y deja escurrir un momento.",
            "Ábrele un hueco con el cuchillo, vierte el huevo crudo y sella.",
            "Vuelve a freír hasta que el huevo esté cocido y la arepa dorada.",
            "Sazona con sal al gusto.",
        ],
    },
    {
        "nombre": "espagueti con atún",
        "alias": ["espagueti con atun", "pasta con atun", "spaghetti con atun"],
        "ingredientes": [
            {"nombre": "pasta", "cantidad": 1},
            {"nombre": "atun", "cantidad": 1},
            {"nombre": "cebolla", "cantidad": 1},
            {"nombre": "ajo", "cantidad": 1},
            {"nombre": "tomate", "cantidad": 1},
            {"nombre": "sal", "cantidad": 1},
            {"nombre": "aceite", "cantidad": 1},
        ],
        "pasos": [
            "Cocina la pasta en agua con sal hasta que esté al dente.",
            "Sofríe cebolla y ajo en aceite; agrega el tomate picado.",
            "Añade el atún desmenuzado y mezcla con la salsa.",
            "Mezcla la pasta con la salsa de atún y sirve caliente.",
        ],
    },
    {
        "nombre": "arroz atollado",
        "alias": ["arroz atollado", "atollado"],
        "ingredientes": [
            {"nombre": "arroz", "cantidad": 2},
            {"nombre": "costilla", "cantidad": 1},
            {"nombre": "pechuga de pollo", "cantidad": 1},
            {"nombre": "papa", "cantidad": 2},
            {"nombre": "cebolla", "cantidad": 1},
            {"nombre": "ajo", "cantidad": 1},
            {"nombre": "arveja", "cantidad": 1},
            {"nombre": "sal", "cantidad": 1},
            {"nombre": "aceite", "cantidad": 1},
        ],
        "pasos": [
            "Sofríe cebolla y ajo en aceite; dora la costilla y el pollo.",
            "Agrega agua, la papa en cubos y sal; cocina 20 minutos.",
            "Añade el arroz y la arveja; cocina a fuego bajo, tapado, hasta espesar.",
            "Remueve con cuidado y sirve caliente.",
        ],
    },
]


def find_recipe(nombre: str) -> dict | None:
    """Busca la receta curada por coincidencia de tokens (nombre + alias).

    Ej: 'sancocho' o 'quiero sancocho de pollo' → receta 'sancocho de pollo'.
    'pollo' → matchea la primera receta con pollo (orden del catálogo).
    """
    if not nombre:
        return None
    req = _tokens(nombre)
    if not req:
        return None
    for receta in RECIPES:
        candidatos = _tokens(receta["nombre"])
        for alias in receta.get("alias", []):
            candidatos |= _tokens(alias)
        if req <= candidatos:
            return receta
    return None
