# test_db — Pruebas de conexión a Advantage Database Server (ADS)

Pruebas de conexión directa a la base **Publidata** (ADS) desde Python.

| Dato | Valor |
|---|---|
| Servidor ADS | `89.117.149.145` |
| Puerto | `2000` |
| Base | `C:\VISADS_25\ADD\Publidata.add` |
| Usuario DB | `AdsSys` |
| Contraseña DB | `Pubdata` |

## Resultado de las pruebas (19-ago-2026)

| Prueba | Resultado |
|---|---|
| TCP `89.117.149.145:2000` (desde Linux) | ✅ Alcanzable |
| `pyodbc` + driver ODBC en Linux | ❌ No hay driver |
| `pyodbc` en Windows (RDP) | ⏳ Pendiente — el driver sí existe allí |
| Handshake ACE32 puro (Linux) | ❌ El servidor cierra la conexión |

### ¿Por qué falla pyodbc en Linux?

El **Advantage ODBC Driver** de SAP es **exclusivo de Windows** y SAP
descontinuó el producto (el acceso a descargas requiere cuenta de partner).
En esta máquina Linux no hay ningún driver ODBC instalado
(`pyodbc.drivers()` devuelve vacío), por lo que `pyodbc.connect()` no puede
completarse: la conexión ODBC solo es posible **desde la máquina Windows**
donde esté instalado el driver (la del RDP `xfreerdp3`).

### ¿Por qué cierra la conexión el probe ACE32?

El probe manda el paquete `CONNECT` del protocolo ACE32 en claro. El
servidor acepta el TCP, espera datos y cierra sin responder. Esto es
compatible con:

1. **Cifrado obligatorio** en el servidor ADS (negociación RSA previa),
2. Un firewall/NAT que acepta y corta conexiones externas (el `adscli`
   funciona con `localhost:2000` **dentro** de la máquina Windows),
3. Que el puerto público no sea el ADS directamente.

Para confirmarlo, desde la sesión RDP ejecuta:

```sh
adscli -q "SELECT * FROM system.tables" -s localhost:2000 -d "C:\VISADS_25\ADD\Publidata.add"
```

Si eso responde y la conexión externa no, el problema es de red/firewall,
no del protocolo.

## Cómo usar

### 1. Crear el entorno (solo una vez)

```sh
python3 -m venv test_db/venv
test_db/venv/bin/pip install -r test_db/requirements.txt
```

### 2. Probar con pyodbc

```sh
test_db/venv/bin/python test_db/pyodbc_test.py
```

Variables de entorno opcionales: `ADS_SERVER`, `ADS_PORT`, `ADS_DB`,
`ADS_UID`, `ADS_PWD`.

> **En Linux** llega hasta el chequeo de driver y termina con un mensaje
> claro (comportamiento esperado).
>
> **En Windows** (la máquina del RDP), instala Python, crea un venv con
> `pyodbc`, y ejecuta el mismo script:
>
> ```sh
> python -m venv test_db\venv
> test_db\venv\Scripts\pip install -r test_db\requirements.txt
> test_db\venv\Scripts\python test_db\pyodbc_test.py
> ```
>
> El driver ODBC de Advantage debe estar instalado en Windows (normalmente
> ya lo está en máquinas con VISADS). La connection string generada es:
>
> ```
> DRIVER={Advantage ODBC Driver};Server=89.117.149.145:2000;DataDirectory=C:\VISADS_25\ADD\Publidata.add;ServerTypes=2;CommType=TCP_IP;UID=AdsSys;PWD=Pubdata;
> ```

### 3. Probe ACE32 (solo verificación de red/protocolo, sin driver)

```sh
test_db/venv/bin/python test_db/ace32_probe.py
```

Habla el protocolo ACE32 por sockets puros (funciona en cualquier SO).
`ace32_experiment.py` contiene las variantes de paquete probadas contra el
servidor (ninguna obtuvo respuesta).

## API de ejemplo (FastAPI + Swagger) — tabla PROVEE

Una mini API en `api/` que consulta la tabla **PROVEE** de Publidata y expone
Swagger en `/docs` para probarla.

### Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/` | Info básica y configuración activa |
| `GET` | `/provee` | Lista de proveedores (`?limit=` y `?offset=`) |
| `GET` | `/provee/count` | Cantidad total de filas |
| `GET` | `/provee/meta` | Columnas reales de la tabla y clave detectada |
| `GET` | `/provee/{clave}` | Fila por clave (parámetro enlazado, sin inyección SQL) |

No asume el esquema: las columnas se leen del cursor (`cursor.description`)
y la columna clave se auto-detecta (busca `CODIGO`/`COD`/`ID`; se puede fijar
con `ADS_KEY_COLUMN`). Los valores se convierten a JSON (Decimal→float,
fechas→ISO, CHAR→sin espacios).

### En Windows (con el driver ODBC real)

Desde la máquina Windows (la del RDP), dentro de `test_db`:

```sh
cd test_db
venv\Scripts\uvicorn api.main:app --host 0.0.0.0 --port 8000
```

Swagger: <http://localhost:8000/docs>

### En Linux / sin base (modo demo)

OJO: aquí el path del venv **no tiene barras invertidas** y depende de dónde
ejecutes. Desde la raíz del proyecto (`mercaldas-ecommerce`):

```sh
ADS_DEMO=1 test_db/venv/bin/uvicorn api.main:app --app-dir test_db --port 8000
```

Ya dentro de `test_db/`:

```sh
ADS_DEMO=1 venv/bin/uvicorn api.main:app --port 8000
```

Verificación rápida:

```sh
curl http://127.0.0.1:8000/provee?limit=2   # datos de ejemplo
```

Swagger: <http://localhost:8000/docs>

Variables de entorno: `ADS_SERVER`, `ADS_PORT`, `ADS_DB`, `ADS_UID`,
`ADS_PWD`, `ADS_TABLE` (default `PROVEE`), `ADS_KEY_COLUMN`.

### Smoke tests

```sh
test_db/venv/bin/python test_db/_smoke_api.py   # modo demo: verifica todos los endpoints
# test_db/venv/bin/python test_db/_smoke_real.py  # modo real: verifica el error 503 sin driver
```

## Archivos

| Archivo | Descripción |
|---|---|
| `venv/` | Entorno virtual con `pyodbc`, `fastapi`, `uvicorn` |
| `pyodbc_test.py` | Prueba de conexión vía pyodbc (funciona en Windows) |
| `ace32_probe.py` | Probe del protocolo ACE32 por sockets (Linux) |
| `ace32_experiment.py` | Exploración de variantes del paquete CONNECT |
| `api/` | API FastAPI de ejemplo sobre la tabla PROVEE |
| `_smoke_api.py` / `_smoke_real.py` | Smoke tests de la API |
| `requirements.txt` | Dependencias del venv |
