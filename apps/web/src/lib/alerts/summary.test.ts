import { daysOverWithoutAlert, groupEpisodes, resolveAlertsWindow, type AlertRow } from './summary';

const mk = (id: string, day: string, hour = '18'): AlertRow => ({
  id, at: `${day}T${hour}:00:00.000Z`, day, ruleId: 'r', ruleName: 'Crisis', ruleType: 'crisis_threshold',
  band: 'ALERTA', score: 0.4, total: 40, negative: 30, headline: 'h', sent: 10, mentionIds: [],
});

describe('episodios de alertas', () => {
  // Los avisos reales de DF de oct–nov de 2026.
  const alerts = ['2026-10-16', '2026-10-21', '2026-11-02', '2026-11-12', '2026-11-13', '2026-11-16', '2026-11-17', '2026-11-18']
    .map((d, i) => mk(`a${i}`, d));
  const scores = new Map([['2026-11-12', 0.53], ['2026-11-13', 0.49], ['2026-11-14', 0.2], ['2026-11-16', 0.93], ['2026-11-17', 0.82], ['2026-11-18', 0.48]]);

  it('agrupa por cercanía y devuelve del más reciente al más antiguo', () => {
    const eps = groupEpisodes(alerts, scores);
    expect(eps.map((e) => [e.from, e.to, e.alertIds.length])).toEqual([
      ['2026-11-12', '2026-11-18', 5],
      ['2026-11-02', '2026-11-02', 1],
      ['2026-10-21', '2026-10-21', 1],
      ['2026-10-16', '2026-10-16', 1],
    ]);
    expect(eps[0].days).toBe(7);
    expect(eps[0].peak).toEqual({ score: 0.93, day: '2026-11-16' });
    // Dentro del episodio, el aviso más reciente va primero.
    expect(eps[0].alertIds[0]).toBe('a7');
  });

  it('sin serie diaria de esos días no inventa una lectura más alta', () => {
    expect(groupEpisodes(alerts, scores)[3].peak).toBeNull();
  });

  it('marca abierto el episodio que llega al día del episodio guardado', () => {
    const eps = groupEpisodes(alerts, scores, { openFromDay: '2026-11-12' });
    expect(eps.map((e) => e.open)).toEqual([true, false, false, false]);
  });

  it('una separación mayor al margen parte el episodio', () => {
    expect(groupEpisodes([mk('x', '2026-11-01'), mk('y', '2026-11-05')], new Map())).toHaveLength(2);
    expect(groupEpisodes([mk('x', '2026-11-01'), mk('y', '2026-11-04')], new Map())).toHaveLength(1);
  });
});

describe('días sobre el umbral sin aviso', () => {
  it('excluye hoy, los días con aviso y los que quedan bajo el umbral al redondear', () => {
    const series = [
      { date: '2026-10-31', score: 0.406 },
      { date: '2026-11-01', score: 0.403 },
      { date: '2026-11-02', score: 0.439 },
      { date: '2026-11-03', score: 0.394 },
      { date: '2026-11-04', score: null },
      { date: '2026-11-05', score: 0.9 },
    ];
    expect(daysOverWithoutAlert(series, new Set(['2026-11-02']), 0.4, '2026-11-05')).toEqual(['2026-10-31', '2026-11-01']);
  });
});

describe('ventana de la pantalla según el selector de fechas', () => {
  const today = '2026-11-24';

  it('sin fechas: los últimos 31 días hasta hoy', () => {
    expect(resolveAlertsWindow(null, null, today)).toEqual({
      from: '2026-10-25', to: today, days: 31, seriesFrom: '2026-10-25', seriesExtended: false, seriesTruncated: false,
    });
  });

  it('un periodo de 30 días se usa tal cual', () => {
    const w = resolveAlertsWindow('2026-10-26', '2026-11-24', today);
    expect([w.from, w.to, w.days, w.seriesFrom]).toEqual(['2026-10-26', '2026-11-24', 30, '2026-10-26']);
  });

  it('«Ayer» lista solo ese día, pero el gráfico muestra la semana', () => {
    const w = resolveAlertsWindow('2026-11-23', '2026-11-23', today);
    expect([w.from, w.to, w.days]).toEqual(['2026-11-23', '2026-11-23', 1]);
    expect(w.seriesFrom).toBe('2026-11-17');
    expect(w.seriesExtended).toBe(true);
  });

  it('un año lista todo el año, pero el gráfico se queda con los 120 días más recientes', () => {
    const w = resolveAlertsWindow('2025-11-25', '2026-11-24', today);
    expect(w.days).toBe(365);
    expect(w.seriesFrom).toBe('2026-07-28');
    expect(w.seriesTruncated).toBe(true);
  });

  it('un fin futuro se recorta a hoy y unas fechas inválidas caen al periodo por defecto', () => {
    expect(resolveAlertsWindow('2026-11-20', '2026-12-31', today).to).toBe(today);
    expect(resolveAlertsWindow('2026-11-20', '2026-11-10', today).days).toBe(31);
    expect(resolveAlertsWindow('ayer', 'hoy', today).days).toBe(31);
    expect(resolveAlertsWindow('2027-01-01', '2027-01-05', today).days).toBe(31);
  });
});
