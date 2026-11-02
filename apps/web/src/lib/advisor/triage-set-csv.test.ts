import { csvToSet, parseCsv, CSV_COLUMNS } from './triage-set-csv';

const HEAD = CSV_COLUMNS.join(',');
const fila = (o: Partial<Record<(typeof CSV_COLUMNS)[number], string>> = {}) =>
  CSV_COLUMNS.map((c) => {
    const base: Record<string, string> = {
      id: 'N-001',
      pregunta: '¿Cuántas menciones hubo ayer?',
      tipo: 'descriptiva',
      variante: 'normal',
      indice_hoy: '0.10',
      alertas_12h: '0',
      riesgo_personas: 'no',
      veda_activa: 'no',
      guia_probable: '',
      camino_correcto: '1',
      nota: '',
    };
    const v = o[c] ?? base[c];
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  }).join(',');

describe('triage-set-csv', () => {
  it('parsea comillas, comas y saltos de línea dentro de una celda', () => {
    expect(parseCsv('a,"b, ""c""",d\n"x\ny",2,3\n')).toEqual([['a', 'b, "c"', 'd'], ['x\ny', '2', '3']]);
  });

  it('convierte una fila válida al formato JSON de los sets', () => {
    const { items, errors } = csvToSet([HEAD, fila()].join('\n'));
    expect(errors).toEqual([]);
    expect(items).toEqual([
      {
        id: 'N-001',
        tipo: 'descriptiva',
        variante: 'normal',
        pregunta: '¿Cuántas menciones hubo ayer?',
        contexto: { indiceHoy: 0.1, alertasUltimas12h: 0, riesgoPersonas: false, vedaActiva: false, guiaProbable: null },
        caminoMinimo: 1,
        reglaBase: false,
      },
    ]);
  });

  it('acepta coma decimal, índice vacío (sin dato) y guía en minúscula', () => {
    const { items, errors } = csvToSet([HEAD, fila({ indice_hoy: '0,45', camino_correcto: '2' }), fila({ id: 'N-002', indice_hoy: '', guia_probable: 'g-6', camino_correcto: '2' })].join('\n'));
    expect(errors).toEqual([]);
    expect(items[0].contexto.indiceHoy).toBe(0.45);
    expect(items[1].contexto).toMatchObject({ indiceHoy: null, guiaProbable: 'G-6' });
  });

  it('rechaza una etiqueta por debajo del piso por reglas (veda con redacción en camino 1)', () => {
    const { items, errors } = csvToSet([HEAD, fila({ tipo: 'redaccion', veda_activa: 'si', camino_correcto: '1' })].join('\n'));
    expect(items).toEqual([]);
    expect(errors[0]).toMatch(/por debajo del piso por reglas \(2\)/);
  });

  it('rechaza ids repetidos, tipos y valores no válidos, y columnas que faltan', () => {
    const dup = csvToSet([HEAD, fila(), fila()].join('\n'));
    expect(dup.errors.join(' ')).toMatch(/id repetido/);
    const mal = csvToSet([HEAD, fila({ tipo: 'consulta', camino_correcto: '4', indice_hoy: '7' })].join('\n'));
    expect(mal.errors.join(' ')).toMatch(/tipo «consulta»/);
    expect(mal.errors.join(' ')).toMatch(/camino_correcto debe ser 1, 2 o 3/);
    expect(mal.errors.join(' ')).toMatch(/indice_hoy debe estar entre 0 y 1/);
    expect(csvToSet('id,pregunta\nx,y').errors.join(' ')).toMatch(/Falta la columna «tipo»/);
  });
});
