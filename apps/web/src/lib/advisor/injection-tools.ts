// Filtro de inyección sobre los resultados de herramientas del camino 3 (spec §12.2, fase 2).
// Envuelve `tools.run`: los textos de terceros pasan por reglas + Haiku antes de llegar al analista;
// una mención marcada conserva su ID y entra como «intento de manipulación». Lo marcado queda
// anotado para guardarlo en la corrida y mostrarlo en la deliberación.

import { applyInjectionVerdicts, extractThirdPartyTexts, screenMentions, type InjectionVerdict } from '@eco/shared/src/advisor/injection';
import type { AdvisorLLM, TokenLedger } from '@eco/shared/src/advisor/llm';
import type { Camino1Tool } from './camino1';

export interface InjectionFlag {
  id: string;
  motivo: string;
  capa: string;
}

export interface FilteredTools {
  tools: Camino1Tool;
  /** Marcas acumuladas durante la corrida (sin repetir IDs). */
  flags: () => InjectionFlag[];
  /** `false` si en alguna llamada el clasificador no respondió y solo actuaron las reglas. */
  modeloOk: () => boolean;
}

export function withInjectionFilter(tools: Camino1Tool, o: { llm: AdvisorLLM; fastModel: string; ledger?: TokenLedger; signal?: AbortSignal }): FilteredTools {
  const flags = new Map<string, InjectionFlag>();
  let modeloOk = true;
  return {
    tools: {
      defs: tools.defs,
      async run(name, args) {
        const r = await tools.run(name, args);
        if (!r.ok) return r;
        const items = extractThirdPartyTexts(r.text);
        if (items.length === 0) return r;
        const screened = await screenMentions(items, { llm: o.llm, model: o.fastModel, ledger: o.ledger, signal: o.signal });
        if (!screened.modelo_ok) modeloOk = false;
        const marked: InjectionVerdict[] = screened.verdicts.filter((v) => v.injection_suspected);
        for (const v of marked) flags.set(v.id, { id: v.id, motivo: v.motivo, capa: v.capa });
        if (marked.length === 0) return r;
        return { ...r, text: applyInjectionVerdicts(r.text, screened.verdicts) };
      },
    },
    flags: () => [...flags.values()],
    modeloOk: () => modeloOk,
  };
}
