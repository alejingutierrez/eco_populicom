/**
 * Genera el conocimiento del asesor desde los documentos fuente (spec §7.2):
 *   manual-eco.md                          → packages/shared/src/advisor/manual.ts
 *   investigacion/09 §C (LC-1…LC-28)       → packages/shared/src/advisor/legal-rules.ts
 *   investigacion/10 anexo A (A-0…A-22)    → packages/shared/src/advisor/templates.ts
 *
 * Cada módulo lleva el SHA-256 de su fuente. `advisor_runs.knowledge_version` guarda esos
 * hashes: una regla citada que no existe en esa versión cuenta como cita inválida.
 * Se corre en `prebuild` de apps/web y en `pretest`. Los archivos generados no se editan
 * ni se versionan (están en .gitignore).
 *
 * Uso: npx tsx scripts/build-advisor-knowledge.ts
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = join(ROOT, 'docs', 'manejo-de-crisis');
const OUT = join(ROOT, 'packages', 'shared', 'src', 'advisor');

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

/** Texto entre un encabezado de nivel 2 que empieza con `start` y el siguiente encabezado de nivel 2. */
function section(doc: string, start: string, sourcePath: string): string {
  const lines = doc.split('\n');
  const from = lines.findIndex((l) => l.startsWith(start));
  if (from < 0) throw new Error(`${sourcePath}: no se encontró el encabezado "${start}"`);
  let to = lines.length;
  for (let i = from + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) {
      to = i;
      break;
    }
  }
  return lines.slice(from, to).join('\n').trimEnd() + '\n';
}

function emit(file: string, header: string, constName: string, text: string, sourceRel: string): string {
  const hash = sha256(text);
  const body = `// GENERADO por scripts/build-advisor-knowledge.ts. No editar a mano.
${header}
export const ${constName}_SOURCE = ${JSON.stringify(sourceRel)} as const;
export const ${constName}_SHA256 = ${JSON.stringify(hash)} as const;
export const ${constName}: string = ${JSON.stringify(text)};
`;
  writeFileSync(join(OUT, file), body, 'utf8');
  return hash;
}

function main(): void {
  mkdirSync(OUT, { recursive: true });

  const manualPath = join(DOCS, 'manual-eco.md');
  const legalPath = join(DOCS, 'investigacion', '09-legal-pr-y-protocolos.md');
  const templPath = join(DOCS, 'investigacion', '10-caja-de-herramientas.md');

  const manual = readFileSync(manualPath, 'utf8');
  const legal = section(readFileSync(legalPath, 'utf8'), '## C. ', legalPath);
  const templates = section(readFileSync(templPath, 'utf8'), '## Anexo A.', templPath);

  const hManual = emit('manual.ts', '', 'MANUAL_TEXT', manual, 'docs/manejo-de-crisis/manual-eco.md');
  const hLegal = emit(
    'legal-rules.ts',
    '// Solo §C: reglas de cumplimiento del asiento legal y del revisor (LC-1…LC-28).',
    'LEGAL_RULES_TEXT',
    legal,
    'docs/manejo-de-crisis/investigacion/09-legal-pr-y-protocolos.md#C',
  );
  const hTempl = emit(
    'templates.ts',
    '// Anexo A: plantillas listas (A-0…A-22).',
    'TEMPLATES_TEXT',
    templates,
    'docs/manejo-de-crisis/investigacion/10-caja-de-herramientas.md#anexo-a',
  );

  console.log(JSON.stringify({ manual: hManual, legal: hLegal, templates: hTempl }));
}

main();
