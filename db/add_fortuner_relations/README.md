# Relaciones Postgres ⇄ Advantage (`ADD_FORTUNER`)

Documentación de cómo se relaciona el ecommerce (Postgres) con el ERP Advantage:

- [`MAPEOS-CAMPOS-ERP.md`](./MAPEOS-CAMPOS-ERP.md) — mapeo **campo a campo** entre
  las tablas de Postgres y las del ERP (`TIDSAL`, `TIDTAB`, `TIDMARCAS`,
  `TIDTPRO`, `TIDTIPOS`, `TIDBODE`, `POSCLI`, `DOMDIA`/`DOMITE`, `FADDIA`,
  `POSPAGO`…), con sentido (pull/push), llaves y notas de transformación.

- [`MAPA-MAESTROS-ERP.md`](./MAPA-MAESTROS-ERP.md) — arquitectura de la
  sincronización, estado por entidad, defectos detectados y plan por fases
  (Advantage como fuente de verdad de los maestros, Postgres como base operativa
  y dueña del contenido web).

El diccionario de las 111 tablas del ERP está en `../add_fortuner_study/`.
La implementación (scripts de sync/push) vive en `scripts-agent/erp/`.
