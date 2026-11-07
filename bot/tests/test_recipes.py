"""Pruebas de la base de recetas curadas."""
import pytest

from app import recipes


def test_hay_recetas_y_estructura_completa():
    assert recipes.RECIPES, "la base de recetas curadas no debe estar vacía"
    for receta in recipes.RECIPES:
        assert receta["nombre"]
        assert receta["alias"]
        assert len(receta["ingredientes"]) >= 3
        assert len(receta["pasos"]) >= 3
        for ingrediente in receta["ingredientes"]:
            assert ingrediente["nombre"]
            assert int(ingrediente["cantidad"]) >= 1


def test_nombres_de_recetas_no_se_repiten():
    nombres = [r["nombre"] for r in recipes.RECIPES]
    assert len(nombres) == len(set(nombres))


@pytest.mark.parametrize(
    "consulta",
    [
        "sancocho de pollo",
        "sancocho",
        "sancocho trifasico",
        "arroz con pollo",
        "frijoles",
        "frijolada",
        "sopa de lentejas",
        "ajiaco",
        "ajiaco santafereño",
        "arepa de huevo",
        "espagueti con atun",
        "pasta con atún",
        "arroz atollado",
        "atollado",
    ],
)
def test_encuentra_recetas_por_nombre_o_alias(consulta):
    assert recipes.find_recipe(consulta) is not None


def test_encuentra_por_nombre_normalizado_sin_acentos_y_mayusculas():
    receta = recipes.find_recipe("ESPAGUETI CON ATÚN")
    assert receta is not None
    assert receta["nombre"] == "espagueti con atún"


def test_sancocho_trifasico_devuelve_sancocho_de_pollo():
    assert recipes.find_recipe("sancocho trifasico")["nombre"] == "sancocho de pollo"


def test_pollo_matchea_la_primera_receta_con_pollo():
    assert recipes.find_recipe("pollo")["nombre"] == "sancocho de pollo"


@pytest.mark.parametrize("consulta", ["", None, "   ", "!!!", "pizza", "sushi"])
def test_devuelve_none_cuando_no_hay_coincidencia(consulta):
    assert recipes.find_recipe(consulta) is None


def test_la_consulta_debe_ser_subconjunto_de_tokens():
    """Comportamiento actual: una frase con palabras extra fuera del nombre /
    alias no matchea (y `consultar_receta` cae al camino del modelo)."""
    assert recipes.find_recipe("quiero hacer sancocho") is None
    assert recipes.find_recipe("quisiera una receta de lentejas") is None
