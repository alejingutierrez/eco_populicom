// ============================================================
// ECO Platform — Canonical source (page_type → fuente) mapping
// ============================================================
//
// FUENTE ÚNICA DE VERDAD para el mapeo entre el `page_type` crudo de Brandwatch
// y la "fuente" canónica que muestra el dashboard (Facebook, Instagram, …).
//
// Contexto del bug que motivó este módulo (QA jul 2026): `page_type` en la DB
// trae variantes con sufijo — `facebook_public`, `instagram_public` — además de
// las bare (`facebook`, `instagram`) y plataformas sin bucket propio (`bluesky`,
// `tumblr`). La AGREGACIÓN de las cards (eco-data) siempre agrupó por SUBSTRING
// (`sourceKey`, `.includes()`), colapsando `instagram_public` → instagram. Pero
// los DRILLDOWNS (eco-mentions, eco-geo) filtraban con match EXACTO
// (`page_type IN ('instagram')`), así que ignoraban `instagram_public` — el bulk
// real — y devolvían 0/undercount. bluesky/tumblr ni siquiera tenían entrada.
//
// Para que agregación y filtro NUNCA vuelvan a divergir, ambos derivan de
// `SOURCE_DEFS`:
//   - `sourceKey(pageType)` — page_type → key canónica (para agrupar).
//   - `pageTypeMatchClause()` — el reverso, para filtrar en SQL por substring.
//
// El ORDEN de SOURCE_DEFS importa: se evalúa de arriba a abajo, primer match
// gana (igual que la cadena de `if` original de sourceKey).

export interface SourceDef {
  /** Key canónica que viaja al frontend y de vuelta como filtro. */
  key: string;
  /** Etiqueta para la UI. */
  label: string;
  /** Substrings de `page_type` (lowercased) que mapean a esta fuente. */
  substrings: string[];
  /** Valores exactos de `page_type` (lowercased) que mapean a esta fuente. */
  exact?: string[];
}

export const SOURCE_DEFS: SourceDef[] = [
  { key: 'facebook', label: 'Facebook', substrings: ['facebook'] },
  { key: 'twitter', label: 'X / Twitter', substrings: ['twitter', 'xcom'], exact: ['x'] },
  { key: 'instagram', label: 'Instagram', substrings: ['instagram'] },
  { key: 'youtube', label: 'YouTube', substrings: ['youtube'] },
  { key: 'blog', label: 'Blogs', substrings: ['blog'] },
  { key: 'news', label: 'Noticias', substrings: ['news', 'forum'] },
];

/** page_type crudo → fuente canónica. Substring-based; primer match gana. */
export function sourceKey(pageType: string | null | undefined): string {
  const t = (pageType ?? '').toLowerCase();
  for (const def of SOURCE_DEFS) {
    if (def.exact && def.exact.includes(t)) return def.key;
    if (def.substrings.some((s) => t.includes(s))) return def.key;
  }
  return t || 'otros';
}

/** fuente canónica → etiqueta de UI. */
export function sourceLabel(key: string): string {
  const def = SOURCE_DEFS.find((d) => d.key === key);
  if (def) return def.label;
  if (key === 'otros') return 'Otros';
  return key;
}

/** ¿La key corresponde a una fuente "conocida" (que colapsa variantes)? */
export function isKnownSourceKey(key: string): boolean {
  return SOURCE_DEFS.some((d) => d.key === key.toLowerCase());
}

/**
 * Reverso de `sourceKey`, en forma de cláusula SQL portátil (parametrizada
 * manualmente por el caller). Devuelve la lista de comparaciones para que la
 * fuente pedida capture EXACTAMENTE los mismos `page_type` que `sourceKey`
 * agruparía bajo esa key. El caller las une con OR (o NOT(...) para 'otros').
 *
 * Semántica, espejo de sourceKey:
 *   - fuente conocida (facebook, instagram, …): match por substring/exacto.
 *   - 'otros': NINGUNA fuente conocida matchea (el complemento).
 *   - fallthrough (bluesky, tumblr, reddit, …): sourceKey devuelve el page_type
 *     crudo, así que el filtro es match exacto sobre ese valor.
 *
 * Devuelve descriptores neutrales ({ op, value }) — cada ruta los traduce a su
 * dialecto (Drizzle `sql`, pg placeholders, etc.). `col` se asume ya
 * normalizado a lowercase por el caller (p.ej. LOWER(COALESCE(page_type,''))).
 */
export type SourceMatchTerm = { op: 'like'; value: string } | { op: 'eq'; value: string };

export function sourceMatchTerms(source: string): {
  negate: boolean;
  terms: SourceMatchTerm[];
} {
  const s = (source ?? '').toLowerCase();
  const def = SOURCE_DEFS.find((d) => d.key === s);
  if (def) {
    return { negate: false, terms: defToTerms(def) };
  }
  if (s === 'otros') {
    // Complemento: todo page_type que no cae en ninguna fuente conocida.
    return {
      negate: true,
      terms: SOURCE_DEFS.flatMap((d) => defToTerms(d)),
    };
  }
  // Fallthrough (bluesky, tumblr, …): match exacto sobre el page_type crudo.
  return { negate: false, terms: [{ op: 'eq', value: s }] };
}

function defToTerms(def: SourceDef): SourceMatchTerm[] {
  return [
    ...def.substrings.map((sub): SourceMatchTerm => ({ op: 'like', value: `%${sub}%` })),
    ...(def.exact ?? []).map((ex): SourceMatchTerm => ({ op: 'eq', value: ex })),
  ];
}
