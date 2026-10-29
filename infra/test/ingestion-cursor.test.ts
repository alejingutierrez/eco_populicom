import * as fs from 'fs';
import * as path from 'path';
import { advanceCursorMs, latestMentionDateMs, shouldTouchCursor } from '../lambda/ingestion/cursor';

const gobernadoraPage: Array<{ date: string | null; pageType: string }> = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures/ingestion-gobernadora-page.json'), 'utf8'),
);

const ms = (iso: string) => Date.parse(iso);
const shell = { date: null };

describe('latestMentionDateMs', () => {
  test('toma la fecha máxima aunque el último elemento sea un shell sin fecha (el bug)', () => {
    const page = [
      { date: '2026-10-26T10:00:00.000+0000' },
      shell,
      { date: '2026-10-26T19:58:45.000+0000' },
      shell,
      shell, // último elemento: shell de X
    ];
    expect(latestMentionDateMs(page)).toBe(ms('2026-10-26T19:58:45.000Z'));
  });

  test('no depende del orden: toma el máximo, no el último con fecha', () => {
    const page = [{ date: '2026-10-26T12:00:00Z' }, { date: '2026-10-26T08:00:00Z' }];
    expect(latestMentionDateMs(page)).toBe(ms('2026-10-26T12:00:00Z'));
  });

  test('null, vacío, ausente y no parseable se ignoran', () => {
    const page = [{ date: null }, { date: '' }, {}, { date: 'garbage' }, { date: '2026-10-26T01:00:00Z' }];
    expect(latestMentionDateMs(page)).toBe(ms('2026-10-26T01:00:00Z'));
  });

  test('página sin ninguna fecha válida → null', () => {
    expect(latestMentionDateMs([shell, shell, { date: 'x' }])).toBeNull();
    expect(latestMentionDateMs([])).toBeNull();
  });

  test('entiende el formato +0000 de Brandwatch igual que Z', () => {
    expect(latestMentionDateMs([{ date: '2026-10-26T19:58:45.000+0000' }])).toBe(
      ms('2026-10-26T19:58:45.000Z'),
    );
  });

  test('las fechas posteriores al techo (endDate de la corrida) no mueven el cursor', () => {
    const ceiling = ms('2026-10-26T21:35:15Z');
    const page = [{ date: '2026-10-26T20:00:00Z' }, { date: '2027-01-01T00:00:00Z' }];
    expect(latestMentionDateMs(page, ceiling)).toBe(ms('2026-10-26T20:00:00Z'));
    expect(latestMentionDateMs([{ date: '2027-01-01T00:00:00Z' }], ceiling)).toBeNull();
  });
});

describe('advanceCursorMs', () => {
  test('avanza con el máximo entre lo acumulado y la página', () => {
    const cur = ms('2026-10-26T10:00:00Z');
    expect(advanceCursorMs(cur, [{ date: '2026-10-26T12:00:00Z' }])).toBe(ms('2026-10-26T12:00:00Z'));
  });

  test('nunca retrocede: una página más vieja o de puros shells deja el cursor igual', () => {
    const cur = ms('2026-10-26T10:00:00Z');
    expect(advanceCursorMs(cur, [{ date: '2026-10-25T00:00:00Z' }])).toBe(cur);
    expect(advanceCursorMs(cur, [shell, shell])).toBe(cur);
  });

  test('sin cursor previo y sin fechas → null (el llamador decide el valor por defecto)', () => {
    expect(advanceCursorMs(null, [shell])).toBeNull();
    expect(advanceCursorMs(null, [{ date: '2026-10-26T10:00:00Z' }])).toBe(ms('2026-10-26T10:00:00Z'));
  });

  test('acumula a través de varias páginas aunque la última termine en shell', () => {
    // Replica el bucle del handler: DF traía 3 páginas y la última acababa en shell.
    const pages = [
      [{ date: '2026-10-26T01:00:00Z' }, { date: '2026-10-26T02:00:00Z' }],
      [{ date: '2026-10-26T03:00:00Z' }, shell],
      [{ date: '2026-10-26T04:00:00Z' }, shell, shell],
      [shell, shell],
    ];
    let cursor: number | null = null;
    for (const p of pages) cursor = advanceCursorMs(cursor, p);
    expect(cursor).toBe(ms('2026-10-26T04:00:00Z'));
  });
});

describe('página real de Gobernadora (21:35Z del 26-oct, solo fecha y tipo)', () => {
  test('23 de 70 son shells de X, el último es shell, y el cursor sale de la última con fecha', () => {
    expect(gobernadoraPage).toHaveLength(70);
    expect(gobernadoraPage.filter((m) => !m.date)).toHaveLength(23);
    expect(gobernadoraPage[gobernadoraPage.length - 1].date).toBeNull();

    // Antes: lastMention.date era null → el cursor se quedaba en startDate.
    expect(latestMentionDateMs(gobernadoraPage)).toBe(ms('2026-10-26T19:58:45.000Z'));
  });
});

describe('shouldTouchCursor', () => {
  const base = { isBackfill: false, totalMentions: 0, sendFailures: 0 };

  test('corrida normal que terminó bien sin menciones: se anota que la query se sirvió', () => {
    expect(shouldTouchCursor(base)).toBe(true);
  });

  test('con menciones el cursor se mueve por la vía normal (updateCursor), no se "toca"', () => {
    expect(shouldTouchCursor({ ...base, totalMentions: 5 })).toBe(false);
  });

  test('el backfill y el refresh no tocan nada', () => {
    expect(shouldTouchCursor({ ...base, isBackfill: true })).toBe(false);
  });

  test('con fallos de encolado no se anota como servida', () => {
    expect(shouldTouchCursor({ ...base, sendFailures: 2 })).toBe(false);
  });
});
