/**
 * Catálogo de municipios (@eco/shared): son 78 y el detector los encuentra.
 *
 * Hasta oct-2026 el catálogo tenía 77 entradas: faltaba Canóvanas, así que
 * extractMunicipalitiesFromText nunca la detectaba, el processor descartaba el
 * slug aunque el NLP lo devolviera y el mapa no podía mostrarla.
 */
import { MUNICIPALITIES, REGIONS, extractMunicipalitiesFromText } from '@eco/shared';

/** Lo mismo que hace el processor con `mention.city` de Brandwatch. */
function slugify(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

describe('MUNICIPALITIES', () => {
  test('tiene exactamente los 78 municipios de Puerto Rico, sin repetir', () => {
    expect(MUNICIPALITIES).toHaveLength(78);
    expect(new Set(MUNICIPALITIES.map((m) => m.slug)).size).toBe(78);
    expect(new Set(MUNICIPALITIES.map((m) => m.name)).size).toBe(78);
  });

  test('la población suma el total de PR del Censo (Vintage 2025, 1 jul 2025)', () => {
    expect(MUNICIPALITIES.reduce((s, m) => s + m.population, 0)).toBe(3_184_835);
  });

  test('cada slug es el nombre slugificado, para que la ciudad de Brandwatch case', () => {
    for (const m of MUNICIPALITIES) expect(m.slug).toBe(slugify(m.name));
  });

  test('cada región es una de las seis y cada centro cae en Puerto Rico', () => {
    for (const m of MUNICIPALITIES) {
      expect(REGIONS).toContain(m.region);
      expect(m.latitude).toBeGreaterThan(17.8);
      expect(m.latitude).toBeLessThan(18.6);
      expect(m.longitude).toBeGreaterThan(-67.3);
      expect(m.longitude).toBeLessThan(-65.2);
    }
  });

  test('Canóvanas está, en Norte, con su población del Censo', () => {
    expect(MUNICIPALITIES.find((m) => m.slug === 'canovanas')).toMatchObject({
      name: 'Canóvanas', region: 'Norte', population: 41302,
    });
  });
});

describe('extractMunicipalitiesFromText', () => {
  test('detecta Canóvanas con y sin acento', () => {
    expect(extractMunicipalitiesFromText('Inundaciones en Canóvanas tras la vaguada')).toContain('canovanas');
    expect(extractMunicipalitiesFromText('Inundaciones en Canovanas tras la vaguada')).toContain('canovanas');
    expect(extractMunicipalitiesFromText('CANÓVANAS: cierran la PR-3')).toContain('canovanas');
  });

  test('en una lista de vecinos encuentra a los tres', () => {
    const found = extractMunicipalitiesFromText(
      'Gobierno ampliará la declaración de emergencia por agua a Loíza, Canóvanas y Río Grande',
    );
    expect(found.sort()).toEqual(['canovanas', 'loiza', 'rio-grande']);
  });

  test('no la confunde con el río Canovanillas', () => {
    expect(extractMunicipalitiesFromText('Crecida del río Canovanillas')).not.toContain('canovanas');
  });
});
