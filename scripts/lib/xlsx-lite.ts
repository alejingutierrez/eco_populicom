/**
 * Lector mínimo de .xlsx (primera hoja → filas por nombre de columna) sin
 * dependencias: un xlsx es un zip con XML adentro, así que basta con
 * node:zlib para inflar las entradas y unas pocas expresiones regulares para
 * el XML de SpreadsheetML. Cubre lo que producen los exportes de Bunker:
 * cadenas compartidas (t="s"), cadenas en línea (t="inlineStr"), fórmulas con
 * texto (t="str"), booleanos y números. NO interpreta estilos: una fecha
 * guardada como número de serie llega como número (Bunker exporta DATE y TIME
 * como texto).
 */
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

function readZipEntries(buf: Buffer): Map<string, Buffer> {
  // End of central directory: firma 0x06054b50 en los últimos ~64 KB.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('No es un archivo zip/xlsx (sin directorio central)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Directorio central corrupto');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    // El encabezado local tiene su propio largo de nombre y de extra.
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    const data = buf.subarray(start, start + compSize);
    if (method === 0) out.set(name, Buffer.from(data));
    else if (method === 8) out.set(name, inflateRawSync(data));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

/** Texto de un <si> o <is>: concatena todos los <t> (incluye runs de texto enriquecido). */
function textOf(xml: string): string {
  let out = '';
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)) out += decodeXml(m[1] ?? '');
  return out;
}

/** "AB12" → índice de columna 27 (base 0). */
function colIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Ruta de la primera hoja según workbook.xml + sus relaciones. */
function firstSheetPath(entries: Map<string, Buffer>): string {
  const wb = entries.get('xl/workbook.xml')?.toString('utf8') ?? '';
  const rels = entries.get('xl/_rels/workbook.xml.rels')?.toString('utf8') ?? '';
  const rid = wb.match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1];
  if (rid) {
    const rel = rels.match(new RegExp(`<Relationship\\b[^>]*\\bId="${rid}"[^>]*>`))?.[0];
    const target = rel?.match(/\bTarget="([^"]+)"/)?.[1];
    if (target) {
      const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
      if (entries.has(path)) return path;
    }
  }
  if (entries.has('xl/worksheets/sheet1.xml')) return 'xl/worksheets/sheet1.xml';
  throw new Error('No encontré la primera hoja del xlsx');
}

/** Filas de la primera hoja como objetos {columna: valor}; la fila 1 son los encabezados. */
export function readXlsxRows(file: string): Record<string, string | number | boolean | null>[] {
  const entries = readZipEntries(readFileSync(file));
  const shared: string[] = [];
  const ss = entries.get('xl/sharedStrings.xml')?.toString('utf8');
  if (ss) for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(textOf(m[1]));

  const sheet = entries.get(firstSheetPath(entries))!.toString('utf8');
  const grid: (string | number | boolean | null)[][] = [];
  for (const rm of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: (string | number | boolean | null)[] = [];
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const inner = cm[2] ?? '';
      const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1];
      const type = attrs.match(/\bt="([^"]+)"/)?.[1];
      const idx = ref ? colIndex(ref) : row.length;
      const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let value: string | number | boolean | null = null;
      if (type === 's') value = v != null ? shared[Number(v)] ?? null : null;
      else if (type === 'inlineStr') value = textOf(inner.match(/<is>([\s\S]*?)<\/is>/)?.[1] ?? '');
      else if (type === 'str' || type === 'e') value = v != null ? decodeXml(v) : null;
      else if (type === 'b') value = v === '1';
      else if (v != null) value = Number.isFinite(Number(v)) ? Number(v) : decodeXml(v);
      row[idx] = value;
    }
    grid.push(row);
  }
  const header = (grid.shift() ?? []).map((h) => String(h ?? '').trim());
  return grid
    .filter((r) => r.some((c) => c != null && c !== ''))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? null])));
}
