/**
 * Importación de exportes de Bunker (@eco/shared/bunker-import) y la agencia
 * DF que la estrena (oct-2026).
 *
 * Los casos salen de filas reales del primer exporte del Departamento de la
 * Familia: si Bunker cambia el formato (zona horaria, imgproxy, columnas de
 * interacciones), estas pruebas lo dicen antes de que el processor clasifique
 * menciones con fechas corridas o sin imagen.
 */
import {
  bunkerRowToMention, bunkerResourceId, bunkerDateToIso, bunkerOriginalImageUrl,
  normalizeMentionUrl, isImportQueryId, isArchivedAgency,
  TOPICS_BY_AGENCY, TOPIC_SLUGS_BY_AGENCY, AGENCY_NLP_CONTEXT, TOPIC_ROUTING_RULES,
} from '@eco/shared';

const FB_ROW = {
  DATE: '2026-10-16', TIME: '18:30:39',
  TITLE: 'El senador Juan Óscar Morales cuestiona por qué la secretaria Suzanne Roig Fuertes…',
  FROM: 'Metro Puerto Rico', AUTHOR: 'Metro Puerto Rico',
  URL: 'https://www.facebook.com/604543901709790/posts/1570848175079353',
  URL_PHOTO: 'https://app.listening.bunkerdb.com/images/R8poB8iO/rs:fit:50:50/plain/https%3A%2F%2Fgraph.facebook.com%2F277129259071018%2Fpicture',
  SOURCE_TYPE: 'facebook', KEYWORD_NAME: 'Dpto de la Familia', LANGUAGES: 'es', LOCATIONS: 'PR',
  SENTIMENT: 'neutral', MENTION_SNIPPET: '', REACH: '84812.0', INTERACTIONS: '1.0',
  FOLLOWERS_COUNT: '1694455.0', LIKE_COUNT: '0.0', COMMENT_COUNT: '1.0', SHARE_COUNT: '0.0',
  INFLUENCE_SCORE: '9.0',
};

const WEB_ROW = {
  DATE: '2026-10-16', TIME: '17:50:21',
  TITLE: 'Familia pide 15 días más al Senado para entregar expediente de propuestas para contrato con ADSEF',
  FROM: 'metro.pr', AUTHOR: 'Juan Marrero Delgado',
  URL: 'https://www.metro.pr/noticias/2026/10/16/familia-pide-15-dias-mas-al-senado-para-entregar-expediente-de-propuestas-para-contrato-con-adsef',
  URL_PHOTO: 'https://app.listening.bunkerdb.com/images/5_eR/rs:fit:50:50/plain/https%3A%2F%2Fwww.metro.pr%2Fapi%2Fimage%2FJANC42YY6RCANDYVD2BPJ7ETCE.jpg%3Fw%3D1200%26h%3D630',
  SOURCE_TYPE: 'web', LANGUAGES: 'es', LOCATIONS: 'PR', SENTIMENT: 'neutral',
  MENTION_SNIPPET: 'ADSEF El senador Juan Óscar Morales cuestiona por qué la secretaria Suzanne Roig…',
  REACH: '297.0', LIKE_COUNT: '0.0', COMMENT_COUNT: '0.0', SHARE_COUNT: '0.0', INFLUENCE_SCORE: '4.0',
};

const X_ROW = {
  DATE: '2026-10-16', TIME: '18:00:20',
  TITLE: 'salió en defensa de la secretaria del Departamento de la Familia, Suzanne Roig',
  FROM: 'Prensa Abierta', AUTHOR: 'Prensa Abierta',
  URL: 'https://twitter.com/prensaabiertapr/status/2111200592131428815',
  URL_PHOTO: 'https://app.listening.bunkerdb.com/images/p5/rs:fit:50:50/plain/https%3A%2F%2Fpbs.twimg.com%2Fprofile_images%2F2045244229941932032%2F_zV0oqjB_normal.jpg',
  SOURCE_TYPE: 'twitter', LANGUAGES: 'es', LOCATIONS: 'PR, US', SENTIMENT: 'negative',
  LIKE_COUNT: '0.0', FAVORITE_COUNT: '4.0', RETWEET_COUNT: '2.0', COMMENT_COUNT: '1.0', INFLUENCE_SCORE: '1.0',
};

describe('bunkerDateToIso', () => {
  test('DATE+TIME de Bunker están en UTC−3 (Metro: 20:50:21Z ↔ 17:50:21 en el exporte)', () => {
    expect(bunkerDateToIso('2026-10-16', '17:50:21')).toBe('2026-10-16T20:50:21.000Z');
  });
  test('cruza el día en UTC sin perderlo', () => {
    expect(bunkerDateToIso('2026-10-15', '23:31:44')).toBe('2026-10-16T02:31:44.000Z');
  });
  test('fecha inválida → null (el processor la rechazaría)', () => {
    expect(bunkerDateToIso('', '10:00:00')).toBeNull();
    expect(bunkerDateToIso('16/10/2026', '10:00:00')).toBeNull();
  });
});

describe('bunkerOriginalImageUrl', () => {
  test('saca la URL original del imgproxy de Bunker', () => {
    expect(bunkerOriginalImageUrl(FB_ROW.URL_PHOTO)).toBe('https://graph.facebook.com/277129259071018/picture');
    expect(bunkerOriginalImageUrl(WEB_ROW.URL_PHOTO)).toBe('https://www.metro.pr/api/image/JANC42YY6RCANDYVD2BPJ7ETCE.jpg?w=1200&h=630');
  });
  test('sin /plain/ o vacía → null', () => {
    expect(bunkerOriginalImageUrl('')).toBeNull();
    expect(bunkerOriginalImageUrl('https://app.listening.bunkerdb.com/images/abc')).toBeNull();
  });
});

describe('bunkerResourceId', () => {
  test('estable ante fragmento, utm y barra final; distinto entre publicaciones', () => {
    const a = bunkerResourceId('https://www.facebook.com/1/posts/2');
    expect(bunkerResourceId('https://www.facebook.com/1/posts/2/#channels')).toBe(a);
    expect(bunkerResourceId('https://www.facebook.com/1/posts/2?utm_source=x&fbclid=y')).toBe(a);
    expect(bunkerResourceId('https://www.facebook.com/1/posts/3')).not.toBe(a);
    expect(a).toMatch(/^bunker-[0-9a-f]{28}$/);
  });
  test('normalizeMentionUrl conserva los parámetros que sí identifican (?v= de YouTube)', () => {
    expect(normalizeMentionUrl('https://www.youtube.com/watch?v=8zzHF4coJlI&si=abc')).toBe('https://www.youtube.com/watch?v=8zzHF4coJlI');
  });
});

describe('bunkerRowToMention', () => {
  test('Facebook → facebook_public con el avatar de la página y la voz en author', () => {
    const m = bunkerRowToMention(FB_ROW, { queryId: -1001 })!;
    expect(m.pageType).toBe('facebook_public');
    expect(m.pubType).toBe('FACEBOOK_PUBLIC');
    expect(m.domain).toBe('facebook.com');
    expect(m.author).toBe('Metro Puerto Rico');
    expect(m.avatarUrl).toBe('https://graph.facebook.com/277129259071018/picture');
    expect(m.mediaUrls).toEqual([]);
    expect(m.snippet).toBe(FB_ROW.TITLE);
    expect([m.likes, m.comments, m.shares, m.engagementScore]).toEqual([0, 1, 0, 1]);
    expect(m.reachEstimate).toBe(84812);
    expect(m.potentialAudience).toBe(1694455);
    expect(m.impact).toBe(90);
    expect(m.queryId).toBe(-1001);
    expect(m.queryName).toBe('Bunker · Dpto de la Familia');
    expect([m.country, m.countryCode]).toEqual(['Puerto Rico', 'PRI']);
  });

  test('web → news con dominio, byline e imagen del artículo como media', () => {
    const m = bunkerRowToMention(WEB_ROW, { queryId: -1001 })!;
    expect(m.pageType).toBe('news');
    expect(m.contentSourceName).toBe('Online News');
    expect(m.domain).toBe('metro.pr');
    expect(m.author).toBe('Juan Marrero Delgado');
    expect(m.title).toBe(WEB_ROW.TITLE);
    expect(m.snippet).toBe(WEB_ROW.MENTION_SNIPPET);
    expect(m.mediaUrls).toEqual(['https://www.metro.pr/api/image/JANC42YY6RCANDYVD2BPJ7ETCE.jpg?w=1200&h=630']);
    expect(m.avatarUrl).toBeNull();
    expect(m.date).toBe('2026-10-16T20:50:21.000Z');
  });

  test('X → handle en author, likes de FAVORITE_COUNT y reposts de RETWEET_COUNT', () => {
    const m = bunkerRowToMention(X_ROW, { queryId: -1001 })!;
    expect(m.pageType).toBe('twitter');
    expect(m.domain).toBe('x.com');
    expect(m.author).toBe('prensaabiertapr');
    expect(m.fullname).toBe('prensaabiertapr (Prensa Abierta)');
    expect([m.likes, m.shares, m.comments]).toEqual([4, 2, 1]);
    expect(m.sentiment).toBe('negative');
  });

  test('Instagram descarta el logo genérico que Bunker pone como foto', () => {
    const m = bunkerRowToMention({
      ...FB_ROW, SOURCE_TYPE: 'instagram', URL: 'https://www.instagram.com/p/DekEt3OjpNi/', FROM: 'jayfonsecapr',
      URL_PHOTO: 'https://app.listening.bunkerdb.com/images/Hk/rs:fit:50:50/plain/https%3A%2F%2Fupload.wikimedia.org%2Fwikipedia%2Fcommons%2Fthumb%2Fe%2Fe7%2FInstagram_logo_2016.svg%2F1200px-Instagram_logo_2016.svg.png',
    }, { queryId: -1001 })!;
    expect(m.pageType).toBe('instagram_public');
    expect(m.mediaUrls).toEqual([]);
    expect(m.avatarUrl).toBeNull();
  });

  test('sin URL o sin fecha no hay mención', () => {
    expect(bunkerRowToMention({ ...FB_ROW, URL: '' }, { queryId: -1001 })).toBeNull();
    expect(bunkerRowToMention({ ...FB_ROW, DATE: '' }, { queryId: -1001 })).toBeNull();
  });
});

describe('agencias importadas', () => {
  test('los queryId negativos son de importación; los de Brandwatch no', () => {
    expect(isImportQueryId(-1001)).toBe(true);
    expect(isImportQueryId(2003921640)).toBe(false);
  });

  test('archivada = sin proyecto NI query; DF (query negativo) no lo está', () => {
    expect(isArchivedAgency({ brandwatchProjectId: null, brandwatchQueryIds: [] })).toBe(true); // SGPR
    expect(isArchivedAgency({ brandwatchProjectId: null, brandwatchQueryIds: null })).toBe(true);
    expect(isArchivedAgency({ brandwatchProjectId: null, brandwatchQueryIds: [-1001] })).toBe(false); // DF
    expect(isArchivedAgency({ brandwatchProjectId: 1998405210, brandwatchQueryIds: [2003921640] })).toBe(false);
  });
});

describe('taxonomía DF', () => {
  const topics = TOPICS_BY_AGENCY.df;

  test('9 tópicos con slugs únicos y subtópicos únicos dentro de cada uno', () => {
    expect(topics).toHaveLength(9);
    expect(new Set(TOPIC_SLUGS_BY_AGENCY.df).size).toBe(9);
    for (const t of topics) {
      expect(t.subtopics.length).toBeGreaterThan(0);
      expect(new Set(t.subtopics.map((s) => s.slug)).size).toBe(t.subtopics.length);
    }
  });

  test('slugs en kebab-case y nombres dentro de varchar(100)', () => {
    for (const t of topics) {
      expect(t.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(t.name.length).toBeLessThanOrEqual(100);
      for (const s of t.subtopics) {
        expect(s.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
        expect(s.name.length).toBeLessThanOrEqual(100);
      }
    }
  });

  test('las reglas de routing de DF solo nombran tópicos y subtópicos que existen', () => {
    const rules = TOPIC_ROUTING_RULES.df;
    const known = new Set(topics.flatMap((t) => [t.slug, ...t.subtopics.map((s) => `${t.slug}.${s.slug}`)]));
    const refs = rules.match(/→ ([a-z0-9-]+(?:\.[a-z0-9-]+)?)/g) ?? [];
    expect(refs.length).toBeGreaterThan(5);
    for (const r of refs) expect(known).toContain(r.slice(2));
  });

  test('el contexto de pertinencia nombra las administraciones adscritas', () => {
    for (const k of ['ADSEF', 'ADFAN', 'ACUDEN', 'ASUME']) expect(AGENCY_NLP_CONTEXT.df).toContain(k);
  });

  test('las agencias que ya existían no reciben contexto ni reglas nuevas (su prompt no cambia)', () => {
    for (const slug of ['aaa', 'ddecpr', 'gobernadora', 'sgpr']) {
      expect(AGENCY_NLP_CONTEXT[slug]).toBeUndefined();
      expect(TOPIC_ROUTING_RULES[slug]).toBeUndefined();
    }
  });
});
