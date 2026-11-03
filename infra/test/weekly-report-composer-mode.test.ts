import {
  composeAheadHour,
  composeDeadlineMs,
  isComposeAheadDue,
  LEGACY_RESERVE_MS,
  markerIds,
  MIN_REMAINING_MS_TO_COMPOSE,
  normalizeComposerMode,
  planDailyText,
  resolveComposerMode,
  withinDriftTolerance,
} from '../lambda/weekly-report/composer-mode';

/**
 * Selección de modo y decisiones de tiempo del correo diario con el motor
 * (WP-6). La regla que no se negocia: ningún camino retiene un correo.
 */
describe('composer_mode', () => {
  test('valores desconocidos o vacíos son legacy', () => {
    expect(normalizeComposerMode('agentic')).toBe('agentic');
    expect(normalizeComposerMode(' Shadow ')).toBe('shadow');
    for (const v of [null, undefined, '', 'agéntico', 'on', 1, {}]) expect(normalizeComposerMode(v)).toBe('legacy');
  });

  test('el override del payload solo vale en dryRun', () => {
    expect(resolveComposerMode('legacy', 'agentic', true)).toBe('agentic');
    expect(resolveComposerMode('legacy', 'agentic', false)).toBe('legacy');
    expect(resolveComposerMode('shadow', undefined, true)).toBe('shadow');
    expect(resolveComposerMode('agentic', 'basura', true)).toBe('agentic');
    expect(resolveComposerMode(null, null, true)).toBe('legacy');
  });
});

describe('composición anticipada', () => {
  test('2 h antes del envío, con vuelta de medianoche', () => {
    expect(composeAheadHour(6)).toBe(4);
    expect(composeAheadHour(1)).toBe(23);
    expect(composeAheadHour(0)).toBe(22);
    expect(composeAheadHour(15)).toBe(13);
  });

  test('solo con el motor encendido y a la hora exacta', () => {
    expect(isComposeAheadDue(4, 6, 'shadow')).toBe(true);
    expect(isComposeAheadDue(4, 6, 'agentic')).toBe(true);
    expect(isComposeAheadDue(4, 6, 'legacy')).toBe(false);
    expect(isComposeAheadDue(5, 6, 'agentic')).toBe(false);
    expect(isComposeAheadDue(6, 6, 'agentic')).toBe(false);
  });
});

describe('planDailyText', () => {
  const plenty = 880_000;
  const tight = MIN_REMAINING_MS_TO_COMPOSE - 1;

  test('legacy nunca compone', () => {
    for (const stored of ['fresh', 'refreshable', 'stale', 'missing'] as const) {
      expect(planDailyText({ mode: 'legacy', dryRun: false, stored, remainingMs: plenty })).toEqual({ text: 'legacy', compose: 'none', reason: 'mode_legacy' });
      expect(planDailyText({ mode: 'legacy', dryRun: true, stored, remainingMs: plenty }).compose).toBe('none');
    }
  });

  test('shadow siempre envía legacy; archiva la guardada o pide una asíncrona', () => {
    expect(planDailyText({ mode: 'shadow', dryRun: false, stored: 'fresh', remainingMs: plenty })).toMatchObject({ text: 'legacy', compose: 'stored' });
    expect(planDailyText({ mode: 'shadow', dryRun: false, stored: 'stale', remainingMs: plenty })).toMatchObject({ text: 'legacy', compose: 'stored' });
    expect(planDailyText({ mode: 'shadow', dryRun: false, stored: 'missing', remainingMs: plenty })).toMatchObject({ text: 'legacy', compose: 'async' });
    // Sin tiempo, shadow no cambia: el legacy sale igual.
    expect(planDailyText({ mode: 'shadow', dryRun: false, stored: 'missing', remainingMs: 1_000 })).toMatchObject({ text: 'legacy' });
  });

  test('agentic usa la guardada si sirve, aunque quede poco tiempo', () => {
    expect(planDailyText({ mode: 'agentic', dryRun: false, stored: 'fresh', remainingMs: 10_000 })).toEqual({ text: 'composer', compose: 'stored', reason: 'stored_fresh' });
    expect(planDailyText({ mode: 'agentic', dryRun: false, stored: 'refreshable', remainingMs: 10_000 })).toEqual({ text: 'composer', compose: 'stored', reason: 'stored_refreshed' });
  });

  test('agentic compone en el momento solo con más de 420 s; si no, legacy', () => {
    expect(planDailyText({ mode: 'agentic', dryRun: false, stored: 'missing', remainingMs: plenty })).toEqual({ text: 'composer', compose: 'now', reason: 'stored_missing' });
    expect(planDailyText({ mode: 'agentic', dryRun: false, stored: 'stale', remainingMs: plenty })).toEqual({ text: 'composer', compose: 'now', reason: 'stored_stale' });
    expect(planDailyText({ mode: 'agentic', dryRun: false, stored: 'missing', remainingMs: tight })).toEqual({ text: 'legacy', compose: 'none', reason: 'no_time' });
    expect(planDailyText({ mode: 'agentic', dryRun: false, stored: 'missing', remainingMs: MIN_REMAINING_MS_TO_COMPOSE })).toMatchObject({ text: 'legacy' });
  });

  test('dryRun compone de cero en shadow y agentic (sin leer la tabla)', () => {
    expect(planDailyText({ mode: 'agentic', dryRun: true, stored: 'fresh', remainingMs: plenty })).toEqual({ text: 'composer', compose: 'now', reason: 'dry_run' });
    expect(planDailyText({ mode: 'shadow', dryRun: true, stored: 'missing', remainingMs: plenty })).toEqual({ text: 'legacy', compose: 'now', reason: 'dry_run' });
    expect(planDailyText({ mode: 'agentic', dryRun: true, stored: 'missing', remainingMs: tight })).toMatchObject({ text: 'legacy', compose: 'none' });
  });

  test('ninguna combinación deja el envío sin texto', () => {
    for (const mode of ['legacy', 'shadow', 'agentic'] as const) {
      for (const dryRun of [false, true]) {
        for (const stored of ['fresh', 'refreshable', 'stale', 'missing'] as const) {
          for (const remainingMs of [0, tight, plenty]) {
            const p = planDailyText({ mode, dryRun, stored, remainingMs });
            expect(['legacy', 'composer']).toContain(p.text);
            if (p.compose === 'now') expect(remainingMs).toBeGreaterThan(MIN_REMAINING_MS_TO_COMPOSE);
          }
        }
      }
    }
  });

  test('el plazo del motor deja la reserva para el legacy', () => {
    expect(composeDeadlineMs(900_000)).toBe(900_000 - LEGACY_RESERVE_MS);
    expect(composeDeadlineMs(100_000)).toBe(0);
  });
});

describe('deriva de cifras entre la composición y el envío', () => {
  test('tolerancia: 3 menciones o 5 %', () => {
    expect(withinDriftTolerance(64, 66)).toBe(true);
    expect(withinDriftTolerance(64, 67)).toBe(true);
    expect(withinDriftTolerance(64, 68)).toBe(false);
    expect(withinDriftTolerance(700, 734)).toBe(true);
    expect(withinDriftTolerance(700, 736)).toBe(false);
    expect(withinDriftTolerance(NaN, 1)).toBe(false);
  });

  test('markerIds recorre el borrador entero', () => {
    const draft = {
      headline: 'Comentarios tardíos',
      paragraph: 'Hubo {{day_total}} menciones y {{ comment_share_week }} de comentarios.',
      highlights: ['{{series_2026-10-26}} el lunes'],
      insights: { negative: ['{{week_neg}}'], neutral: [], positive: [] },
    };
    expect(markerIds(draft).sort()).toEqual(['comment_share_week', 'day_total', 'series_2026-10-26', 'week_neg']);
    expect(markerIds(null)).toEqual([]);
  });
});
