// Ronda C · Contención inmediata (spec §8.3, §3.2, §15 fase 2). Corre en la web, en paralelo con la
// ronda 0: no espera la hoja de hechos del analista. La entrada es una hoja PRELIMINAR armada con
// código a partir de lo que el triaje ya calculó (índice, alertas, veda, guía probable) más la
// plantilla de la guía (A-1 a A-8). Entrega un borrador de declaración en las seis partes de M-21,
// marcado como borrador, con la revisión mecánica de los trece puntos. Nunca se publica solo.

import { structuredJson, TokenLedger, type AdvisorLLM } from '@eco/shared/src/advisor/llm';
import { buildFamilyBSystem } from '@eco/shared/src/advisor/cache';
import { ADVISOR_CONSTITUTION } from '@eco/shared/src/advisor/constitution';
import { MANUAL_TEXT } from '@eco/shared/src/advisor/manual';
import { TEMPLATES_TEXT } from '@eco/shared/src/advisor/templates';
import { reviewDraft } from '@eco/shared/src/advisor/review';
import { HOLDING_SCHEMA, validateHolding } from '@eco/shared/src/advisor/schemas';

/** Plantilla de contención por guía (manual §5: G-x → A-n). Sin guía reconocida, la base A-1. */
const TEMPLATE_BY_GUIDE: Record<string, string> = {
  'G-1': 'A-2', 'G-2': 'A-3', 'G-3': 'A-4', 'G-4': 'A-5', 'G-5': 'A-6', 'G-11': 'A-7', 'G-12': 'A-8',
};

/** Texto de una plantilla del Anexo A (`### A-n. …` hasta el siguiente `###`). */
export function templateSection(templates: string, id: string): string | null {
  const lines = templates.split('\n');
  const from = lines.findIndex((l) => l.startsWith(`### ${id}.`));
  if (from < 0) return null;
  let to = lines.length;
  for (let i = from + 1; i < lines.length; i++) if (lines[i].startsWith('### ')) { to = i; break; }
  return lines.slice(from, to).join('\n').trimEnd();
}

export function holdingTemplateFor(guia: string | null, templates: string = TEMPLATES_TEXT): { id: string; text: string } {
  const id = (guia && TEMPLATE_BY_GUIDE[guia]) || 'A-1';
  const text = templateSection(templates, id) ?? templateSection(templates, 'A-1') ?? '';
  return { id, text };
}

export interface PreliminarySheet {
  pregunta: string;
  agencia: string;
  fecha: string;
  guiaProbable: string | null;
  vedaActiva: boolean;
  riesgoPersonas: boolean;
  /** Salida de `situacion_actual` ya parseada (índice, banda, componentes…), o null. */
  situacion: Record<string, unknown> | null;
}

export interface HoldingResult {
  holding: Record<string, unknown>;
  plantilla: string;
  revision: { ok: boolean; alertas: number; puntos: ReturnType<typeof reviewDraft>['puntos'] };
  ms: number;
}

export async function runContention(
  d: { llm: AdvisorLLM; model: string; ledger: TokenLedger; esFamilia: boolean; signal?: AbortSignal },
  sheet: PreliminarySheet,
): Promise<HoldingResult> {
  const t0 = Date.now();
  const tpl = holdingTemplateFor(sheet.guiaProbable);
  const prelim = JSON.stringify({ ...sheet, nota: 'Hoja preliminar: solo lo que el sistema midió; los hechos de la crisis aún no están verificados.' });
  const system = buildFamilyBSystem({ constitution: ADVISOR_CONSTITUTION, manual: MANUAL_TEXT, factSheet: prelim });
  const req = {
    model: d.model, effort: 'low' as const, maxTokens: 2000, system, outputSchema: HOLDING_SCHEMA as unknown as Record<string, unknown>, signal: d.signal,
    messages: [{
      role: 'user' as const,
      content:
        `Asiento: redactor de contención. Redacta el borrador de la declaración de contención de ${sheet.agencia} (fecha: ${sheet.fecha}), ` +
        'en las seis partes de M-21 y en un solo texto_final de 80 a 150 palabras que se lea en menos de 60 segundos. ' +
        'Usa español de Puerto Rico, trato de usted, sin adjetivos, sin culpables y sin cifras que no estén en la hoja preliminar. ' +
        'Lo que todavía no se sabe se dice así. Los datos que faltan van entre llaves, como {hora_de_corte} o {qué_pasó}, para que la persona los complete. ' +
        'La próxima actualización lleva una hora concreta o su llave {hora}. Es un borrador para aprobación humana: nunca se publica solo. ' +
        `Pregunta de la persona: ${sheet.pregunta}\n\nPlantilla (${tpl.id}):\n${tpl.text}`,
    }],
  };
  let holding: Record<string, unknown> | null = null;
  for (let attempt = 0; attempt < 2 && !holding; attempt++) {
    const res = await d.llm.create(req);
    d.ledger.add(d.model, res);
    try {
      holding = validateHolding(structuredJson(res));
    } catch {
      holding = null;
    }
  }
  if (!holding) throw new Error('contention_invalid');
  const r = reviewDraft(String(holding.texto_final), { vedaActiva: sheet.vedaActiva, esFamilia: d.esFamilia });
  return { holding, plantilla: tpl.id, revision: { ok: r.alertas === 0, alertas: r.alertas, puntos: r.puntos }, ms: Date.now() - t0 };
}
