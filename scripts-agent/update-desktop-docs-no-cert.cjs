#!/usr/bin/env node
/**
 * Actualiza la documentación y los LEEME de los escritorio: ningún instalador
 * instala ya el certificado (lo que disparaba antivirus).
 * Idempotente: puede ejecutarse varias veces.
 */
const fs = require('node:fs');
const path = require('node:path');

const roots = [
  '/home/jk/Proyectos/dsi/ecommerce/Interface desktop admin',
  '/home/jk/Proyectos/dsi/ecommerce/Interface desktop delivery admin',
  '/home/jk/Proyectos/dsi/ecommerce/Interface desktop picking admin',
  '/home/jk/Proyectos/dsi/crm/Interface desktop crm',
];

function swap(source, from, to, label) {
  if (source.includes(from)) return source.replace(from, to);
  if (source.includes(to)) return source;
  throw new Error(`No se encontró ${label}`);
}

for (const root of roots) {
  const readmePath = path.join(root, 'README.md');
  let readme = fs.readFileSync(readmePath, 'utf8');

  readme = swap(
    readme,
    'npm run build:win:admin  # AllInOne: pide UAC, app + certificado + acceso directo',
    'npm run build:win:admin  # AllInOne: pide UAC, app para todos los usuarios',
    'README build:win:admin',
  );
  readme = swap(
    readme,
    '5. Instala el certificado de confianza de Ecommerce en el equipo.\n6. Crea el desinstalador. Al desinstalar también retira el certificado.',
    '5. Crea el desinstalador.',
    'README pasos AllInOne',
  );
  readme = swap(
    readme,
    '- El AllInOne puede advertir por SmartScreen en el primer arranque, porque el\n  certificado se instala durante la ejecución. Después de instalado, ese equipo\n  confía en los binarios firmados por Ecommerce.',
    '- El AllInOne puede advertir por SmartScreen mientras el certificado no esté\n  desplegado en el equipo. Distribúyelo por GPO/Intune antes de instalar\n  (ver deployment/README.md).',
    'README nota SmartScreen',
  );
  readme = swap(
    readme,
    'installer-allinone.nsi   instalador con UAC (app + certificado + acceso directo)',
    'installer-allinone.nsi   instalador con UAC (app para todos los usuarios)',
    'README estructura',
  );
  fs.writeFileSync(readmePath, readme);

  const deployPath = path.join(root, 'deployment', 'README.md');
  let deploy = fs.readFileSync(deployPath, 'utf8');
  if (!deploy.includes('Ningún instalador instala el certificado')) {
    const section = `## Equipos sueltos: instalador AllInOne

Ningún instalador instala el certificado: embeber el \`.cer\` y ejecutar
\`certutil\` dispara detecciones de antivirus. Despliega el certificado por
GPO/Intune o con el script de esta carpeta **antes** de instalar.

- El \`AllInOne\` pide UAC e instala la app para todos los usuarios (Program
  Files).
- El instalador por usuario se instala en LocalAppData y no pide administrador.

## Archivos`;
    const sectionRe = /## Equipos sueltos: instalador AllInOne\n[\s\S]*?\n## Archivos/;
    if (!sectionRe.test(deploy)) {
      throw new Error(`No se encontró la sección de AllInOne en ${deployPath}`);
    }
    deploy = deploy.replace(sectionRe, section);
    fs.writeFileSync(deployPath, deploy);
  }

  const leemePath = path.join(root, 'release', 'LEEME.txt');
  if (fs.existsSync(leemePath)) {
    let leeme = fs.readFileSync(leemePath, 'utf8');
    leeme = leeme.replace(
      '\n- Instala el certificado de confianza de Ecommerce-JCTI en el equipo.',
      '',
    );
    leeme = leeme.replace(
      /- El primer AllInOne puede mostrar SmartScreen \("Windows protegió tu PC"\)\n  porque el certificado se instala durante la ejecución\.[\s\S]*?firmados por Ecommerce(?:-JCTI)? serán reconocidos en ese equipo\./,
      `- El instalador está firmado con un certificado autofirmado. Para que Windows
  lo reconozca, despliega el certificado público por GPO/Intune antes de
  instalar (ver deployment/README.md). Sin ese paso puede aparecer SmartScreen
  o "editor desconocido".`,
    );
    leeme = leeme.replace(
      /"\.\s*El AllInOne también\s+retira el\s+certificado de confianza\./,
      '".',
    );
    fs.writeFileSync(leemePath, leeme);
  }

  console.log(`OK: ${root}`);
}
