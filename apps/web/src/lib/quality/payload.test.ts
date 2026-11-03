import { pertinenceRows, promptVersionRows, parentRows, fullTextRows, sendRows, loadQuality, prStamp } from './payload';

jest.mock('@/lib/log', () => ({ log: { info: () => undefined, warn: () => undefined, error: () => undefined } }));

describe('filas del panel de calidad (puras)', () => {
  test('pertinencia: las cuatro filas, con la pendiente fuera del universo estricto', () => {
    const rows = pertinenceRows([{ k: 'alta', n: 50 }, { k: 'media', n: 30 }, { k: 'baja', n: 15 }, { k: null, n: 5 }], 100);
    expect(rows.map((r) => [r.label, r.value])).toEqual([['Alta', 50], ['Media', 30], ['Baja', 15], ['Pendiente (sin pertinencia)', 5]]);
    expect(rows[3].detail).toContain('fuera del universo estricto');
    expect(rows[0].detail).toContain('50 %');
  });
  test('sin menciones en la ventana: sin filas (el front dice «sin datos en el periodo»)', () => {
    expect(pertinenceRows([], 0)).toEqual([]);
    expect(promptVersionRows([], 0)).toEqual([]);
  });
  test('versión de la rúbrica: la mayor primero y NULL rotulada como rúbrica anterior', () => {
    const rows = promptVersionRows([{ v: null, n: 90 }, { v: 'v2', n: 10 }], 100);
    expect(rows[0]).toMatchObject({ label: 'Rúbrica anterior (sin versión)', value: 90 });
    expect(rows[1]).toMatchObject({ label: 'v2', value: 10 });
  });
  test('padres: por plataforma y un total solo si hay más de una', () => {
    const one = parentRows([{ platform: 'facebook', comments: 40, resolved: 10 }]);
    expect(one).toHaveLength(1);
    expect(one[0]).toMatchObject({ label: 'Facebook', value: '10 de 40' });
    expect(one[0].detail).toContain('25 %');
    const two = parentRows([{ platform: 'instagram', comments: 10, resolved: 10 }, { platform: 'facebook', comments: 30, resolved: 0 }, { platform: 'x', comments: 0, resolved: 0 }]);
    expect(two.map((r) => r.label)).toEqual(['Facebook', 'Instagram', 'Total']);
    expect(two[2].value).toBe('10 de 40');
    expect(parentRows([])).toEqual([]);
  });
  test('texto completo: con texto, intentadas sin éxito y sin intentar', () => {
    const rows = fullTextRows({ articles: 200, withText: 150, failed: 30, never: 20 });
    expect(rows.map((r) => r.value)).toEqual([150, 30, 20]);
    expect(rows[0].detail).toContain('75 %');
    expect(fullTextRows({ articles: 0, withText: 0, failed: 0, never: 0 })).toEqual([]);
  });
  test('envíos archivados: defectos, frases removidas y archivo por envío', () => {
    const r = sendRows([{ sentAt: '2026-11-02T10:00:00.000Z', templateKey: 'daily-sentiment-summary', status: 'sent', qaDefects: 2, removed: 0, composerVersion: 'c1', subject: '[Diario] DDEC · titular', degraded: true }]);
    expect(r.qaDefects[0]).toMatchObject({ value: 2, detail: 'detectados antes del envío' });
    expect(r.safetyNet[0]).toMatchObject({ value: 0, detail: 'ninguna frase removida' });
    expect(r.composerArchive[0].value).toBe('c1');
    expect(r.composerArchive[0].detail).toContain('degradado');
    expect(r.qaDefects[0].label).toMatch(/^Diario · /);
    expect(prStamp('2026-11-02T10:00:00.000Z')).toContain('6:00'); // 10:00Z = 6:00 AM en Puerto Rico
  });
});

describe('loadQuality', () => {
  const win = { startYmd: '2026-10-03', endYmd: '2026-11-01' };
  const ag = { slug: 'ddecpr', name: 'Departamento de Desarrollo Económico y Comercio' };

  test('todas las consultas van acotadas por agencia (y por ventana las de menciones); un bloque que falla queda en null sin tumbar el resto', async () => {
    const seen: Array<{ sql: string; params: unknown[] }> = [];
    const pool = {
      query: async (sql: string, params: unknown[]) => {
        const flat = sql.replace(/\s+/g, ' ');
        seen.push({ sql: flat, params });
        if (flat.includes('full_text')) throw new Error('column "full_text" does not exist');
        if (flat.includes('nlp_pertinence AS k')) return { rows: [{ k: 'alta', n: 8 }, { k: null, n: 2 }] };
        if (flat.includes('nlp_prompt_version AS v')) return { rows: [{ v: null, n: 10 }] };
        if (flat.includes('page_type) AS platform')) return { rows: [{ platform: 'facebook', comments: 4, resolved: 1 }] };
        return { rows: [] };
      },
    };
    const out = await loadQuality(pool as never, 'ag-1', ag, win);
    expect(seen).toHaveLength(5);
    for (const q of seen) expect(q.params[0]).toBe('ag-1');
    for (const q of seen.filter((x) => x.sql.includes('FROM mentions'))) {
      expect(q.params.slice(0, 3)).toEqual(['ag-1', '2026-10-03', '2026-11-01']);
      expect(q.sql).toContain('is_duplicate = false');
    }
    // El tipo «comentario» usa la MISMA expresión que el filtro mentionKind.
    expect(seen.find((x) => x.sql.includes('platform'))!.sql).toContain("COALESCE(mentions.mention_kind, CASE");
    expect(out.mentionsInWindow).toBe(10);
    expect(out.blocks.nullPertinence).toHaveLength(4);
    expect(out.blocks.parentResolution![0]).toMatchObject({ label: 'Facebook', value: '1 de 4' });
    expect(out.blocks.fullTextCoverage).toBeNull();
    expect(out.blocks.qaDefects).toEqual([]);
  });
});
