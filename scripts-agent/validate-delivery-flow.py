"""Valida que un pedido completado en picking llegue a la app de delivery.

Login del repartidor en /delivery/auth/login y consulta /delivery/orders.
"""
import json
import urllib.request

BASE = "http://localhost:3000"
USERNAME = "qa-del-temp"
PASSWORD = "demo123"


def post(path, body, token=None):
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())


def get(path, token):
    req = urllib.request.Request(BASE + path, method="GET")
    req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())


login = post("/delivery/auth/login", {"username": USERNAME, "password": PASSWORD})
token = login["accessToken"]
print("login ok:", login.get("driver", {}).get("fullName") or USERNAME)

orders = get("/delivery/orders", token)
print("pedidos activos:", len(orders))
for o in orders:
    print(
        f"  - {o['referenceCode']} | {o['status']} | {o['customer']['name']} | "
        f"${o['totals']['value']} | items={len(o['items'])}"
    )
