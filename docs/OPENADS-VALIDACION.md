# Validación de OpenADS como servidor Advantage en Docker

> Fecha: 2026-10-08. Prueba sobre la copia real `db/ADD_ANALITICA/`.
> Repo evaluado: <https://github.com/FiveTechSoft/OpenADS> (Apache-2.0, v1.09.73).

## 1. Qué es OpenADS

Reimplementación **open-source y clean-room** del *Advantage Client Engine* (ACE)
de SAP, más un servidor (`openads_serverd`). Sustituye a `ace64.dll` /
`libace.so` y trae:

- Lectura/escritura **byte-compatible** de `.adt` / `.adm` (datos y memo nativos
  de Advantage) y de índices `.adi`, además de DBF/CDX/NTX/FPT.
- Servidor TCP (`tcp://host:puerto`) con protocolo propio, consola web
  (**Studio**) con REST + SQL, y herramientas (`adsbackup`, `import_dd`,
  `adi_inspect`).
- Build multiplataforma (Windows/Linux/macOS) con CMake.

Es la pieza que faltaba: el **instalador de SAP para Linux
(`adslinux-11.10.0.24.tar.gz`) no existe públicamente** (producto descontinuado
en dic-2022), por lo que el plan de `db/ads/` estaba bloqueado.

## 2. Cómo se probó

```bash
# 1. clonar (gitignored)
mkdir -p db/ads/openads && cd db/ads/openads
git clone --depth 1 https://github.com/FiveTechSoft/OpenADS.git src

# 2. compilar en contenedor (el host no tiene cmake)
bash db/ads/openads/build.sh          # -> db/ads/openads/build

# 3. montar la base y probar
docker build -t mercaldas/openads:test -f db/ads/openads/Dockerfile db/ads/openads
docker run -d --name openads-img -p 16262:6262 -p 18080:8080 \
  -v "$PWD/db/ads/openads/data-test:/data" mercaldas/openads:test

# 4. consultar
curl -u dsi:dsi http://localhost:18080/api/health
curl -u dsi:dsi "http://localhost:18080/api/tables/FADITE.ADT/schema"
```

## 3. Resultados

| Prueba | Resultado |
|---|---|
| Compilación en Docker (Debian bookworm) | ✅ OK (~5–10 min, 8 hilos) |
| Imagen Docker ejecutada y con healthcheck | ✅ `{"status":"ok"}` |
| `TIDMARCAS.adt` | ✅ 2 campos, **2.176 registros**; filas `1/MERCALDAS`, `2/VITAMAR`, `3/ANTILLANA` |
| `TIDCATE.ADT` | ✅ abre **solo con la extensión en mayúsculas exacta** |
| `TIDCATE` (sin coincidir el case) | ❌ `AdsOpenTable failed` → **sensible a mayúsculas** |
| `TIDSAL.adt` (304 campos, 133 MB) | ✅ **304 columnas, 51.938 registros** |
| `DOMDIA.ADT` (pedido de domicilio) | ✅ 56 campos; registro 1 = `140000358011 / 1407 52128 / 20150102 …` |
| `DOMITE.ADT` | ✅ 43 campos; enlaza con DOMDIA por `IFFACT` |
| `FADITE.ADT` (5,5 GB) | ✅ 63 columnas, **7.175.029 registros, 5.761.561.287 bytes** |
| Lectura aleatoria al final de `FADITE` (offset 7.175.028) | ✅ `IFSUCUR=11 … IFFACT=PE06123576 … IFCAJA=06, IFVENDED=LMHA` |
| **Escritura** (POST insert en `DOMDIA`) | ✅ creó `recno=52497`; el **parser propio** (layout SAP) releyó los campos insertados exactos, incluido el UUID en `FACONTROL` |
| Montaje del directorio en **solo lectura** | ❌ `tx journal not writable in '/data'` → **requiere carpeta escribible** |
| Importar diccionario SAP (`.add`) | ❌ `openads_import_dd` exige la **librería ACE de SAP** (`libace64.so`), no disponible |

**Validación cruzada clave**: los valores leídos por OpenADS coinciden
**exactamente** con los que devuelve nuestro parser independiente
(`scripts-agent/adt-*.mjs`) sobre los mismos archivos — incluida la tabla de
5,5 GB y el registro que OpenADS escribió y luego releímos. Es decir, la
fidelidad con el formato Advantage es real, no aproximada.

Ejemplo (última fila de `FADITE`, leída por ambos caminos):

```
IFSUCUR=11  IFANO=2026  IFMES=9  IFCLIENTE=24308535  IFFACT=PE06123576
IFARTIC=101170100134535  IFNOMBRE=HUEVO 100% HUEVO ROJO AAX45UN
IFCANT=1  IFVLRUNI=22500  IFVLRNET=22500  IFFECHA=20260930
IFCAJA=06  IFTIPO=E  IFVENDED=LMHA
```

## 4. Hallazgos que afectan el plan de integración

1. **Sí podemos montar la base y dockerizarla.** Las tablas del ERP son
   *free tables* (sin diccionario) y OpenADS las maneja nativamente → es viable
   un **read-model**: una réplica montada en Linux que alimenta Postgres.
2. **Necesita directorio escribible** (crea locks y journal). La copia de datos
   debe ser de trabajo, nunca el original en solo lectura.
3. **Sensible a mayúsculas de archivo** en Linux (`TIDCATE.ADT` ≠ `TIDCATE.adt`).
   Hay que normalizar los nombres o respetar el case exacto.
4. **Los diccionarios SAP (`.add`) no son utilizables** sin la librería de SAP.
   Afecta solo a `PUBLIDATA`; nuestras tablas no lo necesitan.
5. **Triggers: requieren diccionario.** Nuestras tablas son *free tables*, así
   que para triggers habría que crear un diccionario OpenADS y registrar las
   tablas. Además, según la documentación del proyecto:
   - Los `UPDATE`/`DELETE` por SQL disparan el trigger **una vez por lote**, no
     por fila (los navegacionales, sí por registro).
   - **No hay detección de deadlocks** y la anidación se corta a 64 niveles.
   - Hay tablas virtuales `__new`, `__old`, `__error` (muy útiles para la cola).
6. **El Studio listaba solo `.dbf`** (las `.adt` solo se abrían por nombre,
   `/api/tables/<nombre>`). **Parcheado** (ver §8, punto 3): ahora la consola
   lista también las `.adt`. No era limitación del motor.
7. **Sin TLS nativo en el listener** y credenciales en claro → LAN + firewall
   (el log lo advierte explícitamente).
8. **Aviso del propio proyecto**: los huecos de paridad de diccionario y control
   de acceso hacen que los despliegues multiusuario con datos no confiables sean
   **experimentales**. Nuestro caso (datos propios, LAN, y sobre todo **lectura**)
   está dentro de lo razonable; la escritura en producción debe ir con cuidado.

## 5. Escenarios que habilita

**Escenario A — réplica de lectura (recomendado, bajo riesgo)**

```
ERP (Windows, SAP ADS vivo)
   └─ rsync/SMB periódico ──▶ copia escribible en Linux
                                 └─ OpenADS en Docker ──▶ API/SQL ──▶ Postgres
```

- Sirve para el sentido **ERP → Postgres** (catálogo, precios, stock, facturas).
- No toca el ERP. Encaja con la "Opción 1" del plan (`docs/PLAN-INTEGRACION-ERP.md`).
- La captura de cambios se hace por **diff con hash** (no hay triggers en free
  tables), que es justo el plan B ya previsto.

**Escenario B — migrar el ERP a OpenADS (ambicioso)**

- Reemplazar `ace64.dll` por el de OpenADS en el ERP (Harbour/FiveWin es el
  público objetivo del proyecto) → Linux/Docker de punta a punta, triggers y
  escritura directa.
- Requiere pruebas de compatibilidad del ERP real antes de considerar producción.

## 6. Riesgos

| Riesgo | Mitigación |
|---|---|
| Proyecto joven (repo pequeño, ADT soportado desde rc28) | Ya validado contra nuestras tablas; mantener el parser propio como referencia cruzada |
| Dos motores sobre los mismos archivos (SAP ADS + OpenADS) | **Nunca** apuntar ambos al mismo directorio; usar copia |
| Escritura en producción | Probar primero contra copia; idempotencia y transacciones |
| Triggers incompletos (por lote, sin deadlocks) | Preferir diff con hash para la captura |
| Sin TLS | Red aislada + proxy TLS |

## 7. Siguientes pasos sugeridos

1. Probar `rsync`/SMB de la réplica y medir el diff de `TIDSAL` (133 MB).
2. Definir el layout de la copia de trabajo (nombres de archivo normalizados).
3. Conectar el **cliente** (la imagen trae `libopenace64.so`; falta un binding
   para Node: usar `openads_serverd` + HTTP/REST, o un sidecar en Python/PHP).
4. Decidir entre Escenario A y B para la **escritura** de pedidos.

## 8. Conector en uso: correcciones y sync de catálogo

> Fecha: 2026-10-08 (conector). Punto 3 y nota de DA-Web añadidos el 2026-10-10.

Tres correcciones sobre el binario de OpenADS (build propio, `src/` gitignored),
en `src/tools/serverd/http_server.cpp`:

1. **`POST /api/sql` devolvía 500** con cualquier texto latin-1 (p. ej. `Ñ`).
   El materializador de celdas hacía `std::string` con los bytes crudos y el
   serializador JSON de nlohmann lanzaba `type_error.316`. Se añadió
   `latin1_to_utf8_trimmed()` (transcodifica latin-1 → UTF-8; si ya es UTF-8
   válido lo deja igual) y se usa en `run_sql`.
2. **`/api/sql` no tenía `offset`**. Se añadió `offset` al endpoint y a `run_sql`
   (`AdsSkip` antes de materializar), para poder paginar tablas grandes
   proyectando solo las columnas necesarias (ej. `TIDSAL`, 51.938 filas).
3. **El navegador de tablas del Studio listaba solo `.dbf`**, así que las
   tablas Advantage del ERP (`.adt`) no aparecían en la interfaz (había que
   abrirlas por nombre). En `tools/serverd/http_server.cpp`, función
   `list_dbf_files`:

   ```cpp
   if (ext == ".dbf" || ext == ".adt")   // antes: if (ext == ".dbf")
   ```

   Tras el parche, `GET /api/tables` devuelve las 17 tablas `.adt` y el Studio
   las muestra en la barra lateral (Browse/Structure/Insert/SQL/export).

**Reconstrucción y despliegue del binario parcheado**: `src/` y `build/` están
**gitignored**, así que el parche no se versiona y hay que reaplicarlo en un
clon nuevo. Pasos:

```bash
# 1. aplicar el cambio de una línea en:
#    db/ads/openads/src/tools/serverd/http_server.cpp
# 2. compilar (incremental) y verificar
bash db/ads/openads/build.sh
# 3. inyectar en el contenedor vivo y reiniciar
#    (o usar la ruta canónica de la imagen, abajo)
docker cp db/ads/openads/build/tools/serverd/openads_serverd \
  openads-img:/opt/openads/openads_serverd
docker restart openads-img
```

Ruta canónica (reconstruye la imagen desde el fuente, ~5–10 min):

```bash
docker build -t mercaldas/openads:1.09.73 -f db/ads/openads/Dockerfile db/ads/openads
```

Detalle y mantenimiento del parche: `db/ads/openads/README.md` §*Parche local*.

> **Alternativa evaluada: DA-Web** (`FiveTechSoft/OpenADS/DA-Web`). Es otra
> consola, pero enlaza el motor **en proceso** vía `php_openads.dll` +
> `openace64.dll` sobre **PHP 8 + Apache en Windows**, y soporta *free tables*
> (`.adt`). No sirve para este entorno Linux/Docker (no es cliente del server
> OpenADS); tendría sentido solo en el **PC Windows del ERP**. Para Linux, la
> consola Studio parcheada cubre el mismo caso.

### 8.1 Catálogos de códigos poblados (`erp_code_map`)

`node scripts-agent/erp/sync-codes.mjs` (tras el fix del 500):

| domain | códigos | tabla ERP |
|---|---:|---|
| brand | 2.175 | `tidmarcas` |
| city | 1.647 | `posdane` |
| product_type | 363 | `tidtpro` |
| tax | 56 | `tidtipos` |
| payment_method | 45 | `pospago` |
| warehouse | 3 | `tidbode` |

### 8.2 Sync de catálogo ERP → Postgres (`sync-catalog.mjs`)

`node scripts-agent/erp/sync-catalog.mjs` — modelo **diff por huella**: lee
`TIDSAL` por SQL paginado, calcula un hash (SHA-1) por fila y lo compara con
`erp_snapshot`; solo re-escribe los artículos con alguna fila cambiada.
Soporta `--dry-run`, `--limit=N`, `--reset-snapshot`, `--stock-default=N`.

Resultado de la corrida completa (51.938 filas = 21.613 artículos × hasta 3
sucursales):

| Destino | Filas |
|---|---:|
| `products` / `product_variants` | 21.613 / 21.613 |
| `prices` | 49.036 |
| `inventory` / `branch_products` | 51.938 / 51.938 |
| `erp_snapshot` | 51.938 |

La segunda corrida detecta **0 cambios** (idempotente).

**Decisiones de mapeo confirmadas con datos:**

- **Marca = `INMARCAP`** (nombre de texto; coincide con `TIDMARCAS.MNOMBRE` en
  33.741 filas y con el nombre del producto). `INMARCA` viene poblado en el
  **100%** de las filas y siempre resuelve a un `MCODIGO`, pero apunta a marcas
  **sin relación** con el artículo → **no se usa** como fuente (respaldo).
- **Stock = `INSALDO00` real** por sucursal (por defecto). `--stock-default=999`
  fuerza el valor fijo que se había usado antes.
- **Tipo de producto = `INTIPO`** → `product_types`; **categoría** = prefijos del
  código de artículo sobre el árbol `TIDTAB` (igual que el import previo);
  `INCATE` (árbol real `tidcate`) se guarda como atributo `Categoría ERP (INCATE)`.
- Solo hay **una bodega** (`INBODEGA='00'`) por sucursal → el grano
  artículo×sucursal coincide con nuestro modelo.
- `INEAN` (código de barras) se deduplica **por artículo**; se conservan 21.189
  códigos y se anulan 424 duplicados reales.
- **Merge no destructivo** (`COALESCE`): al re-sincronizar (p. ej.
  `--reset-snapshot`, que recorre todos los artículos) los campos que el ERP no
  trae (`NULL`) **no** pisan el valor existente en Postgres. Imágenes, banners,
  popups y demás datos locales viven en otras tablas y **no se tocan**.

### 8.3 Salida Postgres → ERP (`push-orders.mjs`)

`node scripts-agent/erp/push-orders.mjs` escribe pedidos en el ERP (`DOMDIA` +
`DOMITE`, mapeo §4.4). Idempotente por `FACONTROL = orders.reference_code`
(se comprueba en el ERP antes de insertar; si ya está, se salta). Marca
`orders.erp_sync_status`/`erp_document_ref` y deja rastro en `erp_outbox`.
Flags: `--dry-run`, `--limit=N`, `--order=ID`, `--force`.

Validado contra la copia: pedidos insertados y releídos; la cabecera cuadra
(`subtotal + domicilio(FAVARIOS) = grand_total = pago`); `IFARTIC`/`IFEAN` se
resuelven por `product_variants` (la copia de `order_items.variant_sku` puede
venir vacía); reintentar un pedido ya enviado → “ya en el ERP”.

**Lote del piloto enviado**: `node scripts-agent/erp/push-orders.mjs --limit=200`
→ **80 aplicados, 0 fallidos** (más los 7 previos = **87 pedidos** con
`erp_sync_status='sent'`). Los **11 pedidos restantes** son `cancelled`/`refunded`
y el script los excluye a propósito (`WHERE status NOT IN ('cancelled','refunded')`),
por lo que quedan sin `FACONTROL` (correcto). Verificado en el ERP: `DOMDIA` con
`FACONTROL LIKE 'DEMO-%'` = 85 filas; p. ej. pedido 502 → `FAVLRBRU 57310.91 +
FAVLRIVA 10889.09 = 68200` (base de líneas) y `FAVARIOS 7900` → `FAVLRNET 76100`
(= pago). Pendiente de confirmar con el ERP (§11 del plan): numeración
`FAPEDIDO`, `FAESTADO`/`IFESTADO`, `FATIPODOM` y el tratamiento del envío.

### 8.4 Entrada de clientes (`sync-customers.mjs`)

`node scripts-agent/erp/sync-customers.mjs` trae los clientes de `POSCLI`
(146.371 filas) a `customers` con el mismo modelo: diff por huella
(`erp_snapshot`, `erp_table='POSCLI'`) y merge no destructivo. Identidad
`CODCLI` → `erp_customer_code` / `provider_id` (`provider='ERP'`).

- `customers.email` es NOT NULL y UNIQUE → si el ERP no trae email (o choca con
  otro cliente) se sintetiza `<CODCLI>@erp.mercaldas.local`.
- `FECHABAJA` no se usa (poblado en el 99,9% y su significado sin confirmar);
  `BLOQUE` sólo toma `''`/`'F'` → todos activos.
- Resultado: **146.318** clientes ERP (44 locales intactos), 0 emails duplicados.
- Requisito: `POSCLI` (`.adt`+`.adi`) debe estar en la carpeta de datos de
  OpenADS (`db/ads/openads/data`); el sembrado inicial no lo incluía.

### 8.5 Entrada de facturación (`sync-invoices.mjs`)

`node scripts-agent/erp/sync-invoices.mjs` espeja la facturación del ERP:
`FADDIA` → `erp_invoices` (**1.167.637**) y `FAPAGO` → `erp_payments`
(**2.140.937**).

- **No** son las tablas `invoices`/`payments`: ésas son del pedido web
  (`order_id NOT NULL`). Las facturas del ERP (POS + domicilio) no están atadas a
  nuestras órdenes, por eso van a un espejo propio.
- Clave = **hash de la fila completa** (no hay id único: `FPAUTO`/`FPNUMERO`
  vienen vacíos y hay Nº de factura repetidos). Re-ejecutar es idempotente
  (`ON CONFLICT (erp_key) ... WHERE row_hash IS DISTINCT FROM`); los duplicados
  exactos se colapsan (166 en `FAPAGO`).
- 16.624 facturas traen `FADOMICIL` (canal domicilio); el resto son ventas POS.
  Medios de pago vistos: `EFEC`, `DA`, `TD`, `TC`, `WR`, `RP`, `TR`, `MP`, `SI`…
- Requisito: `FADDIA`/`FAPAGO` en la carpeta de datos de OpenADS.
- Pendiente: conciliación pedido↔factura (mapeo §4.5 del plan) cuando el ERP
  facture nuestros pedidos; `FADITE` (5,7 GB) queda fuera (detalle de línea).

---

### Anexo — comandos útiles

```bash
# construir (host sin cmake, usa Docker)
bash db/ads/openads/build.sh

# imagen final
docker build -t mercaldas/openads:1.09.73 -f db/ads/openads/Dockerfile db/ads/openads

# arrancar con compose
cd db/ads/openads && docker compose up -d

# API Studio
curl -u dsi:dsi http://localhost:18080/api/health
curl -u dsi:dsi "http://localhost:18080/api/tables/TIDSAL.adt/schema"
curl -u dsi:dsi "http://localhost:18080/api/tables/TIDMARCAS/rows?limit=5"
```
