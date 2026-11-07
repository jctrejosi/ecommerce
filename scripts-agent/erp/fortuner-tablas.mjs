/**
 * Nombre completo y descripcion funcional de cada tabla de FORTUNER
 * (`C:\ADD_FORTUNER\PUBLIDATA.add`, Advantage 12).
 *
 * - `nombre_completo`: como se llama la tabla en lenguaje de negocio, no la
 *   abreviatura del ERP.
 * - `descripcion`: que guarda y para que la usa el ERP.
 *
 * Lo usan `dict-fortuner-ads.mjs` (generacion completa desde el servidor) y
 * `patch-table-metadata.mjs` (retoca los JSON ya generados sin volver a leer la
 * base). Al agregar una tabla nueva al ERP hay que agregarla aqui: el script de
 * parcheo avisa de las que falten.
 */
export const TABLAS_META = {
  __CATALOGO2: {
    nombre_completo: 'Catalogo de replicacion de Advantage (tabla de sistema)',
    descripcion:
      'Tabla interna del motor Advantage para replicar cambios entre bases (EntryID, TxnID, CRC, RecordData). No es del negocio: no debe leerse ni escribirse desde la integracion.',
  },
  __P_A_100_50: {
    nombre_completo: 'Catalogo de replicacion de Advantage (particion 100/50)',
    descripcion:
      'Particion interna del catalogo de replicacion de Advantage. Misma estructura que __CATALOGO2; no es del negocio.',
  },
  __P_A_102_50: {
    nombre_completo: 'Catalogo de replicacion de Advantage (particion 102/50)',
    descripcion:
      'Particion interna del catalogo de replicacion de Advantage. Misma estructura que __CATALOGO2; no es del negocio.',
  },
  CADEMP: {
    nombre_completo: 'Catalogo corto de empresas',
    descripcion:
      'Lista minima de empresas/razones sociales configuradas (codigo, nombre e indicador SALE) para elegir la empresa activa en los modulos. 19 filas.',
  },
  COCENTRO: {
    nombre_completo: 'Centros de costo contables',
    descripcion:
      'Define cada centro de costo (compañia, codigo, NIT, nombre) con las cuentas debito/credito DEB00..CRE11 que se afectan en cada mes.',
  },
  CONCECOS: {
    nombre_completo: 'Conceptos de centros de costo',
    descripcion:
      'Conceptos de distribucion de gastos por centro de costo: porcentaje, valor resultante, cuenta, concepto y estado.',
  },
  CONCTR: {
    nombre_completo: 'Parametros generales de contabilidad',
    descripcion:
      'Configuracion del modulo contable: empresa, NIT, ciudad, periodo inicial y final, claves, resoluciones de facturacion, centros de costo, numeracion de documentos y orden de visualizacion de meses.',
  },
  CONDOCUM: {
    nombre_completo: 'Documentos y consecutivos contables',
    descripcion:
      'Configuracion de los documentos contables (DDOCUM/DDOCUMI): tipo de documento, fecha, detalle, valor y modulo de origen.',
  },
  CONEMP: {
    nombre_completo: 'Empresas contables',
    descripcion:
      'Maestro de empresas del modulo contable con NIT y clave de acceso.',
  },
  CONINF1: {
    nombre_completo: 'Niveles de informe y presupuesto',
    descripcion:
      'Define nivel de la cuenta, nombre, tipo, valor de presupuesto y valor base por empresa; lo usan los informes y el presupuesto contable.',
  },
  CONIVA: {
    nombre_completo: 'Saldos de IVA por tercero',
    descripcion:
      'Acumulados mensuales de IVA por codigo y NIT: base y valor de cada mes (BASE01/VALOR01..BASE12/VALOR12, con columnas C). 61.791 filas.',
  },
  CONLOTES: {
    nombre_completo: 'Lineas de lote contable',
    descripcion:
      'Movimientos contables agrupados por lote: cuenta, tercero, debito, credito, base, concepto, comprobante, tipo y fecha del documento.',
  },
  CONMAE: {
    nombre_completo: 'Maestro de cuentas contables',
    descripcion:
      'Plan de cuentas con nombre, saldo y acumulados mensuales debito/credito (MACMDEB01..MACMCRE12), manejo de centros de costo, retencion, IVA y centros de pago.',
  },
  CONMAG1: {
    nombre_completo: 'Formatos contables — encabezado',
    descripcion:
      'Plantilla de los "formatos magicos" de documentos contables: forma, elemento, concepto, tipo de documento, tercero, encabezado y valores fijos.',
  },
  CONMAG2: {
    nombre_completo: 'Formatos contables — conceptos',
    descripcion:
      'Conceptos y montos que componen cada formato contable (FORMATO + CONCEPTO).',
  },
  CONMAG3: {
    nombre_completo: 'Formatos contables — cuentas',
    descripcion:
      'Cuentas que afecta cada formato/concepto, con tipo de movimiento, cuentas por pagar y columnas de valor/base.',
  },
  CONMAGDT: {
    nombre_completo: 'Formatos contables — detalle por tercero',
    descripcion:
      'Valores por tercero y cuenta de cada renglon del formato contable (VALOR1..VALOR11).',
  },
  CONMAGIT: {
    nombre_completo: 'Formatos contables — movimientos generados',
    descripcion:
      'Movimientos contables producidos al aplicar un formato: tercero, fecha, comprobante, documento y valor.',
  },
  CONMOVI: {
    nombre_completo: 'Control de lotes contables',
    descripcion:
      'Cabecera y estado de los lotes de movimiento: mes, estado, usuario que abre y cierra, fecha, hora y totales de debito, credito e items.',
  },
  CONPUC: {
    nombre_completo: 'Plan Unico de Cuentas (PUC)',
    descripcion:
      'Catalogo de cuentas contables colombiano (codigo, nombre y marca MFLAG). 2.633 filas.',
  },
  CONREITE: {
    nombre_completo: 'Detalle de relacion de costos',
    descripcion:
      'Detalle por tercero y centro de costo de un lote de relacion (RILOTE): fecha, concepto y valor. Uso contable interno.',
  },
  CONREMAE: {
    nombre_completo: 'Encabezado de relacion de costos',
    descripcion:
      'Cabecera del lote de relacion (RMLOTE) con concepto, fecha, valor total y documento de origen. Uso contable interno.',
  },
  CONRET: {
    nombre_completo: 'Saldos de retencion por tercero',
    descripcion:
      'Acumulados mensuales de retenciones por codigo y NIT: base y valor de cada mes. 345 filas.',
  },
  CONTERCE: {
    nombre_completo: 'Maestro de terceros contables',
    descripcion:
      'Terceros (clientes, proveedores, empleados) con NIT, nombre, saldo y acumulados mensuales de debitos y creditos. 765.759 filas.',
  },
  CONTICOM: {
    nombre_completo: 'Tipos de comprobante contable',
    descripcion: 'Catalogo de tipos de comprobante (codigo, nombre y descripcion).',
  },
  CONTIIVA: {
    nombre_completo: 'Tipos de IVA contable',
    descripcion: 'Catalogo de tipos de IVA con su porcentaje (VLRPOR).',
  },
  CONTIRET: {
    nombre_completo: 'Tipos de retencion contable',
    descripcion: 'Catalogo de tipos de retencion con su porcentaje (VLRPOR).',
  },
  COTDIA: {
    nombre_completo: 'Documento diario de cotizaciones',
    descripcion:
      'Encabezado de las cotizaciones: cliente, NIT, ciudad, documentos, totales (bruto, descuentos, IVA, impoconsumo), vendedor y estado. 29 filas.',
  },
  COTITE: {
    nombre_completo: 'Items de cotizaciones',
    descripcion:
      'Lineas de la cotizacion: articulo, cantidad, precio, descuentos, impuestos y estado. 209 filas.',
  },
  CTRCOMPR: {
    nombre_completo: 'Parametros y control de compras',
    descripcion:
      'Configuracion del modulo de compras: analisis de consumo, sugeridos, comparacion con el año anterior, rutas/carpetas de reposicion y ponderaciones de rotacion.',
  },
  DOMDIA: {
    nombre_completo: 'Documento diario de pedidos de domicilio',
    descripcion:
      'Cabecera de los pedidos de domicilio (web/telefono) que el ERP factura: cliente, NIT, ciudad, tipo de persona, numero de pedido, factura y totales. Una fila por pedido. 52.498 filas.',
  },
  DOMITE: {
    nombre_completo: 'Items de pedidos de domicilio',
    descripcion:
      'Lineas de los pedidos de domicilio: articulo, EAN, cantidad, precio, descuentos e impuestos. 240.635 filas.',
  },
  ENCUENC: {
    nombre_completo: 'Encabezado de encuestas',
    descripcion:
      'Define una encuesta: nombre, si es obligatoria, fecha inicial/final y observaciones.',
  },
  ENCUITE: {
    nombre_completo: 'Preguntas de encuesta',
    descripcion:
      'Preguntas de una encuesta con tipo de respuesta y si es obligatoria.',
  },
  FADCLI: {
    nombre_completo: 'Maestro de clientes de facturacion',
    descripcion:
      'Clientes del modulo de facturacion (102 campos): identificacion, nombres, direccion, ciudad, correo, cupo, zona, vendedor y datos de entrega.',
  },
  FADCON: {
    nombre_completo: 'Parametros de facturacion por sucursal',
    descripcion:
      'Configuracion del modulo de facturacion/POS (145 campos): empresa, caja, prefijos y resoluciones, listas de precios, domicilios, parqueadero, redondeo, UVT y opciones de integracion.',
  },
  FADDIA: {
    nombre_completo: 'Documento diario de facturas',
    descripcion:
      'Cabecera de las facturas de venta: sucursal, numero, estado, fechas de factura y vencimiento, cliente, vendedor y totales. Una fila por factura. 1.167.637 filas.',
  },
  FADEVIDE: {
    nombre_completo: 'Evidencias de entrega',
    descripcion:
      'Evidencias de entrega (foto/GPS) asociadas a una visita: fecha, hora, estado, latitud, longitud y app que la registro.',
  },
  FADFREEN: {
    nombre_completo: 'Catalogo de frecuencias',
    descripcion:
      'Codigos de frecuencia de visita/entrega (FRECOD) con su descripcion (FREDES).',
  },
  FADISPO: {
    nombre_completo: 'Dispositivos autorizados de facturacion',
    descripcion:
      'Terminales/dispositivos autorizados: serial, vendedor, empresa, sucursal, ruta, recaudo, pedidos y si manejan precio con IVA o precio variable.',
  },
  FADITE: {
    nombre_completo: 'Items de facturas',
    descripcion:
      'Detalle de las facturas: articulo, cantidad, costo, precio, descuentos, IVA, impoconsumo y valor neto. Tabla de ~5,7 GB; solo se usa para verificacion puntual.',
  },
  FADLINEA: {
    nombre_completo: 'Leyendas por linea de factura',
    descripcion:
      'Configuracion de mensajes y leyendas (WTIPO/WMENSA por linea) que se imprimen en la factura segun la sucursal.',
  },
  FADVISIT: {
    nombre_completo: 'Visitas a clientes con GPS',
    descripcion:
      'Registro de visitas: ruta, usuario, fecha y hora de inicio y fin, duracion, vehiculo, cliente y coordenadas GPS.',
  },
  FAPAGO: {
    nombre_completo: 'Pagos de facturas',
    descripcion:
      'Recibos y pagos aplicados a facturas: sucursal, año, mes, caja, cajero, factura, medio de pago, valor e IVA. 2.141.129 filas.',
  },
  FCONTA: {
    nombre_completo: 'Cuentas contables de facturacion',
    descripcion:
      'Mapeo de lineas e impuestos de facturacion a cuentas contables (FIMPUESTO, FLINEA, DEB01..CRE12).',
  },
  MOV00: {
    nombre_completo: 'Movimientos contables (libro diario)',
    descripcion:
      'Movimientos contables con cuenta, tercero, fecha, comprobante, tipo de documento y valor. 2.017.444 filas; equivale a mov01.',
  },
  MOV01: {
    nombre_completo: 'Movimientos contables (particion 01)',
    descripcion:
      'Segunda generacion/particion de los movimientos contables; misma estructura que MOV00. 13.131.965 filas.',
  },
  NOMCALEN: {
    nombre_completo: 'Calendario de dias',
    descripcion:
      'Calendario con nombre del dia, festivo, cierre, promedio, semana y observaciones. 2.557 filas.',
  },
  PAGO01: {
    nombre_completo: 'Pagos de facturas (version anterior)',
    descripcion:
      'Version anterior de FAPAGO. En la base de produccion esta vacia (0 filas).',
  },
  PEDDIA: {
    nombre_completo: 'Documento diario de pedidos',
    descripcion: 'Cabecera de pedidos del ERP, previa a la factura. 6 filas.',
  },
  PEDITE: {
    nombre_completo: 'Items de pedidos',
    descripcion: 'Lineas de los pedidos del ERP. 5 filas.',
  },
  PEDITERE: {
    nombre_completo: 'Datos de entrega del pedido',
    descripcion:
      'Datos de contacto y entrega asociados al pedido: direccion, telefono, correo y campos libres. 308 filas.',
  },
  PEDRESER: {
    nombre_completo: 'Parametro de reserva de pedidos',
    descripcion:
      'Tabla de una sola columna (GENERAL) y una fila: bandera global de reserva de pedidos. Uso interno; proposito no confirmado con el negocio.',
  },
  POSACTI: {
    nombre_completo: 'Actividades e inactividades de articulos',
    descripcion:
      'Periodos en que un articulo se bloquea o se activa en el POS (codigo, descripcion, fecha inicial/final y cantidad).',
  },
  POSACTIV: {
    nombre_completo: 'Actividades promocionales',
    descripcion:
      'Promociones por actividad: proveedor, porcentajes, vigencias, monto, tipo, tarjeta y horario.',
  },
  POSALTER: {
    nombre_completo: 'Codigos alternos del POS',
    descripcion:
      'Codigos internos alternos por articulo (PLU alterno) con nombre, marca e historico. 11 filas.',
  },
  POSANIV: {
    nombre_completo: 'Promocion de aniversario',
    descripcion:
      'Configuracion de la promocion de aniversario del POS: dos bloques (A/B) con fechas, horas, cantidad, porcentaje y valor.',
  },
  POSARDC2: {
    nombre_completo: 'Archivo de descuentos 2',
    descripcion:
      'Reglas de descuento por codigo, nombre y porcentaje, con vigencia y segundo bloque horario. 3 filas.',
  },
  POSARDCT: {
    nombre_completo: 'Archivo de descuentos',
    descripcion:
      'Reglas de descuento por codigo y porcentaje con fechas, horarios y hasta tres porcentajes. 7 filas.',
  },
  POSCAJA: {
    nombre_completo: 'Cajas del POS',
    descripcion:
      'Cajas por sucursal: cajero, estado, prefijos de factura y consecutivo, topes, resoluciones DIAN y ultima factura. 44 filas.',
  },
  POSCAMBIO: {
    nombre_completo: 'Historico de cambios de precio en caja',
    descripcion:
      'Registro de cambios de precio de articulos en caja: valor anterior y nuevo, fecha, hora, operador y caja. 22 filas.',
  },
  POSCLI: {
    nombre_completo: 'Maestro de clientes del POS',
    descripcion:
      'Clientes del ERP: codigo de 13 posiciones, nombre, documento, direccion, ciudad y contacto. 146.371 filas; se sincroniza desde `customers`.',
  },
  POSCONSE: {
    nombre_completo: 'Conceptos contables del POS',
    descripcion:
      'Conceptos que usa el POS (descuentos, recargos, propinas) con cuentas debito/credito, centro de costo y tratamiento de inventario. 47 filas.',
  },
  POSCOPAG: {
    nombre_completo: 'Convenios y copagos',
    descripcion:
      'Convenios con terceros: descuentos aplicables (CODDCTO1/2), tipo, lista de precios y fraccion. 8 filas.',
  },
  POSDANE: {
    nombre_completo: 'Catalogo DANE de departamentos y municipios',
    descripcion:
      'Division politico-administrativa de Colombia; se usa en direcciones y codigos de ciudad (CODIGO es texto).',
  },
  POSDCTO2: {
    nombre_completo: 'Descuentos del POS (variante 2)',
    descripcion:
      'Reglas de descuento por proveedor, porcentaje, vigencia, monto, tarjeta y horario. 4.664 filas.',
  },
  POSDCTO3: {
    nombre_completo: 'Descuentos por talonario',
    descripcion:
      'Descuentos por cantidad/talonario: precio, puntos, multiplicadores, tallas y vigencia. 4 filas.',
  },
  POSDCTO5: {
    nombre_completo: 'Descuentos de domicilio',
    descripcion:
      'Descuentos aplicables a pedidos de domicilio: codigo, porcentaje, vigencias y consecutivo. 13.296 filas.',
  },
  POSDCTOS: {
    nombre_completo: 'Descuentos del POS',
    descripcion:
      'Maestro principal de descuentos del POS: codigo, proveedor, nombre, porcentajes, vigencia, monto y tarjeta. 5.566 filas.',
  },
  POSMENU: {
    nombre_completo: 'Menu de opciones del POS',
    descripcion:
      'Arbol de opciones del menu por usuario y nivel. 251 filas.',
  },
  POSPAGO: {
    nombre_completo: 'Medios de pago del POS',
    descripcion:
      'Medios de pago configurados (efectivo, tarjetas, creditos, bonos) con comisiones, retenciones y cuentas contables.',
  },
  POSPAGO2: {
    nombre_completo: 'Medios de pago por sucursal (version 2)',
    descripcion:
      'Segunda version de los medios de pago: rangos de valor, retenciones, comisiones, cuentas y datos de tarjeta por sucursal. 123 filas.',
  },
  POSPOPER: {
    nombre_completo: 'Operadores de POS',
    descripcion:
      'Usuarios/operadores de caja con clave, vigencia, permiso de autorizacion y datos personales. 21 filas.',
  },
  POSPRUTA: {
    nombre_completo: 'Permisos de opciones por usuario',
    descripcion:
      'Asignacion de las opciones del menu a cada usuario (perfil de permisos). 1.214 filas.',
  },
  REGIS01: {
    nombre_completo: 'Registro de items vendidos en el POS',
    descripcion:
      'Detalle transaccional del POS: una fila por item con factura, cliente, cajero, costo, precio, descuentos, impuestos y devoluciones.',
  },
  RUTAENC: {
    nombre_completo: 'Encabezado de rutas de reparto',
    descripcion: 'Maestro de rutas de reparto (nombre y observaciones). 5 filas.',
  },
  RUTAITEM: {
    nombre_completo: 'Paradas de ruta',
    descripcion:
      'Clientes/paradas que componen cada ruta por dia, con estado. 35 filas.',
  },
  TIDBODE: {
    nombre_completo: 'Bodegas y sucursales',
    descripcion:
      'Bodegas/sucursales del ERP con parametros de inventario, series mensuales de movimiento, puntos de reorden y datos contables. 3 registros: sucursales 1, 2 y 11.',
  },
  TIDCATE: {
    nombre_completo: 'Categorias de articulos',
    descripcion:
      'Arbol de categorias de 3 niveles (CATE1..CATE3) con caracteristicas libres e imagen.',
  },
  TIDCOMPR: {
    nombre_completo: 'Historico de compras por articulo',
    descripcion:
      'Compras registradas por articulo: fecha, cantidad, valor, IVA, descuentos, documento, proveedor y sucursal. 59.872 filas.',
  },
  TIDCON: {
    nombre_completo: 'Parametros del modulo de inventarios (TID)',
    descripcion:
      'Configuracion del modulo TID: manejo de costos, generacion contable, bodega de compras, redondeo, retenciones, claves y carpetas de trabajo.',
  },
  TIDDIA: {
    nombre_completo: 'Documento diario de inventario',
    descripcion:
      'Cabecera de movimientos de inventario por sucursal/bodega/mes: documento, proveedor, fecha, valor, descuentos, IVA, fletes, retenciones y vencimiento. 50.066 filas.',
  },
  TIDEAN: {
    nombre_completo: 'Codigos de barras alternos (sin uso real)',
    descripcion:
      'Codigos de barras alternos por articulo. Solo tiene 5 filas, todas apuntando al mismo articulo con EAN de prueba (111, 11111, 22222, 1121212, 362514), asi que NO es la fuente de codigos de barras: el EAN real esta en TIDSAL.INEAN / INEANC.',
  },
  TIDGON: {
    nombre_completo: 'Gondolas y ubicaciones de exhibicion',
    descripcion:
      'Codigos de gondola con dos descripciones, indicador SALE y bandera. 15 filas.',
  },
  TIDLISTA: {
    nombre_completo: 'Lista de precios y descuentos por proveedor y articulo',
    descripcion:
      'Valores y descuentos que fija cada proveedor para cada articulo: valor de lista, valores alternos (costo con descuento), hasta seis descuentos escalonados y vigencia. 1.587 proveedores, 60.826 articulos, 68.017 filas. OJO: no es la lista de precios de venta del catalogo; esos precios viven en TIDSAL.INVRVENTA1..INVRVENTA0.',
  },
  TIDMARCAS: {
    nombre_completo: 'Marcas de articulos',
    descripcion:
      'Maestro de marcas (codigo y nombre) que referencia TIDSAL.INMARCA. 2.175 filas.',
  },
  TIDMES: {
    nombre_completo: 'Movimientos de inventario por articulo (kardex)',
    descripcion:
      'Detalle de movimientos de inventario: articulo, cantidad, costo, precio, IVA, impuestos adicionales y saldo por sucursal, bodega y mes. Es el kardex historico del ERP.',
  },
  TIDOBSER: {
    nombre_completo: 'Observaciones por articulo',
    descripcion: 'Siete textos de observacion libres por articulo. 1.281 filas.',
  },
  TIDORDEN: {
    nombre_completo: 'Items de ordenes de compra',
    descripcion:
      'Detalle de las ordenes de compra/pedido a proveedor: articulo, cantidad, costo, descuentos, impuestos y estado. 203.841 filas.',
  },
  TIDORDM: {
    nombre_completo: 'Ordenes de compra (cabecera)',
    descripcion:
      'Cabecera de ordenes de compra a proveedor: fecha, fecha de entrega, estado, totales y descuentos. 9.244 filas.',
  },
  TIDPRECI: {
    nombre_completo: 'Valores por articulo del proveedor "Uno a Uno" (historico)',
    descripcion:
      '225 filas, todas con INTIPO = "Uno a Uno", con dos valores por articulo (INVALOR e INVALORN), fecha, hora y usuario. Parece un historico/ajuste de valores de compra de ese proveedor (189 de 225 filas tienen INVALOR > INVALORN). NO contiene los precios de venta del catalogo: esos estan en TIDSAL.INVRVENTA1..INVRVENTA0. Proposito exacto pendiente de confirmar.',
  },
  TIDPRENW: {
    nombre_completo: 'Articulos nuevos informados por proveedor',
    descripcion:
      'Novedades/articulos nuevos que informa el proveedor: fecha, valor, documento, marca y cantidad. 58 filas.',
  },
  TIDSAL: {
    nombre_completo: 'Maestro de articulos por sucursal y bodega (TID)',
    descripcion:
      'Maestro de articulos con 304 campos: nombre, EAN, unidad, proveedor, tipo, precios (INVRVENTA1..INVRVENTA0), impuestos, existencias, costos y ubicacion. Llave INSUC + INBODEGA + INARTIC. 51.938 filas; es la tabla que alimenta el catalogo del ecommerce.',
  },
  TIDSUCUR: {
    nombre_completo: 'Sucursales y puntos de venta',
    descripcion:
      'Maestro de sucursales/puntos de venta con 151 registros (S.MERCALDAS CENTRO, F.MERCALDAS CENTRO, C.MERCALDAS CENTRO, MERCALDAS ELECTROD...): codigo de 3 posiciones, nombre, direccion, carpeta de red de traslados y pedidos. OJO: no son las bodegas de inventario; esas son TIDBODE (3 registros: 1, 2 y 11).',
  },
  TIDTAB: {
    nombre_completo: 'Tabla parametrica maestra',
    descripcion:
      'Tabla de tablas: lineas, conceptos y escalas de precio que otros modulos referencian por CTABCOD (p. ej. INCATE del articulo).',
  },
  TIDTIPOS: {
    nombre_completo: 'Tipos por clase (impuestos y tarifas)',
    descripcion:
      'Tipos identificados por la pareja CLASE + TIPO: tarifas de impuestos, bases y valores asociados.',
  },
  TIDTPRO: {
    nombre_completo: 'Tipos de producto',
    descripcion:
      'Clasificacion comercial del articulo; el codigo es el que usa TIDSAL.INTIPO.',
  },
  USUSUCUR: {
    nombre_completo: 'Usuarios por sucursal',
    descripcion:
      'Asignacion usuario-sucursal con indicador de habilitacion. 28 filas.',
  },
  VEDCOM: {
    nombre_completo: 'Comisiones de vendedores',
    descripcion:
      'Comision liquidada por vendedor y documento: factura, recibo, cliente, base, porcentaje y valor.',
  },
  VEDCUOTA: {
    nombre_completo: 'Cuotas y metas de vendedores',
    descripcion:
      'Cuota/meta de venta por vendedor y mes, con valores por articulo y cumplimiento.',
  },
  VEDTAB: {
    nombre_completo: 'Tablas de comision de ventas',
    descripcion:
      'Parametros de comision por grupo: porcentaje, dias y rangos de edad, y maximo descuento permitido.',
  },
  VEDVEN: {
    nombre_completo: 'Vendedores',
    descripcion:
      'Maestro de vendedores (54 campos): codigo, cedula, nombre, direccion, porcentajes de comision, rutas, precios y ejes por mes.',
  },
  VISAUDI: {
    nombre_completo: 'Auditoria de usuarios',
    descripcion:
      'Bitacora de acciones por usuario: hora, modulo, documento, motivo, tipo y fecha.',
  },
  VISBODE: {
    nombre_completo: 'Bodegas del modulo VIS',
    descripcion:
      'Configuracion de bodegas/centros de costo para el modulo VIS: saldos, costos, promedio y afectacion de inventario.',
  },
  VISDOCUM: {
    nombre_completo: 'Documentos del modulo VIS',
    descripcion:
      'Configuracion de documentos del modulo VIS: consecutivos, cuentas contables, impuestos, retenciones y opciones de impresion.',
  },
  VISION: {
    nombre_completo: 'Configuracion general del modulo VIS',
    descripcion:
      'Parametros generales del modulo VIS (contabilidad/facturacion): empresa, NIT, claves, niveles, documentos, rutas de archivos y opciones de red.',
  },
  VISUSU: {
    nombre_completo: 'Usuarios del modulo VIS',
    descripcion:
      'Usuarios del modulo VIS con clave, cedula, contacto, vencimiento y vigencia.',
  },
  VTADIA: {
    nombre_completo: 'Resumen diario de ventas',
    descripcion:
      'Totales de venta por sucursal, año, mes y fecha: bruto, descuentos, IVA, impoconsumo, otros impuestos y neto.',
  },
  VTAITE: {
    nombre_completo: 'Detalle diario de ventas por articulo',
    descripcion:
      'Ventas agregadas por articulo y periodo: cantidad, costo, precio, descuentos, IVA, impoconsumo y neto.',
  },
  VTAPAGO: {
    nombre_completo: 'Pagos del resumen diario de ventas',
    descripcion:
      'Pagos por sucursal, año, mes, fecha y medio de pago del resumen diario de ventas.',
  },
  XADMOVI: {
    nombre_completo: 'Movimientos auxiliares de facturacion (integracion)',
    descripcion:
      'Espejo/auxiliar de movimientos de facturacion con articulo, valores, descuentos, IVA, retenciones y fecha; lo usan procesos externos o de exportacion.',
  },
};

/** Metadatos de una tabla (o null si no esta catalogada). */
export function metaTabla(tabla) {
  return TABLAS_META[String(tabla).toUpperCase()] ?? null;
}

/** README de `db/add_fortuner_study/` a partir del resumen ya calculado. */
export function renderReadme({ resumen, totalCampos, totalAlta, totalMedia, totalBaja, generado }) {
  const L = [];
  L.push('# Diccionario de datos — base real del ERP (`/ADD_FORTUNER`)');
  L.push('');
  L.push(
    'Generado leyendo el catalogo del servidor Advantage (`system.tables` y `system.columns`) ' +
      'de `C:\\ADD_FORTUNER\\PUBLIDATA.add` en `dsi-vps`. No usa copias locales: los tipos, ' +
      'longitudes y nulos son los de la base en produccion.',
  );
  L.push('');
  L.push(
    `Generado: ${generado}. Regenerar con \`node scripts-agent/erp/dict-fortuner-ads.mjs\` (en el servidor); ` +
      '`patch-table-metadata.mjs` reaplica nombres y descripciones sin volver a leer la base.',
  );
  L.push('');
  L.push(
    `**${resumen.length} tablas · ${totalCampos} columnas.** Confianza: ${totalAlta} alta, ${totalMedia} media, ${totalBaja} baja.`,
  );
  L.push('');
  L.push('## Tablas');
  L.push('');
  L.push('| Tabla | Nombre completo | Registros | Campos | Clave | Descripcion |');
  L.push('|---|---|---:|---:|---|---|');
  for (const r of resumen) {
    const reg = r.registros == null ? '—' : String(r.registros);
    L.push(
      `| [${r.tabla}](${r.tabla}-diccionario-datos.json) | ${r.nombre_completo} | ${reg} | ${r.columnas} | ${r.pk ?? '—'} | ${r.descripcion} |`,
    );
  }
  L.push('');
  L.push('## Relaciones clave');
  L.push('');
  L.push('```mermaid');
  L.push('erDiagram');
  L.push('  TIDTPRO ||--o{ TIDSAL : "INTIPO = CODIGO"');
  L.push('  TIDTAB ||--o{ TIDSAL : "CTABCOD = INCATE"');
  L.push('  TIDMARCAS ||--o{ TIDSAL : "MCODIGO = INMARCA (no confiable)"');
  L.push('  TIDBODE ||--o{ TIDSAL : "CODIGO = INSUC"');
  L.push('  TIDSUCUR ||--o{ TIDBODE : "151 puntos, solo 3 con bodega"');
  L.push('  POSDANE ||--o{ TIDBODE : "CODIGO = CODCIU"');
  L.push('  TIDSUCUR ||--o{ TIDMES : "sucursal del kardex"');
  L.push('  TIDSUCUR ||--o{ TIDDIA : "sucursal del documento"');
  L.push('  TIDSAL ||--o{ TIDMES : "INARTIC = IMARTIC"');
  L.push('  TIDSAL ||--o{ TIDCOMPR : "INARTIC = INARTIC"');
  L.push('  TIDORDM ||--o{ TIDORDEN : "orden de compra"');
  L.push('  DOMDIA ||--o{ DOMITE : "FAPEDIDO = IFPEDIDO"');
  L.push('  POSCLI ||--o{ DOMDIA : "CODCLI = FACLIENTE"');
  L.push('  FADDIA ||--o{ FADITE : "factura"');
  L.push('  FADDIA ||--o{ FAPAGO : "FPFACT"');
  L.push('```');
  L.push('');
  L.push('## Convenciones');
  L.push('');
  L.push('- **TIDSAL** usa `INSUC` + `INBODEGA` + `INARTIC`: un registro por articulo y sucursal/bodega.');
  L.push('- **Precios**: los del catalogo estan en `TIDSAL.INVRVENTA1` (lista 1), `INVRVENTA0` (precio "antes") e `INVRVENTA2..9` (listas alternas). `TIDLISTA` (68k) es la lista por proveedor y `TIDPRECI` (225 filas, "Uno a Uno") es un historico de valores: ninguno de los dos es la fuente de precio de venta.');
  L.push('- **Series mensuales**: `VTA01..13`, `ENT01..12`, `SAL01..12`, `VENTAS01..13`.');
  L.push('- **Documentos**: `DOMDIA`/`DOMITE` = pedidos de domicilio; `FADDIA`/`FADITE` = facturas y su detalle; `PEDDIA`/`PEDITE` = pedidos; `COTDIA`/`COTITE` = cotizaciones.');
  L.push('- **Inventario**: `TIDDIA` = documento diario (valores e impuestos); `TIDMES` = kardex por articulo.');
  L.push('- **Compras**: `TIDORDM` = orden (cabecera), `TIDORDEN` = items, `TIDCOMPR` = historico de compras.');
  L.push('- **Clientes**: `POSCLI` (maestro, `CODCLI` de 13 posiciones) y `FADCLI` (clientes de facturacion).');
  L.push('- **Sucursales**: `TIDSUCUR` (151 puntos de venta) y `TIDBODE` (3 bodegas de inventario). `TIDSAL.INSUC` usa el codigo de bodega, no el de punto de venta.');
  L.push('- **Codigos de barras**: el EAN real esta en `TIDSAL.INEAN`/`INEANC`; `TIDEAN` solo tiene 5 filas de prueba.');
  L.push('- **Marcas**: `TIDSAL.INMARCA` no coincide con `TIDMARCAS.MCODIGO`; el nombre real esta en `INMARCAP`.');
  L.push('- **Tablas `__*`**: replicacion interna de Advantage, ajenas al negocio.');
  L.push('');
  L.push('## Cobertura');
  L.push('');
  L.push(
    'Los significados de **alta** confianza son los usados por la integracion (productos, precios, ' +
      'stock, categorias, marcas, tipos, clientes y pedidos). Los de confianza **baja** son nombres ' +
      'cripticos o sin uso observado: se iran corrigiendo con el diccionario oficial del ERP.',
  );
  L.push('');
  return L.join('\n') + '\n';
}
