// REGLA DE DECISIÓN de la sección 13.3, escrita antes de correr. No se cambia con los resultados:
//
//   · El consejo (c) se queda si gana a (a′) en preferencia pareada de los consultores por 15
//     puntos o más y no empeora el Brier ni la tasa de citas válidas.
//   · Si (c) no gana a (a′), el camino 3 pasa a ser (a′) con premortem, y el consejo se guarda
//     solo como modo «deliberación visible» opcional.
//   · El panel (b) se queda si gana a (a) por 10 puntos o más; si no, el camino 2 pasa a ser (a).
//
// «Puntos» = diferencia de preferencia en puntos porcentuales: % de pares que prefieren X menos % que
// prefieren Y (un empate cuenta medio punto para cada lado). Ver `preferenceMargin` en pairwise.ts.
// El error estándar NO mueve el umbral: solo se reporta si el intervalo del 95 % lo cruza.

export const COUNCIL_MARGIN_POINTS = 15;
export const PANEL_MARGIN_POINTS = 10;

export interface MarginEstimate {
  /** Diferencia de preferencia X − Y, en puntos porcentuales (−100 a 100). */
  points: number | null;
  /** Error estándar agrupado por episodio; null o NaN si no se pudo calcular. */
  se: number | null;
  n?: number;
}

export interface DecisionInput {
  /** (c) frente a (a′). */
  cVsA2: MarginEstimate;
  /** (b) frente a (a). */
  bVsA: MarginEstimate;
  /** Brier de las predicciones, menor es mejor. */
  brier: { c: number | null; a2: number | null };
  /** Tasa de citas válidas, mayor es mejor. */
  citeRate: { c: number | null; a2: number | null };
}

export type CouncilDecision = 'consejo_se_queda' | 'camino3_es_a2_con_premortem' | 'pendiente_datos';
export type PanelDecision = 'panel_se_queda' | 'camino2_es_a' | 'pendiente_datos';

export interface DecisionResult {
  council: CouncilDecision;
  panel: PanelDecision;
  reasons: string[];
  /** Verdadero si el IC95 % del margen cruza el umbral: la decisión es la de la regla, pero frágil. */
  councilIndistinguishable: boolean | null;
  panelIndistinguishable: boolean | null;
  /** Cuando el consejo no se queda, el spec lo conserva como modo «deliberación visible» opcional. */
  councilAsVisibleDeliberationMode: boolean;
}

const known = (x: number | null | undefined): x is number => typeof x === 'number' && Number.isFinite(x);

function crossesThreshold(m: MarginEstimate, threshold: number): boolean | null {
  if (!known(m.points) || !known(m.se)) return null;
  return m.points - 1.96 * m.se < threshold && m.points + 1.96 * m.se > threshold;
}

export function decide(input: DecisionInput): DecisionResult {
  const reasons: string[] = [];

  // ---- Consejo (c) frente a (a′) ----
  let council: CouncilDecision;
  const { cVsA2, brier, citeRate } = input;
  if (!known(cVsA2.points) || !known(brier.c) || !known(brier.a2) || !known(citeRate.c) || !known(citeRate.a2)) {
    council = 'pendiente_datos';
    const faltan = [
      !known(cVsA2.points) && 'preferencia pareada (c) vs (a′)',
      (!known(brier.c) || !known(brier.a2)) && 'Brier de (c) y (a′)',
      (!known(citeRate.c) || !known(citeRate.a2)) && 'tasa de citas válidas de (c) y (a′)',
    ].filter(Boolean);
    reasons.push(`Consejo: faltan datos (${faltan.join('; ')}); la regla no se puede aplicar.`);
  } else {
    const gana = cVsA2.points >= COUNCIL_MARGIN_POINTS;
    const brierOk = brier.c <= brier.a2;
    const citasOk = citeRate.c >= citeRate.a2;
    reasons.push(`Consejo vs (a′): preferencia ${cVsA2.points.toFixed(1)} puntos (umbral ${COUNCIL_MARGIN_POINTS}) → ${gana ? 'cumple' : 'no cumple'}.`);
    reasons.push(`Brier (c) ${brier.c.toFixed(4)} frente a (a′) ${brier.a2.toFixed(4)} → ${brierOk ? 'no empeora' : 'empeora'}.`);
    reasons.push(`Citas válidas (c) ${(citeRate.c * 100).toFixed(1)} % frente a (a′) ${(citeRate.a2 * 100).toFixed(1)} % → ${citasOk ? 'no empeora' : 'empeora'}.`);
    council = gana && brierOk && citasOk ? 'consejo_se_queda' : 'camino3_es_a2_con_premortem';
  }

  // ---- Panel (b) frente a (a) ----
  let panel: PanelDecision;
  if (!known(input.bVsA.points)) {
    panel = 'pendiente_datos';
    reasons.push('Panel: falta la preferencia pareada (b) vs (a); la regla no se puede aplicar.');
  } else {
    const gana = input.bVsA.points >= PANEL_MARGIN_POINTS;
    reasons.push(`Panel vs (a): preferencia ${input.bVsA.points.toFixed(1)} puntos (umbral ${PANEL_MARGIN_POINTS}) → ${gana ? 'cumple' : 'no cumple'}.`);
    panel = gana ? 'panel_se_queda' : 'camino2_es_a';
  }

  const councilIndistinguishable = crossesThreshold(cVsA2, COUNCIL_MARGIN_POINTS);
  const panelIndistinguishable = crossesThreshold(input.bVsA, PANEL_MARGIN_POINTS);
  if (councilIndistinguishable) reasons.push('Aviso: el IC95 % del margen del consejo cruza el umbral de 15 puntos; la regla decide, pero con poca certeza.');
  if (panelIndistinguishable) reasons.push('Aviso: el IC95 % del margen del panel cruza el umbral de 10 puntos; la regla decide, pero con poca certeza.');

  return {
    council, panel, reasons, councilIndistinguishable, panelIndistinguishable,
    councilAsVisibleDeliberationMode: council === 'camino3_es_a2_con_premortem',
  };
}
