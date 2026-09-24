#!/usr/bin/env python3
"""Genera el diccionario de datos de TIDSAL (json) con significado aproximado
de cada columna.

Los metadatos (nombre, tipo, bytes, offset) se extraen del header del .adt;
los significados son una propuesta aproximada (revisar los marcados como
"confianza" media/baja = 'IN x'/'INACTIVO'/etc. segun el campo).

Uso:
    python3 scripts-agent/tidsal-dict.py \
        db/ADD_CONTAB/TIDSAL.adt \
        docs/TIDSAL-diccionario-datos.json
"""
import json
import struct
import sys
from datetime import date
from pathlib import Path

DESC = 200
BASE = 0x190

TYPE_NAMES = {
    0x01: "logico",
    0x04: "char",
    0x0A: "numeric(8B)",
    0x0B: "int32",
    0x0C: "bin(2B)",
}


def u16(b, o):
    return struct.unpack_from("<H", b, o)[0]


def u32(b, o):
    return struct.unpack_from("<I", b, o)[0]


# ---------------------------------------------------------------- significados
# name -> [significado aproximado, confianza (alta|media|baja)]
EXPLICIT = {
    "INSUC": ["Codigo de sucursal (empresa/tienda)", "alta"],
    "INBODEGA": ["Codigo de bodega / almacen dentro de la sucursal", "alta"],
    "INARTIC": ["Codigo interno del articulo (PLU)", "alta"],
    "NUMERO": ["Numero consecutivo del registro", "media"],
    "INEAN": ["Codigo de barras EAN del articulo", "alta"],
    "INEANC": ["Codigo de barras alterno / corto", "media"],
    "INPARTE": ["Numero de parte / referencia del fabricante", "media"],
    "INNOMBRE": ["Nombre o descripcion del articulo", "alta"],
    "INNOMBRE3": ["Nombre corto del articulo (etiquetas/tickets)", "media"],
    "INUNIDAD": ["Unidad de medida (UN, KG, LT, ...)", "alta"],
    "INPROVEE": ["Codigo del proveedor principal", "alta"],
    "INTIPO": ["Codigo de tipo de articulo (clasificacion)", "media"],
    "INEMBALAJE": ["Factor de empaque (unidades por empaque)", "media"],
    "INTIMP": ["Codigo de tipo de impuesto", "media"],
    "INIMPC": ["Porcentaje del impuesto (IVA) vigente", "alta"],
    "INIMP3": ["Porcentaje de un segundo/tercer impuesto", "media"],
    "INTIPINV": ["Tipo/clase de inventario (clasificacion contable)", "media"],
    "INMINIMO": ["Existencia minima (stock minimo)", "alta"],
    "INMAXIMO": ["Existencia maxima (stock maximo)", "alta"],
    "INVRULTC": ["Ultimo costo / costo de reposicion unitario", "alta"],
    "INFCHULTC": ["Fecha del ultimo costo (formato YYYYMMDD)", "alta"],
    "INFCUSAL1": ["Fecha de causacion / ultimo movimiento (YYYYMMDD)", "media"],
    "INUBIC": ["Ubicacion fisica en la bodega", "alta"],
    "INCOMPRO": ["Comprobante / marca interna de compra (uso interno)", "baja"],
    "INCONVER": ["Factor de conversion de unidad (venta fraccionada/peso)", "media"],
    "INTREPOS": ["Indicador de reposicion automatica (0/1)", "media"],
    "INPESO": ["Indicador: el articulo se vende por peso", "alta"],
    "INFPRECIO": ["Indicador de manejo de precio (libre/fijo)", "baja"],
    "INFORMULA": ["Codigo de formula para calcular el precio", "media"],
    "INOUT": ["Indicador IN/OUT (estado en catalogo/rotacion)", "baja"],
    "INCOSTO00": ["Costo actual (costo base)", "alta"],
    "INSALDO00": ["Existencia / saldo actual en la sucursal-bodega", "alta"],
    "INSALDO002": ["Saldo alterno (segunda bodega / contable)", "media"],
    "INRETEN": ["Codigo de retencion aplicable", "media"],
    "INARTICES": ["Referencia cruzada del articulo (equivalente en otra empresa/lista)", "baja"],
    "INFINANCIA": ["Indicador financiero / financiacion", "baja"],
    "INASALDO": ["Indicador de actualizacion de saldo", "baja"],
    "INTRANSF": ["Articulo destino en transferencia (mismo formato que INARTIC)", "media"],
    "INCPESO": ["Costo/precio por peso (por kg)", "baja"],
    "INMARCA": ["Marca del articulo", "alta"],
    "INFRACC": ["Factor de fraccionamiento (venta por fraccion)", "baja"],
    "INVLFRA": ["Valor / precio de la fraccion", "baja"],
    "INPRESEN": ["Codigo de presentacion del empaque", "media"],
    "INBLOQUEO": ["Indicador de articulo bloqueado", "media"],
    "INVTACOS": ["Permitir venta al costo", "media"],
    "INACTIVO": ["Estado del articulo (activo/inactivo) en la sucursal", "alta"],
    "INFECHA": ["Fecha de creacion / ultima modificacion (YYYYMMDD)", "media"],
    "INBLOCOM": ["Bloquear compras del articulo", "media"],
    "INAPLIDCTO": ["Indicador de aplicacion de descuentos", "media"],
    "INPTOPOS": ["Punto de pedido / reorden", "alta"],
    "INEAN14": ["Codigo de barras EAN-14 (caja/empaque)", "alta"],
    "INTIPOFRA": ["Tipo de fraccionamiento (clase de venta fraccionada)", "baja"],
    "INPROTOR": ["Proveedores adicionales / texto libre de proveedores", "baja"],
    "INCUM": ["Campo auxiliar (posible registro sanitario / CUM) - verificar", "baja"],
    "ININVIMA": ["Registro sanitario INVIMA", "alta"],
    "INMARCAP": ["Marca propia / marca del proveedor (marca privada)", "baja"],
    "INNOMBRE4": ["Nombre largo del articulo (para facturacion)", "media"],
    "INWEB": ["Publicado en el catalogo web (T/F)", "alta"],
    "INFCHREG": ["Fecha de registro (numerica YYYYMMDD)", "media"],
    "INGARANTIA": ["Texto / codigo de garantia", "media"],
    "INARTOFER": ["Articulo asociado a oferta", "media"],
    "INSUBEPRE": ["Indicador para subir/aplicar precio automaticamente", "baja"],
    "INREGIMPC": ["Regimen de impuesto (responsable/no responsable de IVA)", "media"],
    "INSALDOWEB": ["Existencia disponible para la web", "alta"],
    "INGSALWEB": ["Indicador de manejo de saldo web", "media"],
    "INBOTONG": ["Indicador de visualizacion de boton en POS", "baja"],
    "INDCTO3X2": ["Indicador de descuento 3x2", "media"],
    "INIMPCOSTO": ["Indicador: el impuesto se calcula sobre el costo", "media"],
    "INTIENDAB": ["Indicador de tienda B / catalogo alterno", "baja"],
    "INCCOSTO": ["Centro de costo (codigo)", "media"],
    "INCOSIVA": ["Indicador de costo incluye / no IVA", "media"],
    "INEMBALAJE2": ["Segundo factor de empaque (alterno)", "media"],
    "INPORIMC": ["Porcentaje del impuesto (alterno)", "media"],
    "INFAMIS": ["Indicador de agrupacion por familia", "baja"],
    "SACATWEB": ["Sacar el articulo del catalogo web", "media"],
    "INALTO": ["Alto (dimensiones del articulo)", "media"],
    "INANCHO": ["Ancho (dimensiones del articulo)", "media"],
    "INLARGO": ["Largo (dimensiones del articulo)", "media"],
    "INAPP": ["Visible en la app movil", "media"],
    "INESCA": ["Codigo de escala (bascula)", "media"],
    "INOPLOG": ["Indicador de operacion logistica", "baja"],
    "INVTACAF": ["Indicador de venta (canal cafeteria/otro)", "baja"],
    "INFINVIMA": ["Fecha del registro INVIMA", "media"],
    "INWEBSER": ["Visible en el portal web de servicios", "media"],
    "INDOMICOM": ["Habilitado para domicilio / comercio electronico", "media"],
    "INDOMIURL": ["URL de pedidos / domicilio", "media"],
    "INIUM1": ["Identificador de ubicacion/medida 1", "baja"],
    "INIUM2": ["Identificador de ubicacion/medida 2", "baja"],
    "INIUM3": ["Identificador de ubicacion/medida 3", "baja"],
    "INDOMIRAP": ["Habilitado para domicilio expres / rapido", "baja"],
    "ARTICDSI": ["Indicador de articulo integrado con DSI", "baja"],
    "INCATE": ["Codigo de categoria", "alta"],
    "ETIDIG": ["Indicador de etiqueta digital", "baja"],
    "ETI_IDP": ["ID de plantilla de etiqueta de precio", "media"],
    "ETI_PUM": ["Plantilla de etiqueta de unidad de medida", "baja"],
    "ETI_TEMPL1": ["Plantilla de etiqueta 1", "baja"],
    "ETI_TEMPL2": ["Plantilla de etiqueta 2", "baja"],
    "ETI_IDT": ["ID de plantilla de etiqueta", "baja"],
    "ININACVER": ["Indicador de inactivacion (verificacion/version)", "baja"],
    "INETISEC": ["Seccion / sector de etiqueta", "baja"],
    "INULTRAP": ["Indicador de ultima reposicion", "baja"],
    "INIMP4": ["Porcentaje de un cuarto impuesto", "baja"],
    "INMETCOMP": ["Metodo / codigo de compra", "baja"],
    "INFCHVIGMC": ["Fecha de vigencia del metodo de compra", "baja"],
    "INCLACOMP": ["Clase de compra", "baja"],
    "INUMINIDES": ["Cantidad minima de despacho / venta", "media"],
    "INABC": ["Clasificacion ABC (rotacion)", "media"],
    "INRESERV": ["Cantidad reservada", "alta"],
    "INSEMANA": ["Semana (codigo de semana de pedido)", "baja"],
    "INPRONOSTI": ["Pronostico de demanda / ventas", "media"],
    "INSTOCKPR": ["Stock proyectado", "media"],
    "INLARGO14": ["Largo para EAN-14 (caja)", "baja"],
    "INANCHO14": ["Ancho para EAN-14 (caja)", "baja"],
    "INALTO14": ["Alto para EAN-14 (caja)", "baja"],
    "INPESO14": ["Peso para EAN-14 (caja)", "baja"],
    "INESTADO": ["Estado del articulo (texto)", "media"],
    "INCATECO": ["Categoria economica / contable", "media"],
    "INANALI": ["Codigo de analisis", "baja"],
    "INCATCOM": ["Categoria comercial", "media"],
    "INCASACOM": ["Casa comercial", "media"],
}

# Patrones repetitivos (precios, margenes, historicos por sucursal, etc.)
SIG = {}
SIG.update(EXPLICIT)

# Precios de venta lista 1..9 y el 10 (VRVENTA0)
for i in range(1, 10):
    SIG.setdefault(f"INVRVENTA{i}", [f"Precio de venta lista {i}", "alta"])
SIG.setdefault("INVRVENTA0", ["Precio de venta lista 10 (decimo precio)", "media"])

# Margenes de ganancia por precio: INGANAN (precio 1), INGANAN2..INGANAN9
SIG.setdefault("INGANAN", ["Margen / ganancia % para el precio 1", "media"])
for i in range(2, 10):
    SIG.setdefault(f"INGANAN{i}", [f"Margen / ganancia % para el precio {i}", "media"])

# Bloques historicos por sucursal 01..13 (I=inventario, E=entrada, S=salida,
# U=unidades, V=valor)
for n in range(1, 14):
    s = f"{n:02d}"
    SIG.setdefault(f"IEU{s}", [f"Entradas en unidades - sucursal {s} (historico)", "media"])
    SIG.setdefault(f"IEV{s}", [f"Entradas en valor - sucursal {s} (historico)", "media"])
    SIG.setdefault(f"ISU{s}", [f"Salidas en unidades - sucursal {s} (historico)", "media"])
    SIG.setdefault(f"ISV{s}", [f"Salidas en valor - sucursal {s} (historico)", "media"])


# Ventas acumuladas por periodo/mes (13 periodos)
for n in range(1, 14):
    SIG.setdefault(f"VTA{n:02d}", [f"Ventas acumuladas del periodo/mes {n} (historico)", "media"])


# Descripciones de marca
for i in range(1, 10):
    SIG.setdefault(f"DESMAR{i}", [f"Descripcion de marca {i} (texto libre)", "media"])


# Codigos de actividad/clasificacion
for i in range(1, 21):
    SIG.setdefault(f"INACTI{i}", [f"Codigo de actividad / clasificacion {i}", "baja"])


# Indicadores R (retenciones/regimen)
for i in range(1, 6):
    SIG.setdefault(f"INR{i}", [f"Indicador R{i} (retencion / regimen)", "baja"])


# Campos modificadores/auxiliares
for i in range(1, 6):
    SIG.setdefault(f"MODI{i}", [f"Campo modificador / auxiliar libre {i}", "media"])


# Saldos por sucursal S01..S53
for n in range(1, 54):
    SIG.setdefault(f"S{n:02d}", [f"Saldo / existencia en la sucursal {n:02d}", "media"])


def main():
    src = Path(sys.argv[1])
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else None

    data = src.read_bytes()
    hdr_len = u32(data, 0x20)
    rec_len = u32(data, 0x24)
    rec_count = u32(data, 0x18)
    header = data[:hdr_len]
    nfields = (hdr_len - BASE) // DESC

    columnas = []
    sin_significado = []
    for i in range(nfields):
        d = header[BASE + i * DESC:BASE + (i + 1) * DESC]
        name = d[:0x80].split(b"\0", 1)[0].decode(errors="replace")
        if not name:
            continue
        tcode = d[0x81]
        offset = u16(d, 0x83)
        length = d[0x87]
        decimals = d[0x88]
        meaning = SIG.get(name)
        if meaning is None:
            sin_significado.append(name)
            meaning = ["(sin significado asignado)", "baja"]
        columnas.append({
            "idx": len(columnas),
            "columna": name,
            "tipo": TYPE_NAMES.get(tcode, f"?0x{tcode:02x}"),
            "bytes": length,
            "decimales": decimals,
            "offset": offset,
            "significado": meaning[0],
            "confianza": meaning[1],
        })

    doc = {
        "tabla": src.stem,
        "sistema": "TID (contabilidad/inventario)",
        "archivo_fuente": str(src),
        "descripcion": ("Articulos y sus saldos/existencias por sucursal y "
                        "bodega (una fila por articulo+sucursal+bodega)."),
        "registros": rec_count,
        "longitud_registro": rec_len,
        "total_columnas": len(columnas),
        "generado": date.today().isoformat(),
        "nota": ("Los significados son APROXIMADOS; el campo 'confianza' "
                 "(alta/media/baja) indica su fiabilidad y deben corregirse "
                 "con el diccionario del sistema TID."),
        "convenciones": {
            "prefijo_IN": "Inventario / articulos (tabla de saldos)",
            "prefijo_IE": "Inventario - Entradas",
            "prefijo_IS": "Inventario - Salidas",
            "sufijo_U": "unidades",
            "sufijo_V": "valor",
            "IEU/IEV/ISU/ISV_0n": "historicos por sucursal 01..13",
            "VTA01..13": "ventas acumuladas por periodo/mes",
            "S01..S53": "saldos por sucursal",
            "fechas": "enteras en formato YYYYMMDD",
        },
        "columnas": columnas,
    }

    print(f"{src.name}: {rec_count:,} registros, {len(columnas)} columnas")
    if sin_significado:
        print("sin significado:", ", ".join(sin_significado))
    if out:
        out.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n",
                       encoding="utf-8")
        print(f"Escrito {out} ({len(columnas)} columnas)")

        # version reducida: solo { columna: significado }
        simple = out.with_name("TIDSAL-significados.json")
        simple.write_text(
            json.dumps({c["columna"]: c["significado"] for c in columnas},
                       ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8")
        print(f"Escrito {simple} (solo columna: significado)")


if __name__ == "__main__":
    main()
