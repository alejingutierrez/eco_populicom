/**
 * Modal de KPI con el motor de redacción, perfil ligero (WP-8; spec 10.6 y
 * 11.4): redactor + QA por código + una vuelta de corrector, sin analista ni
 * QA agente (latencia de usuario: p95 < 6 s).
 *
 * El titular no se muestra en el modal: se pide corto para que un aviso
 * blando de largo no dispare la vuelta del corrector (medido: 2 de 20
 * invocaciones pasaban de 6 s solo por eso).
 *
 * El número lo pone el MARCADOR (`{{kpi_value}}`, `{{kpi_delta}}`…), no el
 * modelo; la banda (CRISIS, ALERTA…) la calcula el código como hoy y entra
 * al prompt como palabra del contexto. Este módulo es puro (sin DB ni SDK):
 * la ruta le pasa los datos ya cargados y el cliente LLM.
 */
import {
  compose,
  COMPOSER_PROFILES,
  COMPOSER_MODEL_SONNET,
  formatMetric,
  toBhi10,
  type BandedMetricKey,
  type ComposeResult,
  type ComposerInput,
  type ComposerLlm,
  type ComposerProfile,
  type Fact,
  type MetricKey,
  type RoleModels,
} from '@eco/shared';

/** Sonnet en redactor y corrector: el modal espera al usuario. */
export const KPI_MODELS: Partial<RoleModels> = { writer: COMPOSER_MODEL_SONNET, corrector: COMPOSER_MODEL_SONNET };

const METRIC_NAMES: Record<MetricKey, string> = {
  nss: 'sentimiento neto (NSS)',
  crisis: 'riesgo de crisis',
  volume: 'volumen de menciones',
  bhi: 'salud de marca (BHI)',
  polarization: 'polarización',
};

/** Perfil ligero con la tarea del modal (misma forma y etapas que `light`). */
export const KPI_LIGHT_PROFILE: ComposerProfile = {
  ...COMPOSER_PROFILES.light,
  writerTask: `

TAREA (rol REDACTOR): explica en el modal de la métrica POR QUÉ tiene el valor que tiene en este periodo, en UNA sola pasada:
- headline: etiqueta interna de 4 a 10 palabras con sujeto y verbo literal, sin cifras ni dramatismo (el modal no la muestra: no la alargues).
- paragraph: 2 o 3 oraciones (unas 60 palabras). Cita el valor y su banda tal como vienen (el valor solo con su marcador; la banda con la palabra del contexto), di si subió o bajó contra el periodo previo con su marcador y qué tópicos lo explican, con sus marcadores. No expliques la fórmula ni recomiendes acciones.
- highlights: lista vacía.
Responde con la herramienta.`,
  maxTokens: { analyst: 0, writer: 900, qa: 0, corrector: 900 },
};

const r1 = (n: number) => Math.round(n * 10) / 10;
const signed = (n: number, suffix = '') => `${n > 0 ? '+' : ''}${n}${suffix}`;

/**
 * Hechos del KPI en la escala que ve el usuario (la de las tarjetas):
 * crisis y polarización 0–100 con «%», BHI 1–10, NSS −100..100, volumen en
 * menciones. `value` es el número que el lint acepta en el texto.
 */
export function kpiFacts(args: {
  metric: MetricKey;
  /** Valor CRUDO (crisis/bhi 0–1, polarización 0–100, nss −100..100, volumen). */
  raw: number | null;
  prevRaw: number | null;
  p25: number | null;
  p75: number | null;
  topics: Array<{ name: string; share: number }>;
}): Fact[] {
  const { metric, raw, prevRaw } = args;
  const out: Fact[] = [];
  const scale = (v: number | null): number | null => {
    if (v == null || !Number.isFinite(v)) return null;
    if (metric === 'crisis') return Math.round(v * 100);
    if (metric === 'bhi') return r1(toBhi10(v));
    if (metric === 'polarization') return Math.round(v);
    if (metric === 'volume') return Math.round(v);
    return r1(v);
  };
  const unit = metric === 'crisis' || metric === 'polarization' ? ' %' : '';
  const band = raw != null && metric !== 'volume' ? formatMetric(metric as BandedMetricKey, raw).word : null;
  const v = scale(raw);
  if (v != null) {
    const disp = metric === 'nss' ? signed(v) : `${v}${unit}`;
    out.push({ id: 'kpi_value', value: v, display: disp, label: `${METRIC_NAMES[metric]} del periodo${band ? `; banda ${band}` : ''}` });
  }
  if (metric === 'bhi') out.push({ id: 'kpi_scale_max', value: 10, display: '10', label: 'máximo de la escala de salud de marca (1 a 10)' });
  const pv = scale(prevRaw);
  if (v != null && pv != null) {
    if (metric === 'volume') {
      out.push({ id: 'kpi_prev_value', value: pv, display: `${pv}`, label: 'menciones del periodo previo' });
    } else {
      const d = metric === 'bhi' || metric === 'nss' ? r1(v - pv) : Math.round(v - pv);
      const u = metric === 'crisis' || metric === 'polarization' ? ' puntos' : '';
      out.push({ id: 'kpi_prev_value', value: pv, display: metric === 'nss' ? signed(pv) : `${pv}${unit}`, label: `${METRIC_NAMES[metric]} del periodo previo` });
      out.push({ id: 'kpi_delta', value: d, display: signed(d, u), label: 'variación contra el periodo previo' });
    }
  }
  const p25 = scale(args.p25);
  const p75 = scale(args.p75);
  if (p25 != null && p75 != null && metric !== 'volume') {
    out.push({ id: 'kpi_p25', value: p25, display: metric === 'nss' ? signed(p25) : `${p25}${unit}`, label: 'percentil 25 de los 90 días previos (rango habitual, piso)' });
    out.push({ id: 'kpi_p75', value: p75, display: metric === 'nss' ? signed(p75) : `${p75}${unit}`, label: 'percentil 75 de los 90 días previos (rango habitual, techo)' });
    out.push({ id: 'kpi_history_days', value: 90, display: '90', label: 'días de historia del rango habitual' });
  }
  args.topics.slice(0, 3).forEach((t, i) => {
    const s = Math.round(t.share * 100);
    out.push({ id: `kpi_topic_${i + 1}_share`, value: s, display: `${s} %`, label: `% de las menciones del periodo en el tópico «${t.name}»` });
  });
  return out;
}

export interface KpiComposerArgs {
  agencyId: string;
  agencyName: string;
  shortName: string;
  metric: MetricKey;
  startYmd: string;
  endYmd: string;
  prevStartYmd: string;
  prevEndYmd: string;
  raw: number | null;
  prevRaw: number | null;
  band: string;
  p25: number | null;
  p75: number | null;
  topics: Array<{ name: string; share: number }>;
  totals: { negative: number; neutral: number; positive: number; total: number };
  prevTotals: { negative: number; neutral: number; positive: number; total: number } | null;
  dailySeries: Array<{ date: string; negative: number; neutral: number; positive: number }>;
}

export function kpiComposerInput(a: KpiComposerArgs): ComposerInput {
  const bandWord = a.raw != null && a.metric !== 'volume' ? formatMetric(a.metric as BandedMetricKey, a.raw).word : null;
  const ctx = [
    `MÉTRICA DEL MODAL: ${METRIC_NAMES[a.metric]}.`,
    bandWord ? `BANDA (calculada por el código; cítala tal cual): ${bandWord}.` : null,
    a.topics.length ? `TÓPICOS QUE MÁS PESAN: ${a.topics.slice(0, 3).map((t) => t.name).join('; ')}.` : null,
  ].filter(Boolean).join('\n');
  return {
    agency: { id: a.agencyId, name: a.agencyName, shortName: a.shortName },
    window: { startYmd: a.startYmd, endYmd: a.endYmd, prevStartYmd: a.prevStartYmd, prevEndYmd: a.prevEndYmd, timeZone: 'America/Puerto_Rico' },
    totals: a.totals,
    prevTotals: a.prevTotals,
    dailySeries: a.dailySeries,
    samples: {
      today: [], negative: [], neutral: [], positive: [],
      droppedByThreadCap: { today: 0, negative: 0, neutral: 0, positive: 0 },
    },
    extraFacts: kpiFacts({ metric: a.metric, raw: a.raw, prevRaw: a.prevRaw, p25: a.p25, p75: a.p75, topics: a.topics }),
    extraContext: ctx,
    nameWhitelist: a.topics.map((t) => t.name),
  };
}

/** Texto del modal: el párrafo final (solo `<strong>`), con el tope legacy. */
export function kpiInterpretation(r: ComposeResult): string | null {
  // Sin borrador del redactor el párrafo es el determinista genérico del motor:
  // el caller usa entonces la interpretación por reglas de siempre.
  if (!r.composition.draft1Raw) return null;
  const t = String(r.final.paragraph ?? '').trim().replace(/<(?!\/?strong\b)[^>]*>/gi, '').slice(0, 1200);
  return t || null;
}

export async function composeKpi(input: ComposerInput, llm: ComposerLlm | null): Promise<ComposeResult> {
  // Un reintento y espera corta: el usuario está mirando el modal.
  return compose(KPI_LIGHT_PROFILE, input, { llm, models: KPI_MODELS, retries: 2, backoffMs: 500 });
}
