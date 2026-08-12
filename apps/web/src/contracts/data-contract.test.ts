/**
 * Test de contrato de datos — guardia permanente de la auditoría de
 * consistencia 2026-08 (docs/auditoria-consistencia-datos-2026-08.md).
 *
 * El producto tiene UN contrato de datos:
 *   - Ventana: resolveWindow (cerrada AST terminando ayer; from/to gana).
 *   - Universo de CONTEOS: menciones pertinentes (is_duplicate = false y
 *     nlp_pertinence <> 'baja'), en TZ America/Puerto_Rico.
 *   - Tópico "principal": top-confidence con tie-break
 *     `confidence DESC NULLS LAST, topic_id ASC`.
 *
 * Tres capas de defensa:
 *   1. Comportamiento puro (resolveWindow).
 *   2. SQL del agregador compartido (buildSentimentReport) vía cliente mock.
 *   3. TRIPWIRE por archivo: conteo de predicados de universo en cada
 *      endpoint que consulta `mentions`. Si añades/quitas una query, este
 *      test FALLA a propósito: actualiza el manifest DESPUÉS de verificar
 *      que la query nueva aplica el universo canónico (o documenta por qué
 *      no debe aplicarlo, como admin/diagnostics).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveWindow, PERIOD_DAYS, buildSentimentReport } from '@eco/shared';
import type { PgClientLike } from '@eco/shared';

const REPO = path.resolve(__dirname, '../../../..');
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), 'utf8');
const count = (s: string, needle: string) => s.split(needle).length - 1;

const UI_PERIOD_TOKENS = ['1D', '5D', '7D', '30D', '3M', '6M', '1A', 'Max'];
const PERT_SQL = 'nlp_pertinence IS NULL OR';
const TIE_BREAK = 'ORDER BY confidence DESC NULLS LAST, topic_id ASC';

describe('resolveWindow — ventana canónica', () => {
  // 2026-08-10T18:00Z = 14:00 AST → "hoy AST" = 2026-08-10, ayer = 08-09.
  const now = new Date('2026-08-10T18:00:00Z');

  test('preset 7D = 7 días cerrados terminando AYER en AST', () => {
    expect(resolveWindow({ period: '7D', now })).toMatchObject({
      startYmd: '2026-08-03',
      endYmd: '2026-08-09',
      prevStartYmd: '2026-07-27',
      prevEndYmd: '2026-08-02',
      custom: false,
      days: 7,
    });
  });

  test('cruce de medianoche AST (04:00Z): la ventana salta de día', () => {
    // 03:59Z = 23:59 AST del 08-09 → ayer AST = 08-08.
    expect(resolveWindow({ period: '1D', now: new Date('2026-08-10T03:59:00Z') })!.endYmd).toBe('2026-08-08');
    // 04:00Z = 00:00 AST del 08-10 → ayer AST = 08-09.
    expect(resolveWindow({ period: '1D', now: new Date('2026-08-10T04:00:00Z') })!.endYmd).toBe('2026-08-09');
  });

  test('from/to gana sobre period y deriva la ventana previa de igual duración', () => {
    expect(resolveWindow({ period: '7D', from: '2026-07-01', to: '2026-07-10', now })).toMatchObject({
      startYmd: '2026-07-01',
      endYmd: '2026-07-10',
      prevStartYmd: '2026-06-21',
      prevEndYmd: '2026-06-30',
      custom: true,
      days: 10,
    });
  });

  test('from/to inválidos caen al preset; period desconocido → null (nunca default silencioso)', () => {
    expect(resolveWindow({ period: '7D', from: 'nope', to: '2026-07-10', now })!.custom).toBe(false);
    expect(resolveWindow({ period: '7D', from: '2026-07-11', to: '2026-07-10', now })!.custom).toBe(false);
    expect(resolveWindow({ period: 'YOLO', now })).toBeNull();
    expect(resolveWindow({ now })).toBeNull();
  });

  test('el mapa canónico cubre todos los chips del header', () => {
    for (const t of UI_PERIOD_TOKENS) {
      expect(PERIOD_DAYS[t]).toBeGreaterThan(0);
    }
  });
});

describe('buildSentimentReport — universo canónico en el SQL compartido', () => {
  function mockClient(captured: string[]): PgClientLike {
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      query: async (sqlText: string): Promise<{ rows: any[] }> => {
        captured.push(sqlText);
        return { rows: [] };
      },
    };
  }

  test('las 4 queries filtran duplicados + pertinencia + fechas AST; tópicos con tie-break canónico', async () => {
    const captured: string[] = [];
    const report = await buildSentimentReport(
      mockClient(captured), 'agency-1', '2026-08-03', '2026-08-09', '2026-07-27', '2026-08-02',
    );
    expect(captured).toHaveLength(4); // totals cur + totals prev + daily + topics
    for (const q of captured) {
      expect(q).toContain('is_duplicate = false');
      expect(q).toContain(PERT_SQL);
      expect(q).toContain("AT TIME ZONE 'America/Puerto_Rico'");
    }
    const topicsQ = captured.find((q) => q.includes('mention_topics'));
    expect(topicsQ).toBeDefined();
    expect(topicsQ).toContain(TIE_BREAK);
    // Identidades del payload.
    expect(report.totals.total).toBe(report.totals.negative + report.totals.neutral + report.totals.positive);
    expect(report.prevTotals.total).toBe(report.prevTotals.negative + report.prevTotals.neutral + report.prevTotals.positive);
    // Serie diaria pre-rellenada: un punto por día calendario de la ventana.
    expect(report.dailySeries).toHaveLength(7);
    expect(report.dailySeries[0].date).toBe('2026-08-03');
    expect(report.dailySeries[6].date).toBe('2026-08-09');
  });

  test('includeLowPertinence=true quita SOLO el filtro de pertinencia (escape hatch)', async () => {
    const captured: string[] = [];
    await buildSentimentReport(
      mockClient(captured), 'agency-1', '2026-08-03', '2026-08-09', '2026-07-27', '2026-08-02',
      { includeLowPertinence: true },
    );
    for (const q of captured) {
      expect(q).toContain('is_duplicate = false');
      expect(q).not.toContain(PERT_SQL);
    }
  });
});

describe('tripwire — predicados de universo por endpoint', () => {
  // Conteos ESPERADOS de los predicados de universo en cada archivo que
  // consulta `mentions`. Si este test falla tras tocar un endpoint:
  //   1. ¿Tu query nueva cuenta menciones? → debe llevar is_duplicate=false
  //      Y el filtro de pertinencia (o el includeLow condicional).
  //   2. Verificado eso, actualiza el manifest con los conteos nuevos.
  // Nota: los conteos incluyen menciones en comentarios (p. ej. eco-data
  // tiene 9 "is_duplicate = false": 8 queries + 1 comentario).
  const MANIFEST: Array<{ file: string; rawDup: number; rawPert: number; drzDup: number; drzPert: number }> = [
    { file: 'apps/web/src/app/api/eco-data/route.ts', rawDup: 9, rawPert: 8, drzDup: 1, drzPert: 2 },
    { file: 'apps/web/src/app/api/eco-mentions/route.ts', rawDup: 2, rawPert: 0, drzDup: 1, drzPert: 1 },
    { file: 'apps/web/src/app/api/eco-geo/route.ts', rawDup: 0, rawPert: 0, drzDup: 1, drzPert: 1 },
    { file: 'apps/web/src/app/api/eco-topic-description/route.ts', rawDup: 4, rawPert: 4, drzDup: 0, drzPert: 0 },
    { file: 'apps/web/src/app/api/ai/metric-insight/route.ts', rawDup: 1, rawPert: 1, drzDup: 0, drzPert: 0 },
    // Resumen ejecutivo por periodo (ago-2026): 4 queries de contexto para el
    // prompt — muestras, municipios, autores y crecimiento por tópico. Todas
    // sobre el universo pertinente, igual que el resto del producto.
    { file: 'apps/web/src/app/api/eco-executive-summary/route.ts', rawDup: 4, rawPert: 4, drzDup: 0, drzPert: 0 },
  ];

  test.each(MANIFEST)('$file mantiene sus predicados de universo', ({ file, rawDup, rawPert, drzDup, drzPert }) => {
    const src = read(file);
    expect({
      rawDup: count(src, 'is_duplicate = false'),
      rawPert: count(src, PERT_SQL),
      drzDup: count(src, 'isDuplicate, false'),
      drzPert: count(src, 'nlpPertinence} IS NULL'),
    }).toEqual({ rawDup, rawPert, drzDup, drzPert });
  });

  test('overview y exec-overview no tienen SQL propio sobre mentions (solo el agregador compartido)', () => {
    for (const file of ['apps/web/src/app/api/overview/route.ts', 'apps/web/src/app/api/exec-overview/route.ts']) {
      const src = read(file);
      expect(src).toContain('buildSentimentReport');
      expect(src).not.toContain('FROM mentions');
    }
  });

  // 5 queries desde ago-2026: las 4 originales (totals actual, totals previa,
  // serie diaria, tabla de tópicos) + `loadHourlySeries`, la serie HORARIA que
  // el Overview usa cuando la ventana es de un solo día (chip 1D). Comparte el
  // MISMO pertinentSql y los MISMOS bordes AST que la serie diaria, así que la
  // suma de las 24 horas cuadra con el total del termómetro.
  test('sentiment-report compartido: un pertinentSql por query (5) y tie-break canónico', () => {
    const src = read('packages/shared/src/aggregations/sentiment-report.ts');
    expect(count(src, 'pertinentSql(opts')).toBe(5);
    expect(count(src, 'is_duplicate = false')).toBe(5);
    expect(src).toContain('confidence DESC NULLS LAST, topic_id ASC');
  });
});

/**
 * El matcher del middleware es un ALLOWLIST explícito: una ruta de API que no
 * esté listada queda accesible SIN sesión. Y eso no falla de forma visible,
 * porque `resolveAgencyId` sin sesión cae a una rama "public/seed" que acepta
 * `?agency=<slug>` — así que el endpoint responde con datos de la agencia que
 * le pidan en vez de 401.
 *
 * Pasó de verdad: `/api/eco-executive-summary` se desplegó a producción fuera
 * del matcher (ago-2026). Este test enumera los directorios de rutas y exige
 * que cada uno esté cubierto, o listado como público a propósito.
 */
describe('tripwire — toda ruta /api/* está en el matcher del middleware (o es pública a propósito)', () => {
  // Rutas que DEBEN ser alcanzables sin sesión, con su razón.
  const INTENTIONALLY_PUBLIC = new Set([
    'auth',   // login / refresh / me: son el mecanismo de sesión
    'health', // healthcheck del ALB y del contenedor
  ]);

  // Rutas fuera del matcher que se gatean DENTRO del handler. Verificado contra
  // prod sin sesión: /api/admin/* → 403, /api/reports/* → 401. Se exige abajo
  // que el gate siga existiendo en el código, para que quitarlo no las deje
  // abiertas en silencio.
  //
  // `admin` NO usa sesión Cognito a propósito: lo invoca EventBridge, así que
  // gatea por el secreto compartido `x-eco-cron-secret` (fail-closed si no está
  // configurado). Por eso su lista de gates válidos es distinta.
  const SESSION_GATES = ['requireCapability', 'requireRole', 'requireAdmin', 'requireAuth'];
  const GATED_IN_ROUTE: Record<string, string[]> = {
    admin: ['x-eco-cron-secret', ...SESSION_GATES],
    reports: SESSION_GATES,
  };

  // El middleware tiene DOS listas y las dos hacen falta:
  //   - `config.matcher`  → qué requests INVOCAN el middleware.
  //   - `PROTECTED_PATHS` → cuáles EXIGEN sesión (regex, vía isProtected()).
  // Estar solo en el matcher NO protege: el middleware corre, isProtected()
  // devuelve false y la request pasa de largo. Este test comprueba AMBAS, que
  // es justo lo que la primera versión no hacía — de ahí que /api/eco-terms
  // siguiera abierto en prod después de #98.
  const groupsUnderApi = () => {
    const apiDir = path.join(REPO, 'apps/web/src/app/api');
    return fs
      .readdirSync(apiDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .filter((g) => !INTENTIONALLY_PUBLIC.has(g) && !(g in GATED_IN_ROUTE));
  };

  test('ningún endpoint nuevo queda fuera del matcher', () => {
    const mw = read('apps/web/src/middleware.ts');
    const missing = groupsUnderApi().filter((g) => !mw.includes(`'/api/${g}/:path*'`));
    expect({ missing }).toEqual({ missing: [] });
  });

  test('ningún endpoint nuevo queda fuera de PROTECTED_PATHS (el que de verdad exige sesión)', () => {
    const mw = read('apps/web/src/middleware.ts');
    // Sólo el bloque de PROTECTED_PATHS, para no dar por buena una coincidencia
    // que en realidad está en config.matcher.
    const block = mw.slice(
      mw.indexOf('const PROTECTED_PATHS'),
      mw.indexOf('function isProtected'),
    );
    expect(block.length).toBeGreaterThan(0);
    const missing = groupsUnderApi().filter(
      (g) => !block.includes(`/^\\/api\\/${g}(\\/.*)?$/`),
    );
    expect({ missing }).toEqual({ missing: [] });
  });

  test('las rutas gateadas en el handler conservan su gate', () => {
    // Recorre cada route.ts del grupo y exige al menos un gate por archivo.
    for (const [group, gates] of Object.entries(GATED_IN_ROUTE)) {
      const dir = path.join(REPO, 'apps/web/src/app/api', group);
      const files: string[] = [];
      const walk = (d: string) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const p = path.join(d, e.name);
          if (e.isDirectory()) walk(p);
          else if (e.name === 'route.ts') files.push(p);
        }
      };
      walk(dir);
      expect(files.length).toBeGreaterThan(0);
      const ungated = files
        .filter((f) => !gates.some((g) => fs.readFileSync(f, 'utf8').includes(g)))
        .map((f) => path.relative(REPO, f));
      expect({ group, ungated }).toEqual({ group, ungated: [] });
    }
  });

  test('los endpoints sin segmentos hijos también se listan en su forma desnuda', () => {
    // `/api/foo/:path*` no cubre `/api/foo` de forma fiable; los endpoints que
    // se consumen en su raíz necesitan AMBAS entradas.
    const mw = read('apps/web/src/middleware.ts');
    for (const bare of ['exec-overview', 'eco-executive-summary']) {
      expect(mw).toContain(`'/api/${bare}'`);
    }
  });
});

describe('tripwire — tokens de período del SPA vs mapa canónico', () => {
  test('ECO_PERIOD_DAYS (shell.js) es idéntico al PERIOD_DAYS de @eco/shared', () => {
    const shell = read('apps/web/public/eco-prototype/shell.js');
    const m = shell.match(/const ECO_PERIOD_DAYS = \{([\s\S]*?)\};/);
    expect(m).toBeTruthy();
    const entries: Record<string, number> = {};
    for (const [, k, v] of m![1].matchAll(/'([^']+)':\s*(\d+)/g)) entries[k] = Number(v);
    expect(entries).toEqual(PERIOD_DAYS);
  });

  test('todos los chips del header (shell.js PERIODS) existen en el mapa canónico', () => {
    const shell = read('apps/web/public/eco-prototype/shell.js');
    const m = shell.match(/const PERIODS = \[([^\]]+)\]/);
    expect(m).toBeTruthy();
    const tokens = [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    expect(tokens.length).toBeGreaterThan(0);
    for (const t of tokens) expect(PERIOD_DAYS[t]).toBeGreaterThan(0);
  });
});
