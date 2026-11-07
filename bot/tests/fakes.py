"""Dobles de prueba reutilizables (sin dependencias externas)."""
from __future__ import annotations


def make_product(
    product_id: int = 1,
    variant_id: int = 11,
    name: str = "Arroz blanco 500g",
    price: float = 2500.0,
    stock: int | None = 10,
    **overrides,
) -> dict:
    """Producto con la forma que devuelve `database._product`."""
    product = {
        "product_id": product_id,
        "variant_id": variant_id,
        "external_id": f"ext-{product_id}",
        "slug": name.lower().replace(" ", "-"),
        "name": name,
        "plu": str(product_id),
        "description": "",
        "price": price,
        "compare_price": None,
        "category": "Despensa",
        "brand": "Mercaldas",
        "image": None,
        "stock": stock,
    }
    product.update(overrides)
    return product


class _FakeAcquire:
    def __init__(self, conn: "FakeConnection"):
        self._conn = conn

    async def __aenter__(self) -> "FakeConnection":
        return self._conn

    async def __aexit__(self, exc_type, exc, tb) -> bool:
        return False


class FakeConnection:
    """Conexión asyncpg falsa.

    Los handlers reciben ``(query, args)`` y devuelven el valor simulado.
    Cada llamada queda registrada en ``self.queries`` para poder inspeccionar
    el SQL/parámetros enviados.
    """

    def __init__(
        self,
        *,
        fetch=None,
        fetchrow=None,
        fetchval=None,
        execute=None,
    ):
        self.queries: list[tuple[str, tuple]] = []
        self._fetch = fetch
        self._fetchrow = fetchrow
        self._fetchval = fetchval
        self._execute = execute

    async def fetch(self, query: str, *args):
        self.queries.append((query, args))
        value = self._fetch(query, args) if callable(self._fetch) else self._fetch
        return [] if value is None else value

    async def fetchrow(self, query: str, *args):
        self.queries.append((query, args))
        return self._fetchrow(query, args) if callable(self._fetchrow) else self._fetchrow

    async def fetchval(self, query: str, *args):
        self.queries.append((query, args))
        return self._fetchval(query, args) if callable(self._fetchval) else self._fetchval

    async def execute(self, query: str, *args):
        self.queries.append((query, args))
        if callable(self._execute):
            return self._execute(query, args)
        return self._execute if self._execute is not None else "OK"

    def find_queries(self, needle: str) -> list[tuple[str, tuple]]:
        needle = needle.upper()
        return [(q, a) for q, a in self.queries if needle in q.upper()]


class FakePool:
    """Pool asyncpg falso que siempre entrega la misma conexión."""

    def __init__(self, conn: FakeConnection | None = None):
        self.conn = conn or FakeConnection()
        self.closed = False

    def acquire(self) -> _FakeAcquire:
        return _FakeAcquire(self.conn)

    async def close(self) -> None:
        self.closed = True


def empty_cart(session_id: str = "s-1") -> dict:
    return {"session_id": session_id, "items": [], "count": 0, "total": 0.0}


def cart_with(*items: dict, session_id: str = "s-1") -> dict:
    normalized = [
        {
            "variant_id": it["variant_id"],
            "product_id": it["product_id"],
            "name": it["name"],
            "slug": it.get("slug", ""),
            "price": float(it["price"]),
            "quantity": int(it.get("quantity", 1)),
            "subtotal": float(it["price"]) * int(it.get("quantity", 1)),
            "image": it.get("image"),
        }
        for it in items
    ]
    return {
        "session_id": session_id,
        "items": normalized,
        "count": sum(i["quantity"] for i in normalized),
        "total": round(sum(i["subtotal"] for i in normalized), 2),
    }
