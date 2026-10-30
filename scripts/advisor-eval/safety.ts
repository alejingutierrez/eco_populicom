// Runner MECÁNICO del set de seguridad (spec §12.6): lo que se puede verificar por código, sin modelo.
//   · inyección: la capa de reglas de `screenByRules` marca (o no marca) cada mención;
//   · línea roja: el detector marca la mala recomendación y deja pasar la buena (valida el DETECTOR,
//     no la conducta del asesor, que solo se ve con un modelo real);
//   · Familia con un menor: el revisor mecánico marca el punto 13 en el borrador malo y no en el bueno.
// Los casos que dependen de un modelo se cuentan aparte: no se ejecutan aquí y no suman cobertura.

import { screenByRules } from '../../packages/shared/src/advisor/injection';
import { reviewDraft } from '../../packages/shared/src/advisor/review';
import { detectRedLines } from '../../packages/shared/src/advisor/eval/redlines';

export type SafetyCase =
  | { id: string; categoria: 'inyeccion'; idioma: string; mencion: string; esperado: { injection_suspected: boolean }; cubre: 'mecanico' | 'requiere_modelo'; nota?: string }
  | { id: string; categoria: 'linea_roja'; linea: string; pregunta: string; malaRecomendacion: string; buenaRecomendacion: string; vedaActiva: boolean; cubre: string; nota?: string }
  | { id: string; categoria: 'familia_menor'; pregunta: string; borradorMalo: string; borradorBueno: string; cubre: string; nota?: string };

export interface SafetySet {
  version: string;
  casos: SafetyCase[];
}

export interface SafetyResult {
  id: string;
  ok: boolean;
  motivo?: string;
}

export interface SafetyReport {
  results: SafetyResult[];
  failures: SafetyResult[];
  /** Casos verificados por código. */
  mecanicos: number;
  /** Casos cuya parte de CONDUCTA del asesor requiere un modelo real (no ejecutados aquí). */
  requierenModelo: number;
  /** Casos que se saltan por completo aquí porque solo los puede juzgar un modelo. */
  soloModelo: string[];
}

export function runSafetyMechanical(set: SafetySet): SafetyReport {
  const results: SafetyResult[] = [];
  const soloModelo: string[] = [];
  let requierenModelo = 0;
  for (const c of set.casos) {
    if (c.categoria === 'inyeccion') {
      if (c.cubre === 'requiere_modelo') { soloModelo.push(c.id); requierenModelo++; continue; }
      const [v] = screenByRules([{ id: c.id, texto: c.mencion }]);
      const ok = v.injection_suspected === c.esperado.injection_suspected;
      results.push({ id: c.id, ok, motivo: ok ? undefined : `esperaba injection_suspected=${c.esperado.injection_suspected} y las reglas dieron ${v.injection_suspected}` });
    } else if (c.categoria === 'linea_roja') {
      requierenModelo++; // la conducta del asesor frente al empuje no se prueba aquí
      const mala = detectRedLines(c.malaRecomendacion, { vedaActiva: c.vedaActiva });
      const buena = detectRedLines(c.buenaRecomendacion, { vedaActiva: c.vedaActiva });
      const marcaMala = mala.some((h) => h.linea === c.linea);
      const ok = marcaMala && buena.length === 0;
      results.push({ id: c.id, ok, motivo: ok ? undefined : !marcaMala ? `el detector no marcó ${c.linea} en la mala recomendación` : `el detector marcó la buena recomendación: ${buena.map((h) => h.linea).join(', ')}` });
    } else {
      requierenModelo++;
      const malo = reviewDraft(c.borradorMalo, { vedaActiva: false, esFamilia: true }).puntos.find((p) => p.id === 13);
      const bueno = reviewDraft(c.borradorBueno, { vedaActiva: false, esFamilia: true }).puntos.find((p) => p.id === 13);
      const ok = malo?.estado === 'alerta' && bueno?.estado === 'ok';
      results.push({ id: c.id, ok, motivo: ok ? undefined : `punto 13: malo=${malo?.estado}, bueno=${bueno?.estado}` });
    }
  }
  return { results, failures: results.filter((r) => !r.ok), mecanicos: results.length, requierenModelo, soloModelo };
}
