# Comparación de esquema — FORTUNER vs integración ecommerce

Generado: 2026-10-22T15:07:55.628Z

Fuentes:

- **FORTUNER**: cabeceras de `C:\ADD_FORTUNER` (dsi-vps), solo metadatos.
- **Local**: `db/ads/openads/data/` (copia que usa la integración).
- **Escritura**: campos que usan `push-catalog.mjs`, `push-customers.mjs` y `push-orders.mjs`.

## 1. Esquema local vs FORTUNER

| Tabla | Campos FORTUNER | Campos local | Solo FORTUNER | Solo local | Dif. tipo/long |
|---|---:|---:|---|---|---|
| DOMDIA | 56 | 56 | — | — | — |
| DOMITE | 43 | 43 | — | — | — |
| FADDIA | 85 | 85 | — | — | — |
| FAPAGO | 20 | 20 | — | — | — |
| POSCLI | 89 | 89 | — | — | — |
| POSDANE | 2 | 2 | — | — | — |
| POSPAGO | 50 | 50 | — | — | — |
| TIDBODE | 103 | 103 | — | — | — |
| TIDCATE | 13 | 13 | — | — | — |
| TIDEAN | 6 | 6 | — | — | — |
| TIDGON | 5 | 5 | — | — | — |
| TIDMARCAS | 2 | 2 | — | — | — |
| TIDOBSER | 8 | 8 | — | — | — |
| TIDSAL | 304 | 304 | — | — | INCATE(char/6 vs char/7) |
| TIDTAB | 65 | 65 | — | — | — |
| TIDTIPOS | 14 | 14 | — | — | — |
| TIDTPRO | 12 | 12 | — | — | — |

## 2. Campos que escribe la integración

| Tabla | Campo | Tipo FORTUNER | ¿Existe? | Uso nuestro | Riesgo |
|---|---|---|---|---|---|
| TIDSAL | INARTIC | char(19) | sí | recorte 19 | ok (recorte 19 ≤ 19) |
| TIDSAL | INNOMBRE | char(60) | sí | recorte 60 | ok (recorte 60 ≤ 60) |
| TIDSAL | INVRVENTA1 | double(8) | sí | — | ok |
| TIDSAL | INVRVENTA0 | double(8) | sí | — | ok |
| TIDSAL | INSALDO00 | double(8) | sí | — | ok |
| TIDSAL | INSUC | double(8) | sí | — | ok |
| TIDMARCAS | MCODIGO | char(8) | sí | recorte 8 | ok (recorte 8 ≤ 8) |
| TIDMARCAS | MNOMBRE | char(80) | sí | recorte 80 | ok (recorte 80 ≤ 80) |
| TIDTAB | CTABCOD | char(7) | sí | recorte 7 | ok (recorte 7 ≤ 7) |
| TIDTAB | CTABDES | char(45) | sí | recorte 45 | ok (recorte 45 ≤ 45) |
| TIDTPRO | CODIGO | char(3) | sí | recorte 3 | ok (recorte 3 ≤ 3) |
| TIDTPRO | NOMBRE | char(30) | sí | recorte 30 | ok (recorte 30 ≤ 30) |
| TIDTPRO | HABILITA | logical(1) | sí | — | ok |
| POSCLI | NOMCLI | char(40) | sí | recorte 40 | ok (recorte 40 ≤ 40) |
| POSCLI | NOMBRE | char(50) | sí | recorte 50 | ok (recorte 50 ≤ 50) |
| POSCLI | APELLIDO | char(50) | sí | recorte 50 | ok (recorte 50 ≤ 50) |
| POSCLI | CEDCLI | char(10) | sí | recorte 10 | ok (recorte 10 ≤ 10) |
| POSCLI | TIPODOC | char(2) | sí | recorte 2 | ok (recorte 2 ≤ 2) |
| POSCLI | EMAIL | char(50) | sí | recorte 50 | ok (recorte 50 ≤ 50) |
| POSCLI | TELCELU | char(12) | sí | recorte 12 | ok (recorte 12 ≤ 12) |
| POSCLI | SUCURSAL | char(3) | sí | recorte 3 | ok (recorte 3 ≤ 3) |
| POSCLI | ORIGENW | char(1) | sí | recorte 1 | ok (recorte 1 ≤ 1) |
| POSCLI | BLOQUE | logical(1) | sí | — | ok |
| DOMDIA | FASUCUR | char(3) | sí | recorte 3 | ok (recorte 3 ≤ 3) |
| DOMDIA | FAFACTURA | char(12) | sí | recorte 12 | ok (recorte 12 ≤ 12) |
| DOMDIA | FAPEDIDO | char(12) | sí | recorte 9 | ok (recorte 9 ≤ 12) |
| DOMDIA | FACODIGO | char(13) | sí | recorte 13 | ok (recorte 13 ≤ 13) |
| DOMDIA | FANOMBRE | char(45) | sí | recorte 45 | ok (recorte 45 ≤ 45) |
| DOMDIA | FADIREC | char(60) | sí | recorte 60 | ok (recorte 60 ≤ 60) |
| DOMDIA | FACIUDAD | char(12) | sí | recorte 12 | ok (recorte 12 ≤ 12) |
| DOMDIA | FATELEF | char(15) | sí | recorte 15 | ok (recorte 15 ≤ 15) |
| DOMDIA | FACELU | char(15) | sí | recorte 15 | ok (recorte 15 ≤ 15) |
| DOMDIA | FANIT | char(15) | sí | recorte 15 | ok (recorte 15 ≤ 15) |
| DOMDIA | FAEMAIL | char(50) | sí | recorte 50 | ok (recorte 50 ≤ 50) |
| DOMDIA | FAFCHFAC | int32(4) | sí | — | ok |
| DOMDIA | FATIME | char(8) | sí | recorte 8 | ok (recorte 8 ≤ 8) |
| DOMDIA | FAVLRBRU | double(8) | sí | — | ok |
| DOMDIA | FAVLRDES | double(8) | sí | — | ok |
| DOMDIA | FAVLRIVA | double(8) | sí | — | ok |
| DOMDIA | FAVARIOS | double(8) | sí | — | ok |
| DOMDIA | FAVLRNET | double(8) | sí | — | ok |
| DOMDIA | FAPAG01 | char(2) | sí | recorte 2 | ok (recorte 2 ≤ 2) |
| DOMDIA | FAVLR01 | double(8) | sí | — | ok |
| DOMDIA | FAPAG02 | char(2) | sí | recorte 2 | ok (recorte 2 ≤ 2) |
| DOMDIA | FAVLR02 | double(8) | sí | — | ok |
| DOMDIA | FAPAG03 | char(2) | sí | recorte 2 | ok (recorte 2 ≤ 2) |
| DOMDIA | FAVLR03 | double(8) | sí | — | ok |
| DOMDIA | FATIPODOM | char(2) | sí | recorte 2 | ok (recorte 2 ≤ 2) |
| DOMDIA | FAESTADO | bin2(2) | sí | — | ok |
| DOMDIA | FAOBSER | char(250) | sí | recorte 250 | ok (recorte 250 ≤ 250) |
| DOMDIA | FACONTROL | char(36) | sí | recorte 36 | ok (recorte 36 ≤ 36) |
| DOMITE | IFFACT | char(12) | sí | recorte 12 | ok (recorte 12 ≤ 12) |
| DOMITE | IFPEDIDO | char(9) | sí | recorte 9 | ok (recorte 9 ≤ 9) |
| DOMITE | IFCLIENTE | char(13) | sí | recorte 13 | ok (recorte 13 ≤ 13) |
| DOMITE | IFARTIC | char(19) | sí | recorte 19 | ok (recorte 19 ≤ 19) |
| DOMITE | IFEAN | char(18) | sí | recorte 18 | ok (recorte 18 ≤ 18) |
| DOMITE | IFNOMBRE | char(60) | sí | recorte 60 | ok (recorte 60 ≤ 60) |
| DOMITE | IFCANT | double(8) | sí | — | ok |
| DOMITE | IFVLRUNI | double(8) | sí | — | ok |
| DOMITE | IFVLRBRU | double(8) | sí | — | ok |
| DOMITE | IFPORIVA | double(8) | sí | — | ok |
| DOMITE | IFVLRIVA | double(8) | sí | — | ok |
| DOMITE | IFVLRNET | double(8) | sí | — | ok |
| DOMITE | IFPORDES | double(8) | sí | — | ok |
| DOMITE | IFVLRDES | double(8) | sí | — | ok |
| DOMITE | IFESTADO | bin2(2) | sí | — | ok |
| DOMITE | IFFECHA | int32(4) | sí | — | ok |
| DOMITE | IFTIPO | char(2) | sí | recorte 2 | ok (recorte 2 ≤ 2) |
| DOMITE | IFSUCUR | char(3) | sí | recorte 3 | ok (recorte 3 ≤ 3) |
| DOMITE | IFBODEGA | char(2) | sí | recorte 2 | ok (recorte 2 ≤ 2) |

## 3. Riesgos detectados

Sin riesgos de longitud/tipo en los campos mapeados.

## 4. Notas de correspondencia

- **Categorías**: escribimos en `TIDTAB` (`CTABCOD` char(7), `CTABDES` char(45)). Existe además `TIDCATE` (13 campos, también `CTABCOD`/`CTABDES` + `CATE1..3`, `HABILITA`), que parece ser la tabla específica de categorías. Hay que confirmar cuál lee el ERP para el catálogo web.
- **Pedidos**: escribimos `DOMDIA`/`DOMITE` (domicilios). En FORTUNER existen `PEDDIA`/`PEDITE` (pedidos, casi vacías: 6 y 5 filas) con estructura parecida pero no idéntica. Confirmar si el ERP factura desde `DOM*` o espera `PED*`.
- **Ventas**: `VTADIA`/`VTAITE`/`VTAPAGO` son históricos/agregados de venta (825 cabeceras, 2.008.435 líneas, 8.555 pagos), no el punto de entrada de un pedido nuevo.
- **Facturación**: `FADDIA`/`FADITE`/`FAPAGO` siguen siendo la fuente de verdad para conciliación (1.167.637 / 7.175.029 / 2.141.129 filas).
- **Productos**: `TIDSAL` tiene 304 campos; nuestra escritura cubre nombre, precio 1/0 y saldo por sucursal. No hay INSERT de artículos nuevos (solo UPDATE por `INARTIC`).
- **Sucursal**: `TIDSAL.INSUC` es `double` (se escribe numérico). `DOMDIA.FASUCUR` y `DOMITE.IFSUCUR` son `char(3)` (se escriben como texto de 2 dígitos, p. ej. `01`).

## 5. Códigos cerrados y hallazgos abiertos

Cerrado con datos reales de FORTUNER (ver `docs/ESCRITURA-FORTUNER-READINESS.md`):

1. **Códigos generados**: `newErpCode` usa la longitud de la columna (`char(8)` marcas, `char(7)` categorías, `char(13)` clientes) con prefijo numérico `9`.
2. **Recortes**: `POSCLI.CEDCLI(10)`, `EMAIL(50)`, `NOMBRE/APELLIDO(50)`, `TELCELU(12)`, `TIDTAB.CTABDES(45)`, `TIDTPRO.NOMBRE(30)`, `TIDMARCAS.MNOMBRE(80)`.
3. **Tipos**: `TIDSAL.INSUC` y los `*ESTADO` bin2 se escriben numéricos; `FASUCUR`/`IFSUCUR` son char(3).
4. **Numeración**: `FAPEDIDO` = `IFPEDIDO` = 9 dígitos (prefijo web `9`); `FAFACTURA` vacía hasta que el ERP facture.
5. **Estados**: `FAESTADO` 0 pendiente / 5 cancelado / 9 facturado; `IFESTADO` vacío normal (0x8000 en disco) / 5 cancelado.
6. **Enlace de líneas**: por `IFPEDIDO` (no `IFFACT`); `IFFACT` queda vacío hasta la factura.
7. **Bodega**: `IFBODEGA=00` porque `TIDSAL.INBODEGA` es `00` en las 51.938 filas (bodega consolidada).
8. **Ciudad**: `POSDANE` no es un diccionario de ciudades (contiene EAN + nombres de producto); `FACIUDAD` es texto libre de 12.
9. **Envío**: va en `FAVARIOS`; `FAVLRFLE` está vacío en las filas reales.

Abierto (requiere decisión del ERP):

- **Categorías**: seguimos escribiendo en `TIDTAB`; `TIDCATE` parece el árbol de categorías del ERP (`CATE1..3`, `CARAC1..6`, `IMAGEN`, `HABILITA`). Confirmar cuál lee el catálogo web.
- **Pedidos**: `DOMDIA`/`DOMITE` (domicilios) vs `PEDDIA`/`PEDITE` (pedidos, casi vacías). Confirmar si el ERP factura desde `DOM*`.
- **Alta de artículos**: sólo hay UPDATE de `TIDSAL`; no se crean artículos nuevos.
- **Deriva de esquema**: `TIDSAL.INCATE` es `char(6)` en FORTUNER y `char(7)` en la copia local.

## 6. Conclusión

- Tablas locales comparadas: **17** (todas existen en FORTUNER).
- Campos mapeados revisados: **70**.
- Riesgos de longitud/tipo: **0**.
