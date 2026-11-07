#!/usr/bin/env node
/**
 * Escribe release/REPORTE-FALSO-POSITIVO.txt en cada escritorio con los datos
 * necesarios para reportar la detección heurística de Gridinsoft.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const projects = [
  {
    dir: '/home/jk/Proyectos/dsi/ecommerce/Interface desktop admin',
    app: 'Ecommerce Admin',
    base: 'EcommerceAdmin',
    thumbprint: '413070E61F354A28BEEDF438A2A44EA1E189EEA9',
  },
  {
    dir: '/home/jk/Proyectos/dsi/ecommerce/Interface desktop delivery admin',
    app: 'Ecommerce Delivery Admin',
    base: 'EcommerceDeliveryAdmin',
    thumbprint: '02DE48C1AA17AFDB2316368B7C052A4D44C527D5',
  },
  {
    dir: '/home/jk/Proyectos/dsi/ecommerce/Interface desktop picking admin',
    app: 'Ecommerce Picking Admin',
    base: 'EcommercePickingAdmin',
    thumbprint: '5719A9708CE934F8EA9394695EF1ECD2D90E1F65',
  },
  {
    dir: '/home/jk/Proyectos/dsi/crm/Interface desktop crm',
    app: 'Ecommerce CRM',
    base: 'EcommerceCRM',
    thumbprint: '958EA848C6C0F9F4833A347846D228271E71F003',
  },
];

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

for (const project of projects) {
  const files = fs
    .readdirSync(path.join(project.dir, 'release'))
    .filter((name) => name.endsWith('.exe'))
    .sort();

  const lines = files.map((name) => {
    const full = path.join(project.dir, 'release', name);
    const size = fs.statSync(full).size;
    return `Archivo:  ${name}\nSHA-256:  ${sha256(full)}\nTamaño:   ${size} bytes`;
  });

  const report = `REPORTE DE FALSO POSITIVO
=======================

Producto: ${project.app}
Fabricante: Ecommerce-JCTI
Firma: CN=Ecommerce-JCTI ${project.base === 'EcommerceAdmin' ? '' : project.base.replace('Ecommerce', '').replace('Admin', '') + ' '}Code Signing
Thumbprint SHA-1: ${project.thumbprint}

Detección reportada
-------------------
Motor: Gridinsoft (no cloud)
Nombre: Trojan.Win32.Wacatac.oa!s1
Resultado de otros motores: Acronis (Static ML) = Undetected
El resto de motores de VirusTotal no detecta amenaza.

Archivos
--------
${lines.join('\n\n')}

Qué hace el instalador
----------------------
- Es un instalador NSIS que empaqueta una aplicación Electron.
- Copia la aplicación en Program Files (AllInOne) o LocalAppData (per-user).
- Crea accesos directos en el escritorio y en el menú Inicio.
- Escribe las claves de desinstalación estándar de Windows.
- NO descarga ni ejecuta código remoto durante la instalación.
- NO instala certificados ni modifica el almacén de Windows.
- NO crea servicios, tareas programadas ni entradas de inicio automático.
- NO ofusca el binario: el instalador y la app están firmados con Authenticode.

Solicitud
---------
Revisar los archivos indicados y retirar la detección heurística
(Trojan.Win32.Wacatac) por tratarse de un falso positivo.

Canales de reporte
------------------
Gridinsoft: support@gridinsoft.com
Microsoft: https://www.microsoft.com/en-us/wdsi/filesubmission
`;

  const out = path.join(project.dir, 'release', 'REPORTE-FALSO-POSITIVO.txt');
  fs.writeFileSync(out, report);
  console.log(`OK: ${out}`);
}
