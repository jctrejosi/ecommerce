/**
 * Significados de campos de FORTUNER (ERP TID / Advantage).
 *
 * Compartido por los generadores:
 *   - dict-fortuner.mjs      (copias .ADT locales)
 *   - dict-fortuner-ads.mjs  (base real en el servidor, via asqlcmd)
 *
 * La confianza indica qué tan fiable es el significado:
 *   alta  = confirmado por el uso en la integración o por el diccionario TIDSAL
 *   media = inferido de forma consistente (prefijos/sufijos, series)
 *   baja  = nombre críptico o sin uso observado
 *
 * OJO: el nombre completo y la descripción de cada TABLA viven en
 * `fortuner-tablas.mjs` (autoritativo). Las `descripcion` de este archivo sólo se
 * usan como respaldo para tablas que todavía no estén en ese mapa.
 */

export const LECTURA = {
  char: 'Texto de longitud fija.',
  'numeric(8B)': 'Numero de coma flotante de 8 bytes (double).',
  int32: 'Entero de 32 bits.',
  logical: 'Booleano (T/F).',
  bin2: 'Entero corto/binario de 2 bytes.',
  varchar: 'Texto de longitud variable (campo ADT tipo varchar).',
  memo: 'Texto largo (memo).',
  'date/time': 'Fecha/hora del motor.',
};

/** Tablas curadas manualmente. */
export const TABLAS = {
  TIDTPRO: {
    descripcion:
      'Tipos de producto (clasificacion comercial del articulo). El codigo es el que usa TIDSAL.INTIPO.',
    convenciones: {
      CODIGO: 'Codigo de 3 posiciones (p. ej. 026 = CONDIMENTOS).',
      TABLA: 'Apunta a la tabla/categoria parametrica (TIDTAB) asociada al tipo.',
    },
    relaciones: [
      { campo: 'CODIGO', referencia: 'TIDSAL.INTIPO', nota: 'Tipo de producto del articulo.', confianza: 'alta' },
      { campo: 'TABLA', referencia: 'TIDTAB.CTABCOD', nota: 'Categoria/linea asociada al tipo.', confianza: 'media' },
    ],
    exact: {
      CODIGO: ['Codigo del tipo de producto', 'alta'],
      NOMBRE: ['Nombre del tipo de producto', 'alta'],
      MARCA: ['Requiere marca', 'media'],
      TABLA: ['Codigo de tabla/categoria asociada', 'media'],
      HABILITA: ['Tipo habilitado', 'alta'],
      VALORMAX: ['Valor maximo permitido', 'baja'],
      PRODSI: ['Maneja producto SI/inventario', 'baja'],
      LAT: ['Latitud (uso auxiliar/etiquetas)', 'baja'],
      LON: ['Longitud (uso auxiliar/etiquetas)', 'baja'],
      OCULTA: ['Tipo oculto en la operacion', 'media'],
      ACUCANT: ['Acumulado de cantidad', 'baja'],
      ACUVLR: ['Acumulado de valor', 'baja'],
    },
  },

  TIDMARCAS: {
    descripcion: 'Maestro de marcas de articulos (codigo y nombre).',
    convenciones: { MCODIGO: 'Codigo de marca de 8 posiciones; en TIDSAL se referencia por INMARCA.' },
    relaciones: [
      {
        campo: 'MCODIGO',
        referencia: 'TIDSAL.INMARCA',
        nota: 'OJO: en la copia estudiada INMARCA trae codigos que no coinciden con este maestro; el nombre real del articulo viene en INMARCAP.',
        confianza: 'baja',
      },
    ],
    exact: {
      MCODIGO: ['Codigo de la marca', 'alta'],
      MNOMBRE: ['Nombre de la marca', 'alta'],
    },
  },

  TIDCATE: {
    descripcion:
      'Categorias de articulos (arbol de 3 niveles) con caracteristicas libres e imagen.',
    convenciones: {
      jerarquia: 'CATE1, CATE2 y CATE3 son los niveles del arbol (de mayor a menor).',
      caracteristicas: 'CARAC1..CARAC6 son atributos libres configurables por categoria.',
    },
    relaciones: [
      { campo: 'CTABCOD', referencia: 'TIDSAL.INCATE / TIDTAB.CTABCOD', nota: 'Codigo de categoria usado por el articulo.', confianza: 'media' },
    ],
    exact: {
      CTABCOD: ['Codigo de la categoria', 'alta'],
      CTABDES: ['Descripcion/nombre de la categoria', 'alta'],
      IMAGEN: ['Ruta/nombre de la imagen de la categoria', 'media'],
      HABILITA: ['Categoria habilitada', 'alta'],
    },
  },

  TIDTAB: {
    descripcion:
      'Tabla parametrica maestra ("tabla de tablas"): lineas, conceptos y valores que otros modulos referencian por CTABCOD (p. ej. INCATE del articulo).',
    convenciones: {
      llave: 'CTABCOD es el codigo que otros modulos referencian.',
      escalas: 'PRE01C/PRE01V .. PRE12C/PRE12V son 12 escalas de precio (costo/venta) con sus DIAS de vigencia.',
      ventas: 'VENTAS01..VENTAS13 son acumulados mensuales.',
    },
    relaciones: [
      { campo: 'CTABCOD', referencia: 'TIDSAL.INCATE', nota: 'Categoria/linea del articulo (arbol real del ERP).', confianza: 'alta' },
      { campo: 'CTABCOD1', referencia: 'TIDTAB.CTABCOD', nota: 'Codigo padre dentro de la misma tabla (jerarquia).', confianza: 'media' },
    ],
    exact: {
      CTABCOD: ['Codigo de la tabla/concepto', 'alta'],
      CTABDES: ['Descripcion del concepto', 'alta'],
      LINEA: ['Linea/grupo al que pertenece', 'media'],
      CTABCOD1: ['Codigo del concepto padre/relacionado', 'media'],
      NUMERO: ['Numero de orden o consecutivo', 'media'],
      MAXDCTO: ['Porcentaje maximo de descuento', 'media'],
      RETENCION: ['Codigo de retencion aplicable', 'media'],
      ESCALAS: ['Configuracion de escalas de precio (binario)', 'baja'],
      CODIGO: ['Codigo adicional del concepto', 'media'],
      INVE: ['Afecta inventario (S/N)', 'media'],
      CCOSTO: ['Centro de costo', 'media'],
      CTIPDOC: ['Tipo de documento asociado', 'media'],
      CTSERIAL: ['Maneja serial', 'media'],
      CTAGRUP: ['Agrupacion contable', 'baja'],
      CTWEB: ['Visible/publicable en la web', 'media'],
      BORRAR: ['Permite borrar el concepto', 'media'],
      CPARTE: ['Numero de parte/referencia', 'baja'],
      CTSUBSI: ['Aplica subsidio', 'baja'],
      CESTAETI: ['Estado de etiqueta', 'baja'],
      CCODNPUM: ['Codigo PUM (unidad de medida)', 'baja'],
      CACUVLR: ['Acumulado de valor', 'media'],
      CACUIVA: ['Acumulado de IVA', 'media'],
      CACUCANT: ['Acumulado de cantidad', 'media'],
      DIASINVEM: ['Dias de inventario (parametro)', 'baja'],
    },
  },

  TIDTIPOS: {
    descripcion:
      'Tipos por clase (CLASE + TIPO): tarifas de impuestos, bases y valores asociados. La llave es la pareja CLASE/TIPO.',
    convenciones: { llave: 'CLASE + TIPO identifican el registro.' },
    relaciones: [
      { campo: 'CLASE', referencia: 'TIDSAL.INTIMP', nota: 'TIDSAL.INTIMP apunta a la clase de impuesto (J=IVA19, C=IVA5, E=EXENTO).', confianza: 'media' },
    ],
    exact: {
      CLASE: ['Clase del tipo (agrupacion)', 'alta'],
      TIPO: ['Codigo del tipo dentro de la clase', 'alta'],
      NOMBRE: ['Nombre/descripcion del tipo', 'alta'],
      VALOR: ['Valor o tarifa', 'media'],
      VALOR2: ['Valor alterno', 'baja'],
      DECIMAL: ['Numero de decimales', 'media'],
      SALE: ['Aplica a ventas', 'media'],
      FLAG: ['Bandera/indicador', 'baja'],
      VLRIMP3: ['Aplica/valor del tercer impuesto', 'media'],
      BASE: ['Base para el calculo', 'media'],
      IMPUESTO: ['Impuesto asociado', 'media'],
      OTROSIMP: ['Otros impuestos', 'media'],
      BASERET: ['Base de retencion', 'media'],
      TIPOCOMBO: ['Tipo de combo', 'baja'],
    },
  },

  TIDBODE: {
    descripcion:
      'Bodegas/sucursales del ERP: parametros de inventario, series mensuales de movimiento, puntos de reorden y datos contables.',
    convenciones: {
      series_mensuales: 'VTA01..12 ventas, ENT01..12 entradas, SAL01..12 salidas (sufijo = mes).',
    },
    relaciones: [
      { campo: 'CODIGO', referencia: 'TIDSAL.INSUC / POSPAGO.SUCUR', nota: 'Codigo de sucursal/bodega.', confianza: 'alta' },
      { campo: 'CODCIU', referencia: 'POSDANE.CODIGO', nota: 'Ciudad de la bodega (codigo DANE de 6 posiciones).', confianza: 'media' },
    ],
    exact: {
      CODIGO: ['Codigo de la bodega/sucursal', 'alta'],
      NOMBRE: ['Nombre de la bodega/sucursal', 'alta'],
      CARPETA: ['Carpeta de trabajo/documentos de la bodega', 'media'],
      CARPETAPD: ['Carpeta de pedidos', 'media'],
      CARPETAIP: ['Carpeta de impresion', 'media'],
      CARPETAR: ['Carpeta de reportes', 'media'],
      BODEGA: ['Bodega secundaria/asociada', 'media'],
      SALDOS: ['Cuenta o valor de saldos de inventario', 'baja'],
      COSTOS: ['Cuenta o valor de costos', 'baja'],
      VENTAS: ['Cuenta o valor de ventas', 'baja'],
      PROMEDIO: ['Costo promedio de la bodega', 'baja'],
      CCOSTO: ['Centro de costo', 'media'],
      TIPDOC: ['Tipo de documento por defecto', 'media'],
      VERSAL: ['Ver/actualizar saldos', 'media'],
      ESTADO: ['Estado de la bodega (activa/inactiva)', 'media'],
      ACUMULA: ['Acumula movimientos', 'media'],
      HABILITA: ['Bodega habilitada', 'media'],
      BOD1: ['Bodega relacionada 1', 'baja'],
      BOD2: ['Bodega relacionada 2', 'baja'],
      ULTIMAF: ['Fecha del ultimo movimiento', 'media'],
      ULTIMAC: ['Fecha del ultimo costo', 'media'],
      PEDIDO: ['Valor/acumulado de pedidos', 'baja'],
      COMPRA: ['Valor/acumulado de compras', 'baja'],
      SALDOULT: ['Saldo del ultimo movimiento', 'baja'],
      ULTVTA: ['Valor de la ultima venta', 'media'],
      SALDOBO: ['Saldo de la bodega', 'baja'],
      ULTCOM1: ['Fecha de la ultima compra', 'media'],
      CANCOM1: ['Cantidad de la ultima compra', 'media'],
      VALCOM1: ['Valor de la ultima compra', 'media'],
      VALCOM3: ['Valor alterno de la ultima compra', 'baja'],
      ROTACION: ['Indice de rotacion del inventario', 'media'],
      INACTIVO: ['Marca de inactividad (A/I)', 'media'],
      CXLS: ['Caja(s) asociada(s) a la bodega', 'baja'],
      TIPMARGEN: ['Tipo de margen aplicado', 'baja'],
      CODCIU: ['Codigo DANE de la ciudad', 'media'],
      CTNPED: ['Concepto/cuenta de pedidos', 'baja'],
      GTSOL: ['Genera solicitud de pedido', 'media'],
      ABC: ['Clasificacion ABC del inventario', 'media'],
      SUGEPEDI: ['Sugiere pedido automaticamente', 'media'],
      EMBALAJE: ['Factor de embalaje', 'baja'],
      REDONDEO: ['Redondeo aplicado a cantidades/precios', 'baja'],
      ICANT: ['Incremento minimo de cantidad', 'baja'],
      PROYESEMA: ['Proyeccion de ventas semanal', 'media'],
      VTASEANT: ['Ventas de la semana anterior', 'media'],
      ISALDO: ['Saldo de inventario', 'media'],
      DIASINV: ['Dias de inventario', 'media'],
      INVEMAX: ['Inventario maximo', 'media'],
      ULTIMORECI: ['Ultimo recibo/entrada', 'media'],
      ITRANSITO: ['Inventario en transito', 'media'],
      FORCSEMA: ['Factor de conversion semanal', 'baja'],
      CANTPRDIA: ['Cantidad promedio diaria', 'media'],
      PLAENTRED: ['Plazo de entrega', 'media'],
      STOCKSEG: ['Stock de seguridad', 'alta'],
      PTOREORD: ['Punto de reorden', 'alta'],
      CANPTORE: ['Cantidad del punto de reorden', 'media'],
      FREPEDI: ['Frecuencia de pedido', 'media'],
      CICLOPEDI: ['Ciclo de pedido', 'media'],
      IPORIVA: ['Porcentaje de IVA', 'media'],
      IPRELIST: ['Indicador de precio de lista', 'baja'],
      OCEDI: ['Indicador de operacion/edicion', 'baja'],
      CODCEN: ['Centro de costo (codigo largo)', 'media'],
      INIMP3: ['Porcentaje/valor del impuesto 3', 'media'],
      LOGY1: ['Bandera logica auxiliar', 'baja'],
      CODCEN2: ['Centro de costo alterno', 'media'],
      EOS: ['Bandera auxiliar de estado', 'baja'],
      AESTADO: ['Estado alterno', 'baja'],
      GENBI: ['Genera bienes', 'baja'],
    },
  },

  POSDANE: {
    descripcion:
      'Catalogo DANE (division politica de Colombia): departamentos y municipios. Se usa para direcciones y codigos de ciudad.',
    convenciones: { CODIGO: 'Es texto, aunque parezca numerico.' },
    relaciones: [
      { campo: 'CODIGO', referencia: 'TIDBODE.CODCIU', nota: 'Codigo de ciudad de la bodega.', confianza: 'media' },
    ],
    exact: {
      CODIGO: ['Codigo DANE del departamento/municipio', 'alta'],
      NOMBRE: ['Nombre del departamento/municipio', 'alta'],
    },
  },

  POSPAGO: {
    descripcion:
      'Medios de pago configurados en el POS (efectivo, tarjetas, creditos, bonos...), con comisiones, retenciones y cuentas contables.',
    convenciones: {
      SUCUR: 'Sucursal a la que aplica; vacio o 0 = todas.',
      retenciones: 'BRET* = base; PRET* = porcentaje. DEB*/CRE* = cuentas debito/credito.',
    },
    relaciones: [{ campo: 'SUCUR', referencia: 'TIDBODE.CODIGO', nota: 'Codigo de sucursal/bodega.', confianza: 'media' }],
    exact: {
      SUCUR: ['Sucursal a la que aplica el medio de pago (vacio/0 = todas)', 'alta'],
      CODIGO: ['Codigo del medio de pago', 'alta'],
      NOMBRE: ['Nombre del medio de pago', 'alta'],
      NOMBRE2: ['Nombre corto / abreviado (tirilla)', 'alta'],
      ALTERNA: ['Indica si es un medio de pago alterno', 'media'],
      VALMIN: ['Valor minimo permitido para la transaccion', 'alta'],
      VALMAX: ['Valor maximo permitido para la transaccion', 'alta'],
      MARCA: ['Marca/bandera del medio de pago (codigo de 1 caracter)', 'baja'],
      HISTORIA: ['Guarda historial de las transacciones', 'media'],
      BRETEIVA: ['Base de retencion de IVA', 'media'],
      PRETEIVA: ['Porcentaje de retencion de IVA', 'media'],
      BRETEFTE: ['Base de retencion en la fuente', 'media'],
      PRETEFTE: ['Porcentaje de retencion en la fuente', 'media'],
      BCOMISION: ['Base para el calculo de la comision', 'media'],
      PCOMISION: ['Porcentaje de comision del medio de pago', 'alta'],
      DEBRETIVA: ['Cuenta debito de la retencion de IVA', 'media'],
      CRERETIVA: ['Cuenta credito de la retencion de IVA', 'media'],
      DEBRETFTE: ['Cuenta debito de la retencion en la fuente', 'media'],
      CRERETFTE: ['Cuenta credito de la retencion en la fuente', 'media'],
      DEBCOMI: ['Cuenta debito de la comision', 'media'],
      CRECOMI: ['Cuenta credito de la comision', 'media'],
      DEBNETO: ['Cuenta debito del neto a consignar', 'media'],
      CRENETO: ['Cuenta credito del neto a consignar', 'media'],
      DEBIVACOM: ['Cuenta debito del IVA sobre la comision', 'media'],
      CREIVACOM: ['Cuenta credito del IVA sobre la comision', 'media'],
      IVACOMI: ['IVA aplicado a la comision', 'media'],
      DIVIDECOM: ['Divisor para el calculo de la comision', 'baja'],
      CLICARTE: ['Cliente/contrato asociado a la tarjeta', 'baja'],
      PERMAVL: ['Permite avances (retiro de efectivo)', 'media'],
      AUTODOC: ['Genera documento contable automaticamente', 'media'],
      CUENTA: ['Afecta cuenta contable', 'media'],
      CARTE: ['Codigo/nombre de la tarjeta', 'baja'],
      CONCESION: ['Medio de pago de concesion', 'baja'],
      VLRVTA: ['Toma el valor de la venta como base', 'baja'],
      VISA: ['Corresponde a la franquicia Visa', 'media'],
      NIT: ['NIT de la entidad financiera', 'media'],
      APLIPTOS: ['Aplica puntos de fidelidad', 'media'],
      PRIMERAC: ['Aplica primera cuota', 'baja'],
      PRIMERAP: ['Porcentaje/valor de la primera cuota', 'baja'],
      PTIRILLA: ['Porcentaje o dato que se imprime en la tirilla', 'baja'],
      PSUBSIDIO: ['Porcentaje de subsidio', 'baja'],
      PBONOS: ['Porcentaje de bonos', 'baja'],
      CODCARTE: ['Codigo de la tarjeta', 'baja'],
      PMARCABEN: ['Porcentaje de beneficio de la marca', 'baja'],
      PMARCAPOR: ['Porcentaje de aporte de la marca', 'baja'],
      PACTIVIDAD: ['Codigo de actividad economica', 'baja'],
      PMOVIL: ['Habilitado para pago movil', 'media'],
      PERMIDSI: ['Integrado con DSI', 'media'],
      AUTOFE: ['Autoriza facturacion electronica', 'media'],
      VALIDAWEB: ['Habilitado para pagos en la web/ecommerce', 'media'],
    },
  },

  // ── Documentos / ventas ─────────────────────────────────────────────
  DOMDIA: {
    descripcion:
      'Cabecera de los pedidos de domicilio (pedidos web/telefono) que el ERP factura. Una fila por pedido.',
    convenciones: {
      FAPEDIDO: 'Numero de pedido (9 digitos en la integracion: prefijo 9 + id).',
      FAFACTURA: 'Numero de factura; vacio hasta que el ERP factura.',
      FASUCUR: 'Sucursal en texto (01, 02, 11).',
    },
    relaciones: [
      { campo: 'FAPEDIDO', referencia: 'DOMITE.IFPEDIDO', nota: 'Enlace cabecera-lineas mientras no hay factura.', confianza: 'alta' },
      { campo: 'FAFACTURA', referencia: 'DOMITE.IFFACT', nota: 'Enlace cuando el pedido ya se facturo.', confianza: 'media' },
      { campo: 'FASUCUR', referencia: 'TIDBODE.CODIGO', nota: 'Sucursal que atiende el pedido.', confianza: 'alta' },
    ],
    exact: {
      FAPEDIDO: ['Numero interno del pedido', 'alta'],
      FAFACTURA: ['Numero de factura (vacio si aun no se factura)', 'alta'],
      FAPEDINT: ['Pedido interno / referencia del ecommerce', 'alta'],
      FACODIGO: ['Codigo del documento', 'media'],
      FASUCUR: ['Sucursal que atiende el pedido', 'alta'],
      FACLIENTE: ['Codigo del cliente', 'alta'],
      FANOMBRE: ['Nombre del cliente', 'media'],
      FADIRECCION: ['Direccion de entrega', 'media'],
      FACIUDAD: ['Ciudad de entrega (texto libre, 12)', 'media'],
      FATEL: ['Telefono de contacto', 'media'],
      FAPLACA: ['Placa del vehiculo de reparto', 'media'],
      FACIA: ['Cedula/conductor del reparto', 'baja'],
      FAESTADO: ['Estado del pedido (mapeado a los estados del ecommerce)', 'alta'],
      FAFPAGO: ['Fecha de pago', 'media'],
      FADOCPAGO: ['Referencia/ID de la transaccion de pago', 'media'],
      FAPAGO: ['Valor pagado', 'media'],
      FAOBSERVEN: ['Observaciones del pedido', 'media'],
      FATIPPER: ['Tipo de persona (natural/empresa)', 'media'],
      FACANALV: ['Canal de venta (WEB, POS...)', 'media'],
      FAHORAD: ['Hora de entrega (desde)', 'media'],
      FAHORAE: ['Hora de entrega (hasta)', 'media'],
      DIRIP: ['IP del cliente que hizo el pedido', 'media'],
      FACONTROL: ['Marca de control/procesamiento', 'baja'],
      FATOTAL: ['Total del pedido', 'alta'],
      FASUBTOTAL: ['Subtotal del pedido', 'alta'],
      FAIVA: ['IVA del pedido', 'alta'],
      FADESCUENTO: ['Descuento del pedido', 'media'],
      FAFECHA: ['Fecha del pedido', 'alta'],
      FAHORA: ['Hora del pedido', 'media'],
    },
  },

  DOMITE: {
    descripcion: 'Lineas (items) de los pedidos de domicilio. Una fila por articulo del pedido.',
    convenciones: {
      IFESTADO: 'Vacio/32768 = normal; 5 = linea cancelada.',
      IFFACT: 'Vacio hasta que el pedido se factura.',
    },
    relaciones: [
      { campo: 'IFPEDIDO', referencia: 'DOMDIA.FAPEDIDO', nota: 'Pedido al que pertenece la linea.', confianza: 'alta' },
      { campo: 'IFARTIC', referencia: 'TIDSAL.INARTIC', nota: 'Articulo vendido.', confianza: 'alta' },
    ],
    exact: {
      IFPEDIDO: ['Numero de pedido (cabecera)', 'alta'],
      IFFACT: ['Numero de factura (vacio si no se ha facturado)', 'alta'],
      IFARTIC: ['Codigo del articulo', 'alta'],
      IFEAN: ['Codigo de barras del articulo', 'alta'],
      IFNOMBRE: ['Nombre/descripcion del articulo', 'media'],
      IFUNIDAD: ['Unidad de medida', 'media'],
      IFCANT: ['Cantidad pedida', 'alta'],
      IFCANTIDAD: ['Cantidad pedida', 'alta'],
      IFPRECIO: ['Precio unitario', 'alta'],
      IFVLR: ['Valor de la linea', 'alta'],
      IFVALOR: ['Valor de la linea', 'alta'],
      IFIVA: ['IVA de la linea', 'alta'],
      IFPORIVA: ['Porcentaje de IVA (0, 5, 16, 19)', 'alta'],
      IFTIMP: ['Tipo de impuesto (vacio en las filas reales)', 'media'],
      IFDESCUENTO: ['Descuento de la linea', 'media'],
      IFNUMERO: ['Numero de linea', 'alta'],
      IFCOSTO: ['Costo unitario', 'alta'],
      IFTPRO: ['Tipo de producto (TIDTPRO.CODIGO)', 'alta'],
      IFFCHPED: ['Fecha del pedido', 'media'],
      IFPROVEE: ['Codigo del proveedor', 'media'],
      IFESTADO: ['Estado de la linea (5 = cancelada)', 'alta'],
      IFSUCUR: ['Sucursal de la linea', 'alta'],
      IFPLACA: ['Placa del vehiculo', 'baja'],
      IFLOTE: ['Lote del articulo', 'media'],
      IFVENCE: ['Fecha de vencimiento del lote', 'media'],
    },
  },

  POSCLI: {
    descripcion:
      'Maestro de clientes del ERP (POS). Se sincroniza desde `customers` del ecommerce.',
    convenciones: { CODCLI: 'Codigo de cliente de 13 posiciones (generado).' },
    relaciones: [{ campo: 'CODCLI', referencia: 'DOMDIA.FACLIENTE', nota: 'Cliente del pedido.', confianza: 'alta' }],
    exact: {
      CODCLI: ['Codigo del cliente', 'alta'],
      NOMCLI: ['Nombre completo / razon social', 'alta'],
      NOMBRE: ['Primer nombre', 'alta'],
      APELLIDO: ['Apellidos', 'alta'],
      CEDCLI: ['Documento de identidad', 'alta'],
      TIPODOC: ['Tipo de documento', 'alta'],
      NIT: ['NIT (si es empresa)', 'media'],
      NITEMPRE: ['NIT de la empresa', 'media'],
      DIRCLI1: ['Direccion principal', 'alta'],
      DIRCLI2: ['Direccion secundaria', 'media'],
      BARRIO1: ['Barrio', 'media'],
      CODBARRIO: ['Codigo del barrio', 'baja'],
      CIUCLI: ['Codigo de ciudad', 'media'],
      CIUDAD: ['Ciudad (texto)', 'alta'],
      TELCLI1: ['Telefono principal', 'alta'],
      TELCLI2: ['Telefono secundario', 'media'],
      TELCELU: ['Celular', 'alta'],
      EMAIL: ['Correo electronico', 'alta'],
      SUCURSAL: ['Sucursal del cliente', 'alta'],
      FECHAN: ['Fecha de nacimiento', 'media'],
      SEXO: ['Genero', 'media'],
      FECHAI: ['Fecha de creacion', 'media'],
      FECHAMOD: ['Fecha de ultima modificacion', 'media'],
      TIPCLI: ['Tipo de cliente', 'media'],
      CLAWEB: ['Clave/identificador web', 'baja'],
      NEWWEB: ['Indicador de registro web', 'baja'],
      ORIGENW: ['Origen web del cliente', 'media'],
      BLOQUE: ['Cliente bloqueado', 'media'],
      ESTADO: ['Estado del cliente', 'media'],
      CUPO: ['Cupo de credito', 'media'],
      SALDO: ['Saldo pendiente', 'media'],
      VENDEDOR: ['Vendedor asignado', 'media'],
    },
  },

  FADDIA: {
    descripcion:
      'Cabecera de facturas/documentos de venta del ERP. Una fila por factura.',
    convenciones: { FASUCUR: 'Sucursal en texto (01, 02, 11).' },
    relaciones: [
      { campo: 'FAPEDIDO', referencia: 'DOMDIA.FAPEDIDO', nota: 'Pedido de origen (si aplica).', confianza: 'media' },
      { campo: 'FACLIENTE', referencia: 'POSCLI.CODCLI', nota: 'Cliente facturado.', confianza: 'alta' },
    ],
    exact: {
      FAFACTURA: ['Numero de factura', 'alta'],
      FAPEDIDO: ['Numero de pedido de origen', 'media'],
      FASUCUR: ['Sucursal', 'alta'],
      FACLIENTE: ['Codigo del cliente', 'alta'],
      FAFECHA: ['Fecha de la factura', 'alta'],
      FAHORA: ['Hora de la factura', 'media'],
      FATOTAL: ['Total de la factura', 'alta'],
      FASUBTOTAL: ['Subtotal', 'alta'],
      FAIVA: ['IVA', 'alta'],
      FADESCUENTO: ['Descuento', 'media'],
      FAESTADO: ['Estado de la factura', 'alta'],
      FAPAGO: ['Valor pagado', 'media'],
      FAVENDEDOR: ['Vendedor', 'media'],
      FAPLACA: ['Placa del vehiculo', 'baja'],
      FACANALV: ['Canal de venta', 'media'],
    },
  },

  FADITE: {
    descripcion:
      'Detalle (lineas) de las facturas de venta. Tabla muy grande; se usa solo para verificacion puntual.',
    convenciones: { llave: 'Se enlaza con FADDIA por numero de factura.' },
    relaciones: [
      { campo: 'IFFACT', referencia: 'FADDIA.FAFACTURA', nota: 'Factura a la que pertenece la linea.', confianza: 'media' },
      { campo: 'IFARTIC', referencia: 'TIDSAL.INARTIC', nota: 'Articulo vendido.', confianza: 'alta' },
    ],
    exact: {
      IFFACT: ['Numero de factura', 'alta'],
      IFARTIC: ['Codigo del articulo', 'alta'],
      IFNOMBRE: ['Nombre del articulo', 'media'],
      IFCANT: ['Cantidad vendida', 'alta'],
      IFPRECIO: ['Precio unitario', 'alta'],
      IFVALOR: ['Valor de la linea', 'alta'],
      IFIVA: ['IVA de la linea', 'alta'],
      IFPORIVA: ['Porcentaje de IVA', 'alta'],
      IFDESCUENTO: ['Descuento de la linea', 'media'],
      IFCOSTO: ['Costo unitario', 'media'],
      IFLOTE: ['Lote', 'media'],
      IFVENCE: ['Vencimiento del lote', 'media'],
      IFSUCUR: ['Sucursal', 'media'],
    },
  },

  PEDDIA: {
    descripcion: 'Cabecera de pedidos (documento de pedido del ERP, previo a la factura).',
    convenciones: {},
    relaciones: [{ campo: 'PEDIDO', referencia: 'PEDITE', nota: 'Enlace con las lineas del pedido.', confianza: 'media' }],
    exact: {
      PEDIDO: ['Numero del pedido', 'alta'],
      FECHA: ['Fecha del pedido', 'alta'],
      CLIENTE: ['Codigo del cliente', 'alta'],
      SUCURSAL: ['Sucursal', 'media'],
      TOTAL: ['Total del pedido', 'alta'],
      ESTADO: ['Estado del pedido', 'alta'],
      VENDEDOR: ['Vendedor', 'media'],
      OBSERVACION: ['Observaciones', 'media'],
    },
  },

  PEDITE: {
    descripcion: 'Lineas de pedidos del ERP.',
    convenciones: {},
    relaciones: [
      { campo: 'PEDIDO', referencia: 'PEDDIA.PEDIDO', nota: 'Pedido de la linea.', confianza: 'media' },
      { campo: 'ARTICULO', referencia: 'TIDSAL.INARTIC', nota: 'Articulo pedido.', confianza: 'media' },
    ],
    exact: {
      PEDIDO: ['Numero de pedido', 'alta'],
      ARTICULO: ['Codigo del articulo', 'alta'],
      CANTIDAD: ['Cantidad pedida', 'alta'],
      PRECIO: ['Precio unitario', 'alta'],
      TOTAL: ['Valor de la linea', 'alta'],
      FECHA: ['Fecha del pedido', 'media'],
      ESTADO: ['Estado de la linea', 'media'],
    },
  },

  TIDSUCUR: {
    descripcion:
      'Maestro de sucursales/puntos de venta (151 registros: S.MERCALDAS CENTRO, F.MERCALDAS CENTRO, C.MERCALDAS CENTRO, MERCALDAS ELECTROD...), con nombre, direccion, carpeta de traslados y numero de pedidos. OJO: no son las bodegas de inventario; esas son TIDBODE (3 registros: 1, 2 y 11).',
    convenciones: {
      sucursal: 'SUCURSAL es texto de 3 posiciones (011, 012, 013...).',
      carpetas: 'CARPETA es la ruta de red de traslados entre sucursales (p. ej. P:\\TRASLA\\CENTRO).',
    },
    relaciones: [
      { campo: 'SUCURSAL', referencia: 'TIDSAL.INSUC / FADDIA.FASUCUR', nota: 'Codigo de sucursal usado en todo el ERP.', confianza: 'media' },
      { campo: 'SUCURSAL', referencia: 'TIDBODE.CODIGO', nota: 'Solo 3 de estas sucursales tienen bodega de inventario.', confianza: 'baja' },
    ],
    exact: {
      SUCURSAL: ['Codigo de la sucursal/punto de venta (3 posiciones)', 'alta'],
      CTNOMBRE: ['Nombre de la sucursal/punto', 'alta'],
      CTDIREC: ['Direccion', 'media'],
      CTNPED: ['Numero de pedidos asociado', 'baja'],
      CTANOANT: ['Año anterior (comparativo)', 'baja'],
      MARCA: ['Marca/indicador de la sucursal', 'baja'],
      CANT: ['Cantidad configurada', 'baja'],
      CANT2: ['Segunda cantidad configurada', 'baja'],
      CARGA: ['Carga/parametro de la sucursal', 'baja'],
      CARPETA: ['Carpeta de red de traslados', 'media'],
      SUCUR2: ['Codigo de sucursal secundario', 'baja'],
      CLACOMP: ['Clase/compania de la sucursal', 'baja'],
    },
  },

  TIDLISTA: {
    descripcion:
      'Lista de precios y descuentos por proveedor y articulo (1.587 proveedores, 60.826 articulos, 68.017 filas). OJO: NO es la lista de precios de venta del catalogo; los precios que usa el ecommerce estan en TIDSAL.INVRVENTA1..INVRVENTA0.',
    convenciones: {
      llave: 'Una fila por PROVEEDOR + ARTICULO.',
      valores: 'INVALOR = valor de lista; INVALOR1/INVALOR2/INVALO2 = valores alternos (costo con descuento).',
      descuentos: 'INDCTO1..INDCTO6 = porcentajes de descuento escalonados.',
      vigencia: 'INFECHA1/INFECHA2 delimitan la vigencia; INFCHREG es la fecha de registro.',
    },
    relaciones: [
      { campo: 'INARTIC', referencia: 'TIDSAL.INARTIC', nota: 'Articulo al que aplica el valor.', confianza: 'alta' },
      { campo: 'INPROVEE', referencia: 'TIDSAL.INPROVEE', nota: 'Proveedor que fija la lista.', confianza: 'media' },
    ],
    exact: {
      INPROVEE: ['Codigo del proveedor que fija la lista', 'alta'],
      INARTIC: ['Codigo del articulo', 'alta'],
      INNOMBRE: ['Nombre del articulo', 'alta'],
      INVALOR: ['Valor de lista del proveedor', 'media'],
      INVALOR1: ['Valor alterno (costo con descuento)', 'media'],
      INVALOR2: ['Segundo valor alterno', 'baja'],
      INVALO2: ['Tercer valor alterno', 'baja'],
      INVLRANT: ['Valor anterior', 'baja'],
      INVLRAN2: ['Valor anterior alterno', 'baja'],
      INDCTO1: ['Porcentaje de descuento 1', 'media'],
      INDCTO2: ['Porcentaje de descuento 2', 'media'],
      INDCTO3: ['Porcentaje de descuento 3', 'media'],
      INDCTO4: ['Porcentaje de descuento 4', 'baja'],
      INDCTO5: ['Porcentaje de descuento 5', 'baja'],
      INDCTO6: ['Porcentaje de descuento 6', 'baja'],
      INFECHA1: ['Fecha inicial de vigencia (YYYYMMDD)', 'media'],
      INFECHA2: ['Fecha final de vigencia (YYYYMMDD)', 'media'],
      INFCHREG: ['Fecha de registro', 'baja'],
      INACTIVO: ['Estado de la lista (A = activa)', 'media'],
      INIMPC: ['Impoconsumo', 'baja'],
      INIMP3: ['Tercer impuesto', 'baja'],
      MODPRE: ['Modo/parametro de precio', 'baja'],
      CODVER: ['Codigo de version', 'baja'],
    },
  },

  TIDPRECI: {
    descripcion:
      'Registro reducido (225 filas, todas con INTIPO = "Uno a Uno") con dos valores por articulo (INVALOR e INVALORN), fecha, hora y usuario. Parece un historico/ajuste de valores de compra de ese proveedor: NO es la lista de precios de venta (esos viven en TIDSAL.INVRVENTA1..INVRVENTA0). Proposito exacto pendiente de confirmar con el negocio.',
    convenciones: {
      llave: 'Una fila por articulo y fecha de registro; sin llave declarada.',
      valores: 'INVALOR e INVALORN son los dos valores comparados (189 de 225 filas tienen INVALOR > INVALORN).',
    },
    relaciones: [
      { campo: 'INARTIC', referencia: 'TIDSAL.INARTIC', nota: 'Articulo al que se refiere el registro.', confianza: 'media' },
    ],
    exact: {
      INARTIC: ['Codigo del articulo', 'alta'],
      INVALOR: ['Primer valor registrado (habitualmente el mayor)', 'media'],
      INVALORN: ['Segundo valor registrado (nuevo/ajustado)', 'media'],
      INTIPO: ['Tipo/lista del registro (unico valor: "Uno a Uno")', 'media'],
      INFECHA: ['Fecha del registro (YYYYMMDD)', 'alta'],
      INHORA: ['Hora del registro (HH:MM:SS)', 'alta'],
      INUSUAR: ['Usuario que registro el cambio', 'media'],
    },
  },

  TIDEAN: {
    descripcion:
      'Codigos de barras alternos por articulo. En la base solo tiene 5 filas, todas apuntando al mismo articulo con EAN genericos de prueba (111, 11111, 22222, 1121212, 362514): NO es la fuente de codigos de barras. El EAN real esta en TIDSAL.INEAN / INEANC.',
    convenciones: { estado: 'Tabla practicamente sin uso; parece residuo de pruebas.' },
    relaciones: [{ campo: 'INARTIC', referencia: 'TIDSAL.INARTIC', nota: 'Articulo del codigo.', confianza: 'media' }],
    exact: {
      INEAN: ['Codigo de barras', 'media'],
      NUMERO: ['Consecutivo del registro', 'baja'],
      INARTIC: ['Codigo del articulo', 'alta'],
      INNOMBRE: ['Nombre del articulo', 'alta'],
      SALE: ['Indicador SALE', 'baja'],
      CANT: ['Cantidad', 'baja'],
    },
  },

  TIDMES: {
    descripcion: 'Parametros/calendario por mes (periodos contables y de ventas).',
    convenciones: { MES: 'Numero de mes 1..12.' },
    exact: {
      MES: ['Numero del mes', 'alta'],
      NOMBRE: ['Nombre del mes', 'media'],
      ANO: ['Anio', 'media'],
      FECHAI: ['Fecha inicial del periodo', 'media'],
      FECHAF: ['Fecha final del periodo', 'media'],
    },
  },

  VTADIA: {
    descripcion: 'Cabecera de ventas del dia (cuadre de caja / cierre).',
    exact: {
      FECHA: ['Fecha de la venta', 'alta'],
      SUCURSAL: ['Sucursal', 'alta'],
      CAJA: ['Caja', 'media'],
      TOTAL: ['Total vendido', 'alta'],
      ESTADO: ['Estado del cierre', 'media'],
    },
  },

  VTAITE: {
    descripcion: 'Detalle de ventas del dia.',
    relaciones: [
      { campo: 'ARTICULO', referencia: 'TIDSAL.INARTIC', nota: 'Articulo vendido.', confianza: 'media' },
    ],
    exact: {
      ARTICULO: ['Codigo del articulo', 'alta'],
      CANTIDAD: ['Cantidad vendida', 'alta'],
      PRECIO: ['Precio unitario', 'alta'],
      TOTAL: ['Valor de la linea', 'alta'],
      FECHA: ['Fecha de la venta', 'media'],
      SUCURSAL: ['Sucursal', 'media'],
    },
  },

  VTAPAGO: {
    descripcion: 'Pagos recibidos en las ventas del dia.',
    relaciones: [{ campo: 'CODIGO', referencia: 'POSPAGO.CODIGO', nota: 'Medio de pago.', confianza: 'media' }],
    exact: {
      CODIGO: ['Codigo del medio de pago', 'alta'],
      VALOR: ['Valor recibido', 'alta'],
      FECHA: ['Fecha', 'media'],
      SUCURSAL: ['Sucursal', 'media'],
    },
  },

  PAGO01: {
    descripcion: 'Pagos/abonos registrados (documento de recaudo).',
    exact: {
      CODIGO: ['Codigo del pago', 'media'],
      CLIENTE: ['Cliente que paga', 'media'],
      VALOR: ['Valor pagado', 'alta'],
      FECHA: ['Fecha del pago', 'alta'],
      MEDIO: ['Medio de pago', 'media'],
      ESTADO: ['Estado del pago', 'media'],
    },
  },

  MOV00: {
    descripcion: 'Movimientos de inventario/cartera (documento base).',
    exact: {
      FECHA: ['Fecha del movimiento', 'alta'],
      TIPO: ['Tipo de movimiento', 'media'],
      ARTICULO: ['Articulo', 'media'],
      CANTIDAD: ['Cantidad', 'alta'],
      VALOR: ['Valor', 'alta'],
      BODEGA: ['Bodega', 'media'],
      SUCURSAL: ['Sucursal', 'media'],
    },
  },

  COTDIA: {
    descripcion: 'Cabecera de cotizaciones.',
    exact: {
      FECHA: ['Fecha de la cotizacion', 'alta'],
      CLIENTE: ['Cliente', 'alta'],
      TOTAL: ['Total cotizado', 'alta'],
      ESTADO: ['Estado de la cotizacion', 'media'],
    },
  },

  COTITE: {
    descripcion: 'Lineas de cotizaciones.',
    relaciones: [{ campo: 'ARTICULO', referencia: 'TIDSAL.INARTIC', nota: 'Articulo cotizado.', confianza: 'media' }],
    exact: {
      ARTICULO: ['Codigo del articulo', 'alta'],
      CANTIDAD: ['Cantidad cotizada', 'alta'],
      PRECIO: ['Precio unitario', 'alta'],
      TOTAL: ['Valor de la linea', 'alta'],
    },
  },
};

/** Series y patrones que se repiten en muchas tablas. */
export function serie(campo) {
  let m = campo.match(/^VTA(\d{2})$/);
  if (m) return [`Ventas acumuladas del mes ${Number(m[1])}`, 'alta'];
  m = campo.match(/^VENTAS(\d{2})$/);
  if (m) return [`Ventas acumuladas del periodo ${Number(m[1])}`, 'media'];
  m = campo.match(/^ENT(\d{2})$/);
  if (m) return [`Entradas de inventario del mes ${Number(m[1])}`, 'media'];
  m = campo.match(/^SAL(\d{2})$/);
  if (m) return [`Salidas de inventario del mes ${Number(m[1])}`, 'media'];
  m = campo.match(/^PRE(\d{2})([CV])$/);
  if (m) return [`Precio de ${m[2] === 'C' ? 'costo' : 'venta'} de la escala ${Number(m[1])}`, 'media'];
  m = campo.match(/^DIAS(\d?)$/);
  if (m) return [`Dias de vigencia de la escala ${m[1] || 1}`, 'baja'];
  m = campo.match(/^CARAC(\d)$/);
  if (m) return [`Caracteristica libre ${m[1]} de la categoria`, 'media'];
  m = campo.match(/^CATE(\d)$/);
  if (m) return [`Nivel ${m[1]} del arbol de categorias`, 'alta'];
  m = campo.match(/^(IEU|IEV|ISU|ISV|NIFEU|NIFEV|NIFSU|NIFSV)(\d{2})$/);
  if (m) {
    const tipo = /^(IEU|IEV|NIFEU|NIFEV)$/.test(m[1]) ? 'Entradas' : 'Salidas';
    const unidad = /U$/.test(m[1]) ? 'unidades' : 'valor';
    return [`${tipo} en ${unidad} - sucursal ${m[2]} (historico)`, 'alta'];
  }
  m = campo.match(/^S(\d{2})$/);
  if (m) return [`Saldo/existencia en la sucursal ${m[1]}`, 'media'];
  return null;
}

/**
 * Heurística genérica por nombre de columna. Devuelve [significado, confianza]
 * o null si no reconoce el nombre.
 */
export function inferir(tabla, campo) {
  const c = campo.toUpperCase();
  // [regex, significado, confianza]
  const reglas = [
    [/^(CODIGO|COD|CODC|CTABCOD|MCODIGO|CLAVE|KEY)$/, 'Codigo del registro', 'alta'],
    [/^COD/, 'Codigo', 'media'],
    [/^(NOMBRE|NOM|NOMBRE2|NOMCLI|CTABDES|DESCRIPCION|DES|RAZON)$/, 'Nombre o descripcion', 'alta'],
    [/NOM/, 'Nombre', 'media'],
    [/DES/, 'Descripcion', 'media'],
    [/^(FECHA|FCH|FAFECHA|FECHAI|FECHAF|FCHREG|FECREG)$/, 'Fecha', 'alta'],
    [/FECHA|FCH/, 'Fecha', 'media'],
    [/(HORA|HORAD|HORAE)/, 'Hora', 'media'],
    [/(TOTAL|SUBTOTAL|VALOR|VLR|IMPORTE|MONTO)$/, 'Valor monetario', 'alta'],
    [/(IVA|IMPUESTO|IMP)$/, 'Impuesto/IVA', 'alta'],
    [/(DESCUENTO|DCTO|DCTOS|DCTO2|DCTO3|DCTO5)$/, 'Descuento', 'media'],
    [/(PRECIO|PREC|VRVENTA|VRCOMPRA)$/, 'Precio', 'alta'],
    [/(CANT|CANTIDAD|UND|UNIDADES)$/, 'Cantidad', 'alta'],
    [/(ESTADO|SITUACION|STATUS)$/, 'Estado del registro', 'alta'],
    [/(ACTIVO|INACTIVO|HABILITA|BLOQUE|OCULTA|BORRAR)$/, 'Indicador de habilitacion/estado', 'media'],
    [/(SUCUR|SUCURSAL|INSUC)$/, 'Sucursal', 'alta'],
    [/(BODEGA|BOD|INBODEGA)$/, 'Bodega', 'alta'],
    [/(CLIENTE|CLI|CODCLI|FACLIENTE)$/, 'Cliente', 'alta'],
    [/(ARTIC|ARTICULO|IFARTIC|INARTIC|SKU)$/, 'Articulo', 'alta'],
    [/(VENDEDOR|VEND)$/, 'Vendedor', 'alta'],
    [/(PROVEEDOR|PROVEE)$/, 'Proveedor', 'alta'],
    [/(DIRECCION|DIR|DIRCLI|DIRIP)$/, 'Direccion', 'alta'],
    [/(TELEFONO|TEL|TELCLI|TELCELU)$/, 'Telefono', 'alta'],
    [/(EMAIL|CORREO|MAIL)$/, 'Correo electronico', 'alta'],
    [/(NIT|CEDULA|CEDCLI|DOCUMENTO|RUC)$/, 'Documento de identidad/NIT', 'alta'],
    [/(PLACA)$/, 'Placa del vehiculo', 'media'],
    [/(LOTE)$/, 'Lote', 'media'],
    [/(VENCE|VENCIMIENTO)$/, 'Fecha de vencimiento', 'media'],
    [/(CCOSTO|CODCEN|CENTRO)/, 'Centro de costo', 'media'],
    [/(CUENTA|CONTABLE)/, 'Cuenta contable', 'media'],
    [/(RETENCION|RETE|RET$)/, 'Retencion', 'media'],
    [/(BASE)$/, 'Base de calculo', 'baja'],
    [/(PORCENTAJE|PORC|POR)$/, 'Porcentaje', 'baja'],
    [/(SALDO|ABONO|CUOTA)$/, 'Saldo/abono/cuota', 'media'],
    [/(NUMERO|NUM|CONSECUTIVO)$/, 'Numero/consecutivo', 'media'],
    [/(USUARIO|USU)$/, 'Usuario', 'media'],
    [/(OBSERV|OBSER|NOTA|COMENTARIO)$/, 'Observaciones/notas', 'media'],
    [/(UNIDAD|UM)$/, 'Unidad de medida', 'media'],
    [/(EMPAQUE|EMBALAJE)$/, 'Empaque', 'media'],
    [/(PESO)$/, 'Peso', 'media'],
    [/(ALTO|ANCHO|LARGO|LAT|LON)$/, 'Dimension/coordenada', 'media'],
  ];
  for (const [re, txt, conf] of reglas) if (re.test(c)) return [txt, conf];
  return null;
}

/**
 * Significado de una columna: diccionario TIDSAL -> exacto de la tabla -> series -> heuristica.
 * Devuelve `[significado, confianza]`. Lo comparten el generador y el parcheo local.
 */
export function significadoDe(tabla, columna, tidsalMeanings = {}) {
  const up = String(tabla).toUpperCase();
  const col = String(columna).toUpperCase();
  if (up === 'TIDSAL' && tidsalMeanings[col]) return [tidsalMeanings[col], 'alta'];
  const exact = TABLAS[up]?.exact?.[col];
  if (exact) return exact;
  const s = serie(col);
  if (s) return s;
  const inf = inferir(up, col);
  if (inf) return inf;
  return ['Sin identificar en esta revision', 'baja'];
}

/** Convierte un tipo ADS (`Field_Type`) al nombre legible. */
export function tipoLegible(t) {
  const n = Number(t);
  if (n === 1) return 'logical';
  if (n === 4) return 'char';
  if (n === 10) return 'numeric(8B)';
  if (n === 11) return 'int32';
  if (n === 12) return 'bin2';
  if (n === 20) return 'varchar';
  if (n === 15) return 'date/time';
  if (n === 3) return 'memo';
  return `tipo_${n}`;
}
