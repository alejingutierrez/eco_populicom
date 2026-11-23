/**
 * INT-02: el signo de una variación no se repite cuando el texto ya dice el
 * sentido, y una palabra de dirección que contradice su cifra es un defecto
 * duro. Los textos son de correos enviados entre el 5 y el 23-nov-2026.
 */
import {
  buildFactPackage, buildLintContext, codeLint, compose, fillDraft, fillPlaceholders, findSignedDirections, statedDirection,
  type CodeDefect, type ComposerLlm, type ComposerLlmRequest, type Draft, type Fact,
} from '@eco/shared';
import { fixtureInput } from '@eco/shared/src/composer/test-fixtures';

const fact = (id: string, value: number, display: string): Fact => ({ id, value, display, label: id });
const FACTS: Record<string, Fact> = {
  day_total: fact('day_total', 103, '103'),
  day_delta_pct: fact('day_delta_pct', -53, '-53 %'),
  day_delta_abs: fact('day_delta_abs', -78, '-78'),
  week_total: fact('week_total', 745, '745'),
  week_neg_pct: fact('week_neg_pct', 63, '63 %'),
  week_total_delta_pct: fact('week_total_delta_pct', 83, '+83 %'),
  week_neg_delta_pct: fact('week_neg_delta_pct', 65, '+65 %'),
  ind_nss: fact('ind_nss', -13.2, '−13.2'),
  ind_nss_prev: fact('ind_nss_prev', 12.7, '+12.7'),
  ind_nss_delta: fact('ind_nss_delta', -25.9, '−25.9'),
};
const fill = (t: string) => { const problems: CodeDefect[] = []; return { text: fillPlaceholders(t, FACTS, 'párrafo', problems), problems }; };

describe('relleno de una variación con signo', () => {
  test.each([
    ['El volumen del jueves bajó {{day_delta_pct}} respecto al miércoles.', 'El volumen del jueves bajó 53 % respecto al miércoles.'],
    ['El volumen bajó a {{day_total}} menciones, un {{day_delta_pct}} menos que el martes.', 'El volumen bajó a 103 menciones, un 53 % menos que el martes.'],
    ['El día cerró con {{day_total}} menciones, {{day_delta_pct}} menos que el viernes.', 'El día cerró con 103 menciones, 53 % menos que el viernes.'],
    ['frente a las 136 del viernes, una caída de {{day_delta_pct}}.', 'frente a las 136 del viernes, una caída de 53 %.'],
    ['—{{week_total}} menciones, {{week_neg_pct}} negativas— creció {{week_total_delta_pct}} respecto al periodo anterior', '—745 menciones, 63 % negativas— creció 83 % respecto al periodo anterior'],
    ['La semana cerró con {{week_total}} menciones, un aumento de {{week_total_delta_pct}}.', 'La semana cerró con 745 menciones, un aumento de 83 %.'],
    ['con {{week_total}} menciones, {{week_total_delta_pct}} más que la anterior', 'con 745 menciones, 83 % más que la anterior'],
    ['Hubo {{day_delta_abs}} menciones menos que ayer.', 'Hubo 78 menciones menos que ayer.'],
    ['El sentimiento neto bajó {{ind_nss_delta}} puntos.', 'El sentimiento neto bajó 25.9 puntos.'],
  ])('%s', (raw, expected) => {
    const r = fill(raw);
    expect(r.text).toBe(expected);
    expect(r.problems).toEqual([]);
  });

  test('sin palabra de dirección, el signo es lo único que dice el sentido y se conserva', () => {
    expect(fill('con {{day_total}} menciones frente a las 136 del viernes 20 ({{day_delta_pct}}) y las 238 del jueves.').text)
      .toBe('con 103 menciones frente a las 136 del viernes 20 (-53 %) y las 238 del jueves.');
    // «menos» antes de la cifra no es el sentido de la variación.
    expect(fill('Fue el día con menos menciones de la semana: {{day_total}}, {{day_delta_pct}} contra el sábado.').text)
      .toBe('Fue el día con menos menciones de la semana: 103, -53 % contra el sábado.');
    // La palabra de otra oración no cuenta.
    expect(fill('El martes el volumen subió. El miércoles la variación fue de {{day_delta_pct}}.').text)
      .toBe('El martes el volumen subió. El miércoles la variación fue de -53 %.');
  });

  test('un recorrido entre dos niveles no es una variación: los signos del NSS se quedan', () => {
    expect(fill('el sentimiento neto bajó de {{ind_nss_prev}} a {{ind_nss}}').text).toBe('el sentimiento neto bajó de +12.7 a −13.2');
    expect(findSignedDirections('el sentimiento neto bajó de +12.7 a −13.2')).toEqual([]);
  });

  test('el «%» repetido tras el marcador se quita', () => {
    expect(fill('cerró con {{week_total}} menciones, {{week_neg_pct}} % negativas —un aumento de {{week_neg_delta_pct}} % en menciones negativas').text)
      .toBe('cerró con 745 menciones, 63 % negativas —un aumento de 65 % en menciones negativas');
  });

  test('si el texto dice lo contrario de la cifra, se deja el signo y se reporta', () => {
    const r = fill('El volumen del jueves subió {{day_delta_pct}} respecto al miércoles.');
    expect(r.text).toBe('El volumen del jueves subió -53 % respecto al miércoles.');
    expect(r.problems).toEqual([{ where: 'párrafo', type: 'direccion_contradice_cifra', quote: '{{day_delta_pct}}', severity: 'hard' }]);
    expect(fill('{{week_total_delta_pct}} menos que la semana anterior').problems.map((p) => p.type)).toEqual(['direccion_contradice_cifra']);
  });

  test('statedDirection: la palabra más cercana manda', () => {
    expect(statedDirection('Las negativas subieron y el volumen bajó ', ' respecto')).toBe('down');
    expect(statedDirection('El asunto «Aumento salarial» tuvo 23 menciones. La variación fue de ', '.')).toBeNull();
  });
});

describe('lint del texto rellenado', () => {
  const pkg = buildFactPackage(fixtureInput());
  const ctx = buildLintContext(pkg, fixtureInput().samples, []);
  const types = (t: string) => codeLint(t, 'párrafo', ctx).map((d) => d.type).filter((t2) => t2 !== 'cifra_sin_fuente');

  test('«subió -18 %» y «una caída de +12 %» son defecto duro; «bajó 18 %» y «(-18 %)» no', () => {
    expect(types('El volumen subió -18 % respecto al miércoles.')).toEqual(['direccion_contradice_cifra']);
    expect(types('Hubo una caída de +12 % en las menciones.')).toEqual(['direccion_contradice_cifra']);
    expect(types('El volumen bajó 18 % respecto al miércoles.')).toEqual([]);
    expect(types('Hubo 32 menciones frente a las 136 del viernes (-18 %).')).toEqual([]);
    expect(findSignedDirections('El volumen bajó -18 % respecto al miércoles.')).toEqual([{ quote: '-18 %', kind: 'signo_doble' }]);
  });
});

describe('en el motor', () => {
  const FINDINGS = { threads: [], week: { negative: [], neutral: [], positive: [] } };
  const draft = (paragraph: string): Draft => ({
    headline: 'Usuarios preguntaron por la panadería', paragraph, highlights: [], insights: { negative: [], neutral: [], positive: [] },
  });
  const fast = { sleep: async () => {}, backoffMs: 0 };
  const deltaId = Object.keys(buildFactPackage(fixtureInput()).facts).find((k) => /^week_total_delta_pct$/.test(k))!;
  const value = buildFactPackage(fixtureInput()).facts[deltaId].value;
  const [agree, clash] = value > 0 ? ['subió', 'bajó'] : ['bajó', 'subió'];

  function run(writer: Draft, corrector: Draft) {
    const calls: ComposerLlmRequest[] = [];
    const llm: ComposerLlm = {
      async invokeTool(req) {
        calls.push(req);
        if (req.role === 'analyst') return FINDINGS;
        if (req.role === 'writer') return writer;
        if (req.role === 'corrector') return corrector;
        return { defects: [] };
      },
    };
    return compose('daily', fixtureInput(), { llm, dryRun: true, ...fast }).then((r) => ({ r, calls }));
  }

  test('la contradicción va al corrector; si la arregla, sale sin signo', async () => {
    const bad = draft(`El volumen de la semana ${clash} {{${deltaId}}}. Varios usuarios preguntaron por la panadería.`);
    const good = draft(`El volumen de la semana ${agree} {{${deltaId}}}. Varios usuarios preguntaron por la panadería.`);
    const { r, calls } = await run(bad, good);
    expect(r.composition.qa.code.map((d) => d.type)).toContain('direccion_contradice_cifra');
    expect(calls.at(-1)!.role).toBe('corrector');
    expect(r.final.paragraph).toBe(`El volumen de la semana ${agree} ${Math.abs(value)} %. Varios usuarios preguntaron por la panadería.`);
    expect(r.composition.residualCodeProblems).toEqual([]);
  });

  test('si el corrector no la arregla, la red de seguridad quita la oración', async () => {
    const bad = draft(`El volumen de la semana ${clash} {{${deltaId}}}. Varios usuarios preguntaron por la panadería.`);
    const { r } = await run(bad, bad);
    expect(r.final.paragraph).toBe('Varios usuarios preguntaron por la panadería.');
    expect(r.composition.safetyNetLog.some((l) => l.action === 'frase_removida' && l.reasons.some((x) => x.type === 'direccion_contradice_cifra'))).toBe(true);
    expect(r.composition.residualCodeProblems).toEqual([]);
  });
});
