// Render canónico del memorando para la comparación pareada a ciegas (spec §13.3): mismo formato
// y mismo orden de secciones para todas las variantes, sin marcas de variante, sin la deliberación
// y sin los metadatos que delatan el camino (encabezado.camino y motivo, ids de objeciones, revisión).

type Obj = Record<string, unknown>;
const arr = (x: unknown): Obj[] => (Array.isArray(x) ? (x as Obj[]) : []);
const strs = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : []);
const s = (x: unknown): string => (typeof x === 'string' ? x : '');
const bullets = (xs: string[]) => (xs.length ? xs.map((x) => `- ${x}`).join('\n') : '- (ninguno)');

const LETTERS = ['A', 'B', 'C'];

export function renderMemoCanonical(memo: Obj): string {
  const out: string[] = [];
  const enc = (memo.encabezado ?? {}) as Obj;
  out.push(`# Memorando · ${s(enc.agencia)} · ${s(enc.fecha)}`);

  const hechos = (memo.hechos ?? {}) as Obj;
  out.push('## Lo que se sabe');
  out.push(bullets(arr(hechos.sabido).map((x) => `${s(x.afirmacion)}${strs(x.citas).length ? ` [${strs(x.citas).join(', ')}]` : ''}`)));
  out.push('## Lo que no está claro');
  out.push(bullets(arr(hechos.no_claro).map((x) => `${s(x.pregunta)} — lo aclararía: ${s(x.que_lo_aclararia)} (${s(x.cuando)})`)));
  out.push('## Supuestos');
  out.push(bullets(arr(hechos.supuesto).map((x) => s(x.afirmacion))));
  const lb = (memo.linea_base ?? {}) as Obj;
  out.push('## Si no se hace nada');
  out.push(`${s(lb.descripcion)}${lb.rango_indice_72h ? ` Rango del índice a 72 h: ${s(lb.rango_indice_72h)}.` : ''}`);

  const caminos = arr(memo.caminos);
  out.push('## Caminos');
  caminos.forEach((c, i) => {
    out.push(`### Camino ${LETTERS[i] ?? i + 1}: ${s(c.nombre)}`);
    out.push(`Qué: ${s(c.que)}\nQuién: ${s(c.quien)}\nCanal: ${s(c.canal)}\nCuándo: ${s(c.cuando)}\nPor qué: ${s(c.por_que)}`);
    out.push(`Reglas: ${strs(c.reglas).join(', ') || '—'}`);
    out.push(`Efectos esperados:\n${bullets(strs(c.efectos))}`);
    out.push(`Riesgos:\n${bullets(strs(c.riesgos))}`);
    out.push(`Supuestos:\n${bullets(strs(c.supuestos))}`);
  });

  const rec = (memo.recomendacion ?? {}) as Obj;
  const idx = typeof rec.camino === 'number' ? rec.camino : 0;
  out.push('## Recomendación');
  out.push(`Camino ${LETTERS[idx] ?? idx + 1} (confianza ${s(rec.confianza_cualitativa)}). ${s(rec.porque)}`);

  const se = (memo.senales ?? {}) as Obj;
  out.push('## Señales');
  for (const h of ['h24', 'h48', 'h72']) {
    const x = (se[h] ?? {}) as Obj;
    out.push(`${h.slice(1)} h — va bien si: ${s(x.va_bien_si)}; va mal si: ${s(x.va_mal_si)}`);
  }
  out.push(`Cambiar de camino si:\n${bullets(strs(se.cambiar_si))}`);

  out.push('## Disenso');
  out.push(bullets(strs(memo.disenso)));
  // Las objeciones del abogado del diablo van sin el id (C0-1…) que delata el consejo.
  out.push('## Objeciones y cómo se tratan');
  out.push(bullets(arr(memo.objeciones_da).map((o) => `${s(o.texto)} → ${s(o.estado)}: ${s(o.como)}`)));
  out.push('## Vetos legales');
  out.push(bullets(arr(memo.vetos).map((v) => `${s(v.texto)} (${s(v.estado)})`)));
  out.push('## Borradores');
  const bor = arr(memo.borradores);
  out.push(bor.length ? bor.map((b, i) => `Borrador ${i + 1} (${s(b.canal)}):\n${s(b.texto)}`).join('\n\n') : '- (ninguno)');
  out.push('## Límites');
  out.push(bullets(strs(memo.limites)));
  return out.join('\n\n');
}
