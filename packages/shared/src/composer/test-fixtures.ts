/**
 * Datos sintéticos para las pruebas del motor (sin usuarios reales). Forma de
 * una ventana del correo diario: DDEC, 26-oct a 1-nov 2026, con un hilo de
 * comentarios tardíos a una publicación del lunes 26.
 */
import { annotateSamples, type RawComposerSample, type SampleContext } from './samples';
import type { ComposerInput } from './types';

export const FIXTURE_SERIES = [
  { date: '2026-10-26', negative: 3, neutral: 60, positive: 37 },
  { date: '2026-10-27', negative: 12, neutral: 104, positive: 39 },
  { date: '2026-10-28', negative: 15, neutral: 130, positive: 22 },
  { date: '2026-10-29', negative: 10, neutral: 80, positive: 15 },
  { date: '2026-10-30', negative: 10, neutral: 60, positive: 10 },
  { date: '2026-10-31', negative: 4, neutral: 14, positive: 10 },
  { date: '2026-11-01', negative: 4, neutral: 54, positive: 6 },
];

const POST_TEXT = 'En el Mes de la Manufactura, destacamos a una panadería de Caguas que hornea pan sobao todos los días.';

function comment(i: number, createdAt: string): RawComposerSample {
  return {
    id: `c${i}`,
    createdAt,
    text: `${POST_TEXT} — ¿Dónde queda? ${i}`,
    title: POST_TEXT,
    snippet: `¿Dónde queda la panadería? (usuario ${String.fromCharCode(64 + i)})`,
    sentiment: 'neutral',
    topic: 'Desarrollo Empresarial',
    author: `Usuario ${String.fromCharCode(64 + i)}`,
    source: 'Facebook',
    url: `https://www.facebook.com/100/posts/200?comment_id=${i}#channels_comment`,
    pageType: 'facebook',
  };
}

export const FIXTURE_RAW = {
  today: [
    comment(1, '2026-11-01T14:00:00.000Z'),
    comment(2, '2026-11-01T15:00:00.000Z'),
    comment(3, '2026-11-01T16:00:00.000Z'),
    comment(4, '2026-11-01T17:00:00.000Z'),
    comment(5, '2026-11-01T18:00:00.000Z'),
    {
      id: 'n1', createdAt: '2026-11-01T13:00:00.000Z',
      text: 'En Contacto 787 Tv informó sobre la Ley 60 y los incentivos del DDEC.',
      sentiment: 'neutral', topic: 'Incentivos Económicos', author: 'En Contacto 787 Tv', source: 'Facebook Public',
      url: 'https://www.facebook.com/x/posts/1', pageType: 'facebook_public',
    },
  ] as RawComposerSample[],
  negative: [
    {
      id: 'a1', createdAt: '2026-10-28T13:51:11.000Z',
      text: 'Un abogado advirtió que la reforma de permisos del DDEC tiene lagunas.',
      sentiment: 'negative', topic: 'Críticas / Controversias', author: 'Radio Isla', source: 'Radio Isla',
      url: 'https://radioisla.tv/nota', pageType: 'news',
    },
  ] as RawComposerSample[],
  neutral: [] as RawComposerSample[],
  positive: [] as RawComposerSample[],
};

/** El padre de los comentarios: publicación de la agencia del lunes 26 a las 10:00 PR. */
export const FIXTURE_CONTEXT: Record<string, SampleContext> = Object.fromEntries(
  ['c1', 'c2', 'c3', 'c4', 'c5'].map((id) => [id, {
    parentMentionId: 'p-26',
    parentPublishedAt: '2026-10-26T14:00:00.000Z',
    parentAuthor: 'Departamento de Desarrollo Económico y Comercio',
    parentText: POST_TEXT,
  }]),
);

export function fixtureInput(): ComposerInput {
  return {
    agency: { id: 'ag', name: 'Departamento de Desarrollo Económico y Comercio', shortName: 'DDEC' },
    window: { startYmd: '2026-10-26', endYmd: '2026-11-01', prevStartYmd: '2026-10-19', prevEndYmd: '2026-10-25', timeZone: 'America/Puerto_Rico' },
    totals: { negative: 58, neutral: 502, positive: 139, total: 699 },
    prevTotals: { negative: 14, neutral: 142, positive: 12, total: 168 },
    dailySeries: FIXTURE_SERIES,
    topics: [{ topic: 'Gestión del Secretario', total: 269, negative: 22 }],
    sources: [{ source: 'Facebook', mentions: 526 }],
    composition: { week: { total: 647, comments: 535 }, prevWeek: { total: 160, comments: 29 } },
    samples: annotateSamples(FIXTURE_RAW, FIXTURE_CONTEXT),
  };
}
