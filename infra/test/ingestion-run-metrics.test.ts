import { METRICS_NAMESPACE, buildRunMetricsLine, maxMinutesSinceServed } from '../lambda/ingestion/run-metrics';

const NOW = Date.parse('2026-11-13T17:30:00Z');

describe('maxMinutesSinceServed', () => {
  const served = new Map<number, { lastRunAt: Date | string | null }>([
    [1, { lastRunAt: new Date('2026-11-13T17:25:00Z') }],
    [2, { lastRunAt: '2026-11-13T16:00:00Z' }],
    [3, { lastRunAt: null }],
  ]);

  test('la antigüedad del sondeo más viejo, en minutos', () => {
    expect(maxMinutesSinceServed([1, 2], served, NOW)).toBe(90);
    expect(maxMinutesSinceServed([1], served, NOW)).toBe(5);
  });

  test('una query sin fila de cursor o sin fecha no cuenta', () => {
    expect(maxMinutesSinceServed([1, 3, 99], served, NOW)).toBe(5);
  });

  test('sin ninguna fecha válida → null (no se publica la métrica)', () => {
    expect(maxMinutesSinceServed([3, 99], served, NOW)).toBeNull();
    expect(maxMinutesSinceServed([], served, NOW)).toBeNull();
    expect(maxMinutesSinceServed([7], new Map([[7, { lastRunAt: 'no es fecha' }]]), NOW)).toBeNull();
  });

  test('un reloj adelantado en la base no da minutos negativos', () => {
    expect(maxMinutesSinceServed([7], new Map([[7, { lastRunAt: '2026-11-13T17:31:00Z' }]]), NOW)).toBe(0);
  });
});

describe('buildRunMetricsLine', () => {
  const base = {
    mode: 'incremental' as const,
    timestampMs: NOW,
    queriesOk: 6,
    queriesFailed: 0,
    aborted: false,
    rateLimited: 0,
    requests: 6,
    quotaUsedMax: 18,
    maxMinutesSinceServed: 5.1,
  };

  test('es una sola línea de JSON con el formato EMF', () => {
    const line = buildRunMetricsLine(base);
    expect(line).not.toContain('\n');
    const parsed = JSON.parse(line);
    expect(parsed._aws.Timestamp).toBe(NOW);
    expect(parsed._aws.CloudWatchMetrics).toHaveLength(1);
    expect(parsed._aws.CloudWatchMetrics[0].Namespace).toBe(METRICS_NAMESPACE);
    expect(parsed).toMatchObject({
      Modo: 'incremental',
      QueriesSondeadas: 6,
      QueriesFallidas: 0,
      CorridaAbortada: 0,
      Avisos429: 0,
      Peticiones: 6,
      CuotaUsadaMax: 18,
      MinutosSinSondeoMax: 5.1,
    });
  });

  test('toda métrica declarada tiene su valor en la raíz (si no, CloudWatch la descarta)', () => {
    const parsed = JSON.parse(buildRunMetricsLine(base));
    for (const m of parsed._aws.CloudWatchMetrics[0].Metrics) {
      expect(typeof parsed[m.Name]).toBe('number');
    }
    for (const dims of parsed._aws.CloudWatchMetrics[0].Dimensions) {
      for (const d of dims) expect(typeof parsed[d]).toBe('string');
    }
  });

  test('sin dato de cuota ni de antigüedad, esas dos métricas no se declaran', () => {
    const parsed = JSON.parse(buildRunMetricsLine({ ...base, quotaUsedMax: null, maxMinutesSinceServed: null }));
    const names = parsed._aws.CloudWatchMetrics[0].Metrics.map((m: { Name: string }) => m.Name);
    expect(names).not.toContain('CuotaUsadaMax');
    expect(names).not.toContain('MinutosSinSondeoMax');
    expect(parsed).not.toHaveProperty('CuotaUsadaMax');
  });

  test('una corrida abortada vale 1', () => {
    expect(JSON.parse(buildRunMetricsLine({ ...base, aborted: true })).CorridaAbortada).toBe(1);
  });
});
