"""Pruebas del limitador de tasa en memoria (ventana fija)."""
import pytest
from fastapi import Request, Response

from app import rate_limit


def make_request(
    path: str = "/chat",
    method: str = "POST",
    headers: dict | None = None,
    client: tuple | None = ("127.0.0.1", 50000),
) -> Request:
    raw_headers = [
        (key.lower().encode(), value.encode()) for key, value in (headers or {}).items()
    ]
    scope = {
        "type": "http",
        "http_version": "1.1",
        "method": method,
        "scheme": "http",
        "path": path,
        "raw_path": path.encode(),
        "root_path": "",
        "query_string": b"",
        "headers": raw_headers,
        "client": client,
        "server": ("testserver", 80),
    }
    return Request(scope)


async def ok_endpoint(request: Request) -> Response:
    return Response(status_code=200)


class Clock:
    def __init__(self, start: float = 1000.0):
        self.now = start

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


@pytest.fixture
def clock(monkeypatch):
    fake = Clock()
    monkeypatch.setattr(rate_limit.time, "monotonic", fake)
    return fake


# ─── Helpers ─────────────────────────────────────────────────────


def test_int_env_usa_default_si_falta(monkeypatch):
    monkeypatch.delenv("VAR_QUE_NO_EXISTE", raising=False)
    assert rate_limit._int_env("VAR_QUE_NO_EXISTE", 7) == 7


@pytest.mark.parametrize("raw", ["abc", "", "0", "-5"])
def test_int_env_usa_default_si_es_invalido(monkeypatch, raw):
    monkeypatch.setenv("VAR_TEST", raw)
    assert rate_limit._int_env("VAR_TEST", 9) == 9


def test_int_env_lee_valor_valido(monkeypatch):
    monkeypatch.setenv("VAR_TEST", "42")
    assert rate_limit._int_env("VAR_TEST", 9) == 42


def test_client_ip_usa_primer_x_forwarded_for():
    request = make_request(headers={"x-forwarded-for": " 10.1.2.3 , 172.16.0.1"})
    assert rate_limit._client_ip(request) == "10.1.2.3"


def test_client_ip_usa_cliente_directo_sin_forwarded():
    request = make_request(client=("192.168.1.9", 1234))
    assert rate_limit._client_ip(request) == "192.168.1.9"


def test_client_ip_desconocida_sin_cliente():
    request = make_request(client=None)
    assert rate_limit._client_ip(request) == "unknown"


def test_cleanup_no_hace_nada_con_pocos_buckets():
    rate_limit._buckets.clear()
    rate_limit._buckets["a"] = (0.0, 1)
    rate_limit._cleanup(now=100.0)
    assert "a" in rate_limit._buckets


def test_cleanup_elimina_buckets_expirados():
    rate_limit._buckets.clear()
    for i in range(512):
        rate_limit._buckets[f"ip-{i}"] = (50.0, 1)
    rate_limit._buckets["vigente"] = (500.0, 1)

    rate_limit._cleanup(now=100.0)

    assert list(rate_limit._buckets) == ["vigente"]


# ─── Middleware ──────────────────────────────────────────────────


async def test_permite_limite_y_bloquea_despues(monkeypatch, clock):
    monkeypatch.setattr(rate_limit, "LIMIT", 3)
    monkeypatch.setattr(rate_limit, "WINDOW", 60)
    request = make_request(headers={"x-forwarded-for": "10.0.0.1"})

    for _ in range(3):
        response = await rate_limit.rate_limit_middleware(request, ok_endpoint)
        assert response.status_code == 200

    response = await rate_limit.rate_limit_middleware(request, ok_endpoint)
    assert response.status_code == 429
    assert "Retry-After" in response.headers
    assert 1 <= int(response.headers["Retry-After"]) <= 60
    assert "Demasiadas peticiones" in response.body.decode()


async def test_la_ventana_se_reinicia(monkeypatch, clock):
    monkeypatch.setattr(rate_limit, "LIMIT", 1)
    monkeypatch.setattr(rate_limit, "WINDOW", 30)
    request = make_request(headers={"x-forwarded-for": "10.0.0.2"})

    assert (await rate_limit.rate_limit_middleware(request, ok_endpoint)).status_code == 200
    assert (await rate_limit.rate_limit_middleware(request, ok_endpoint)).status_code == 429

    clock.advance(31)
    assert (await rate_limit.rate_limit_middleware(request, ok_endpoint)).status_code == 200


async def test_ips_distintas_tienen_buckets_independientes(monkeypatch, clock):
    monkeypatch.setattr(rate_limit, "LIMIT", 1)
    monkeypatch.setattr(rate_limit, "WINDOW", 60)
    req_a = make_request(headers={"x-forwarded-for": "10.0.0.3"})
    req_b = make_request(headers={"x-forwarded-for": "10.0.0.4"})

    assert (await rate_limit.rate_limit_middleware(req_a, ok_endpoint)).status_code == 200
    assert (await rate_limit.rate_limit_middleware(req_a, ok_endpoint)).status_code == 429
    assert (await rate_limit.rate_limit_middleware(req_b, ok_endpoint)).status_code == 200


async def test_options_no_cuenta(monkeypatch, clock):
    monkeypatch.setattr(rate_limit, "LIMIT", 1)
    monkeypatch.setattr(rate_limit, "WINDOW", 60)
    request = make_request(method="OPTIONS")

    for _ in range(5):
        assert (await rate_limit.rate_limit_middleware(request, ok_endpoint)).status_code == 200
    assert rate_limit._buckets == {}


@pytest.mark.parametrize("path", ["/health", "/catalog/search", "/", "/docs"])
async def test_rutas_no_protegidas_no_cuentan(monkeypatch, clock, path):
    monkeypatch.setattr(rate_limit, "LIMIT", 1)
    monkeypatch.setattr(rate_limit, "WINDOW", 60)
    request = make_request(path=path, method="GET")

    for _ in range(5):
        assert (await rate_limit.rate_limit_middleware(request, ok_endpoint)).status_code == 200
    assert rate_limit._buckets == {}


@pytest.mark.parametrize("path", ["/cart", "/cart/items", "/chat", "/chat/options"])
async def test_rutas_protegidas_cuentan(monkeypatch, clock, path):
    monkeypatch.setattr(rate_limit, "LIMIT", 1)
    monkeypatch.setattr(rate_limit, "WINDOW", 60)
    request = make_request(path=path)

    assert (await rate_limit.rate_limit_middleware(request, ok_endpoint)).status_code == 200
    assert (await rate_limit.rate_limit_middleware(request, ok_endpoint)).status_code == 429
