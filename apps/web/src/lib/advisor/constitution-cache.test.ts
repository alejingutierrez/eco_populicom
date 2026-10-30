import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ECO_EDITORIAL_CONSTITUTION } from '@eco/shared/src/prompts/constitution';
import { ADVISOR_CONSTITUTION, ADVISOR_LAWS_1_TO_6 } from '@eco/shared/src/advisor/constitution';
import {
  buildFamilyASystem,
  buildFamilyBSystem,
  toolsFingerprint,
  withTurnBreakpoint,
} from '@eco/shared/src/advisor/cache';
import { MANUAL_TEXT, MANUAL_TEXT_SHA256 } from '@eco/shared/src/advisor/manual';
import { LEGAL_RULES_TEXT_SHA256 } from '@eco/shared/src/advisor/legal-rules';
import { TEMPLATES_TEXT_SHA256 } from '@eco/shared/src/advisor/templates';
import { ADVISOR_ROLES } from '@eco/shared/src/advisor/models';
import type { AdvisorMessage } from '@eco/shared/src/advisor/llm';

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

describe('los textos descriptivos no cambian (criterio de fase 0)', () => {
  // Huella de ECO_EDITORIAL_CONSTITUTION en origin/main (5046f5f). Si cambia, algo tocó los 14 textos.
  test('ECO_EDITORIAL_CONSTITUTION tiene la misma huella que en main', () => {
    expect(sha(ECO_EDITORIAL_CONSTITUTION)).toBe('c2f904e4e6aab5d9ef32914c11f28e2245cbd012e63cdbeab3b4fdc9e9814a7b');
  });
});

describe('constitución del asesor (spec §7.1)', () => {
  test('hereda las leyes 1 a 6 del archivo original, sin la 07', () => {
    for (const n of ['01.', '02.', '03.', '04.', '05.', '06.']) {
      expect(ADVISOR_LAWS_1_TO_6).toContain('\n' + n + ' ');
    }
    expect(ADVISOR_LAWS_1_TO_6).not.toContain('SE DESCRIBE, NO SE RECOMIENDA');
    expect(ECO_EDITORIAL_CONSTITUTION).toContain('SE DESCRIBE, NO SE RECOMIENDA');
  });

  test('incluye A-1 a A-8 y los cuatro bloques', () => {
    for (let i = 1; i <= 8; i++) expect(ADVISOR_CONSTITUTION).toContain(`A-${i}.`);
    for (const tag of ['politica_contenido_no_confiable', 'formato_de_citas', 'probabilidades', 'puntos_ciegos']) {
      expect(ADVISOR_CONSTITUTION).toContain(`<${tag}>`);
    }
  });
});

describe('prefijos de caché (spec §5.5)', () => {
  test('familia A: manual con breakpoint de 1 h, constitución sin breakpoint', () => {
    const sys = buildFamilyASystem({ constitution: 'C', manual: 'M' });
    expect(sys[0]).toEqual({ type: 'text', text: 'C' });
    expect(sys[1]).toEqual({ type: 'text', text: 'M', cache_control: { type: 'ephemeral', ttl: '1h' } });
  });

  test('familia B: manual 1 h y hoja de hechos 5 min', () => {
    const sys = buildFamilyBSystem({ constitution: 'C', manual: 'M', factSheet: 'F' });
    expect(sys.map((b) => ('cache_control' in b ? b.cache_control?.ttl : null))).toEqual([null, '1h', '5m']);
  });

  test('un UUID en el prefijo falla: no se cachea algo que cambia por corrida', () => {
    expect(() => buildFamilyASystem({ constitution: 'C', manual: 'corrida 0f1e2d3c-1111-2222-3333-444455556666' })).toThrow(/UUID/);
  });

  test('withTurnBreakpoint pone 5 min en el último bloque sin mutar el historial', () => {
    const msgs: AdvisorMessage[] = [
      { role: 'user', content: 'primera' },
      { role: 'assistant', content: [{ type: 'text', text: 'resp' }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: '{}' }] },
    ];
    const out = withTurnBreakpoint(msgs);
    const last = out[2].content as Array<{ cache_control?: { ttl?: string } }>;
    expect(last[0].cache_control).toEqual({ type: 'ephemeral', ttl: '5m' });
    // El original no cambió: append-only.
    expect((msgs[2].content as Array<{ cache_control?: unknown }>)[0].cache_control).toBeUndefined();
    expect(out[0]).toBe(msgs[0]);
  });

  test('la huella de herramientas cambia con el orden y con cualquier definición', () => {
    const a = [{ name: 'x', description: 'd', input_schema: {}, strict: true as const }, { name: 'y', description: 'd', input_schema: {}, strict: true as const }];
    const b = [a[1], a[0]];
    expect(toolsFingerprint(a)).not.toBe(toolsFingerprint(b));
    expect(toolsFingerprint(a)).toBe(toolsFingerprint(JSON.parse(JSON.stringify(a))));
  });

  test('camino 1 usa Sonnet a effort medium con 8k de salida', () => {
    expect(ADVISOR_ROLES.camino1).toEqual({ tier: 'MAIN', effort: 'medium', maxTokens: 8000 });
  });
});

describe('conocimiento generado (spec §7.2)', () => {
  test('manual.ts coincide con su hash y con el documento fuente', () => {
    expect(MANUAL_TEXT_SHA256).toBe(sha(MANUAL_TEXT));
    const src = readFileSync(join(__dirname, '..', '..', '..', '..', '..', 'docs', 'manejo-de-crisis', 'manual-eco.md'), 'utf8');
    expect(MANUAL_TEXT).toBe(src);
  });

  test('los hashes de legal-rules y templates están presentes y son SHA-256', () => {
    expect(LEGAL_RULES_TEXT_SHA256).toMatch(/^[0-9a-f]{64}$/);
    expect(TEMPLATES_TEXT_SHA256).toMatch(/^[0-9a-f]{64}$/);
  });
});
