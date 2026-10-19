/**
 * Cobertura de datos (@eco/shared/coverage): inicio continuo y corte del
 * exporte para agencias importadas. Casos del examen de métricas de DF
 * (19-oct-2026): el Diario del 18 contó 271 menciones de 382 porque la
 * ventana incluía días sin cargar.
 */
import { coverageFromRow, reportWindowNow, closedWindowYmdInTZ } from '@eco/shared';

const DF_ROW = {
  brandwatch_project_id: null,
  brandwatch_query_ids: [-1001],
  start_ymd: '2026-07-28',
  // Segundo exporte: última mención 19-oct 9:38 a.m. AST.
  last_published_at: '2026-10-19T13:38:57.000Z',
  last_ingested_at: '2026-10-19T13:12:00.000Z',
};

describe('coverageFromRow', () => {
  test('DF: importada, inicio continuo y último día completo = el anterior al corte', () => {
    const c = coverageFromRow(DF_ROW);
    expect(c.importFed).toBe(true);
    expect(c.startYmd).toBe('2026-07-28');
    expect(c.lastCompleteYmd).toBe('2026-10-18');
  });

  test('una agencia de Brandwatch no es importada y no tiene corte', () => {
    const c = coverageFromRow({ ...DF_ROW, brandwatch_project_id: 1998405210, brandwatch_query_ids: [2003921640] });
    expect(c.importFed).toBe(false);
    expect(c.lastCompleteYmd).toBeNull();
  });

  test('archivada (sin proyecto ni query) tampoco es importada', () => {
    expect(coverageFromRow({ ...DF_ROW, brandwatch_query_ids: [] }).importFed).toBe(false);
  });

  test('sin fila → vacía', () => {
    expect(coverageFromRow(null)).toEqual({ importFed: false, startYmd: null, lastPublishedAt: null, lastIngestedAt: null, lastCompleteYmd: null });
  });
});

describe('reportWindowNow', () => {
  const now = new Date('2026-10-20T10:00:00.000Z'); // 20-oct 6:00 a.m. AST, hora del Diario

  test('DF: la ventana del Diario del 20-oct termina el 18 (el 19 solo tiene la mañana)', () => {
    const w = closedWindowYmdInTZ(7, reportWindowNow(coverageFromRow(DF_ROW), now), 'America/Puerto_Rico');
    expect([w.startYmd, w.endYmd]).toEqual(['2026-10-12', '2026-10-18']);
  });

  test('Brandwatch: la ventana sigue terminando ayer', () => {
    const bw = coverageFromRow({ ...DF_ROW, brandwatch_project_id: 1, brandwatch_query_ids: [2003911540] });
    const w = closedWindowYmdInTZ(7, reportWindowNow(bw, now), 'America/Puerto_Rico');
    expect(w.endYmd).toBe('2026-10-19');
  });

  test('un corte en el futuro (reloj adelantado) no mueve la ventana más allá de ahora', () => {
    const future = coverageFromRow({ ...DF_ROW, last_published_at: '2026-10-25T00:00:00.000Z' });
    expect(reportWindowNow(future, now)).toEqual(now);
  });
});
