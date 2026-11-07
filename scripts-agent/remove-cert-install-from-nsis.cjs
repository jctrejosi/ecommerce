#!/usr/bin/env node
/**
 * Quita la instalación automática del certificado de los instaladores AllInOne.
 *
 * Motivo: embeber un .cer y ejecutar `certutil -addstore Root` dispara heurísticas
 * de antivirus (instalación silenciosa de una CA raíz). El certificado se
 * despliega aparte por GPO/Intune.
 *
 * Uso: node scripts-agent/remove-cert-install-from-nsis.cjs
 */
const fs = require('node:fs');
const path = require('node:path');

const roots = [
  '/home/jk/Proyectos/dsi/ecommerce/Interface desktop admin',
  '/home/jk/Proyectos/dsi/ecommerce/Interface desktop delivery admin',
  '/home/jk/Proyectos/dsi/ecommerce/Interface desktop picking admin',
  '/home/jk/Proyectos/dsi/crm/Interface desktop crm',
];

function removeBlock(source, startToken) {
  const start = source.indexOf(startToken);
  if (start === -1) throw new Error(`No se encontró: ${startToken}`);
  const endToken = '${EnableX64FSRedirection}\n';
  const end = source.indexOf(endToken, start);
  if (end === -1) throw new Error('No se encontró el cierre del bloque');
  return source.slice(0, start) + source.slice(end + endToken.length);
}

for (const root of roots) {
  const nsiPath = path.join(root, 'installer-allinone.nsi');
  let nsi = fs.readFileSync(nsiPath, 'utf8');

  nsi = removeBlock(nsi, '  ; Certificado público que se agrega a la confianza del equipo.');
  nsi = removeBlock(
    nsi,
    '  ; Quitar el certificado de confianza instalado por este instalador.',
  );

  nsi = nsi.replace(
    '; Program Files, deja el acceso directo en el escritorio y agrega el\n; certificado público de firma en los almacenes LocalMachine.',
    '; Program Files y deja el acceso directo en el escritorio.\n; El certificado de firma se despliega aparte por GPO/Intune.',
  );
  nsi = nsi.replace(
    ', creará el acceso directo en el escritorio y agregará el certificado de confianza de Ecommerce.',
    ' y creará el acceso directo en el escritorio.',
  );

  if (nsi.includes('certutil.exe') || nsi.includes('@@CERT_FILE@@')) {
    throw new Error(`Quedaron referencias al certificado en ${nsiPath}`);
  }
  fs.writeFileSync(nsiPath, nsi);

  const buildPath = path.join(root, 'build-windows.cjs');
  let build = fs.readFileSync(buildPath, 'utf8');

  build = build.replace(
    'npm run build:win:admin      (AllInOne: pide UAC, instala app + certificado)',
    'npm run build:win:admin      (AllInOne: pide UAC, instala app para todos los usuarios)',
  );
  build = build.replace(
    /const certFile = path\.join\(root, 'deployment', '[^']+'\);\n/,
    '',
  );
  build = build.replace(
    /\n\/\*\* Thumbprint SHA-1 del certificado DER[\s\S]*?\n\}\n/,
    '\n',
  );
  build = build.replace(
    /\n  if \(allInOne && !fs\.existsSync\(certFile\)\) \{[\s\S]*?\n  \}\n/,
    '\n',
  );
  build = build.replace(
    /\n\s*\.replaceAll\('@@CERT_FILE@@'[^\n]*\n\s*\.replaceAll\('@@CERT_THUMBPRINT@@'[^\n]*/,
    '',
  );
  build = build.replace("const crypto = require('node:crypto');\n", '');

  if (build.includes('certFile') || build.includes('@@CERT_')) {
    throw new Error(`Quedaron referencias al certificado en ${buildPath}`);
  }
  fs.writeFileSync(buildPath, build);

  console.log(`OK: ${root}`);
}
