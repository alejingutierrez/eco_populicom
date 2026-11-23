/** INT-02 · veredicto de un correo enviado (`scripts/int-02-enviados-check.ts`). */
import { judgeSent, type SentRow } from '../../../../scripts/lib/int-02-enviados';

const row = (over: Partial<SentRow> = {}): SentRow => ({
  slug: 'df', templateKey: 'daily-sentiment-summary', sentAt: '2026-11-23T10:00:42Z',
  final: { headline: 'El Senado citó a la secretaria', paragraph: 'El volumen bajó 18 % respecto al miércoles.', highlights: ['Jay Fonseca publicó el contrato.'] },
  warnings: [], residual: [], safetyNetLog: [], correctorRan: true, hasDraft1: true, hasDraft2: true, errors: [], ...over,
});

describe('judgeSent', () => {
  it('un correo limpio pasa', () => {
    expect(judgeSent(row())).toMatchObject({ ok: true, vetoed: [], contradictions: [], doubleSigns: [], levelWarnings: [], unarchived: [] });
  });

  it('palabra vetada, dirección contra cifra y variación sin nivel rompen el criterio', () => {
    const v = judgeSent(row({
      final: { headline: 'El Senado arremete contra la secretaria', paragraph: 'El volumen subió -18 % respecto al miércoles.', highlights: [] },
      warnings: [{ type: 'direccion_sin_nivel', where: 'párrafo' }, { type: 'titular_largo', where: 'titular' }],
    }));
    expect(v.ok).toBe(false);
    expect(v.vetoed).toEqual(['titular: «arremete»']);
    expect(v.contradictions).toEqual(['párrafo: «-18 %»']);
    expect(v.levelWarnings).toEqual(['párrafo: direccion_sin_nivel']);
  });

  it('el signo doble se informa pero no rompe el criterio', () => {
    const v = judgeSent(row({ final: { headline: 'x', paragraph: 'El volumen bajó -18 % y cerró con 224 menciones, +62 % más que el miércoles.', highlights: [] } }));
    expect(v.doubleSigns).toEqual(['párrafo: «-18 %»', 'párrafo: «+62 %»']);
    expect(v.ok).toBe(true);
  });

  it('una corrección sin el antes o el después archivado rompe el criterio', () => {
    expect(judgeSent(row({ hasDraft2: false })).unarchived).toEqual(['corrector sin borrador antes o después']);
    // Un corrector que falló no corrigió nada: no hay después que archivar.
    expect(judgeSent(row({ hasDraft2: false, errors: ['corrector: timeout'] })).ok).toBe(true);
    expect(judgeSent(row({ safetyNetLog: [{ action: 'nivel_añadido', where: 'párrafo', text: 'antes' }] })).unarchived).toEqual(['nivel_añadido en párrafo sin texto']);
    expect(judgeSent(row({ safetyNetLog: [{ action: 'nivel_añadido', where: 'párrafo', text: 'antes', after: 'después' }, { action: 'frase_removida', where: 'párrafo', text: 'La frase.' }] })).ok).toBe(true);
    expect(judgeSent(row({ final: null })).ok).toBe(false);
  });
});
