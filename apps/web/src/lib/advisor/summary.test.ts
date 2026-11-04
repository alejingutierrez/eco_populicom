import { scrubForSummary, summaryInput, validateResumen } from './summary';

const MEMO: Record<string, unknown> = {
  encabezado: { fecha: 'lunes 2 de noviembre de 2026', agencia: 'Departamento de la Familia', motivo: 'El Senado presiona (M-98).' },
  recomendacion: { camino: 2, confianza_cualitativa: 'baja', porque: 'Revisar documentos (M-40670165-27dc-47ef-9308-68ee1612abc9) y decidir. [métrica: indice_crisis=0.34, 2026-11-01]' },
  caminos: [
    { nombre: 'Remitir', que: 'Una sola postura (L-1)', quien: 'Un vocero', canal: 'Parte escrito', cuando: 'Lunes 2' },
    { nombre: 'Separar', que: 'q', quien: 'q', canal: 'c', cuando: 'c' },
    { nombre: 'Defender o licencia', que: 'q', quien: 'q', canal: 'c', cuando: 'c' },
  ],
  hechos: { sabido: [{ afirmacion: 'El índice cerró en 0.34', citas: ['M-05'] }], no_claro: [{ pregunta: '¿Hay recibos?' }], supuesto: [] },
  senales: { cambiar_si: ['Un documento contradice a la secretaria (M-64)'] },
  linea_base: { descripcion: 'La conversación baja sola' },
  vetos: [{ texto: 'No negar sin pruebas (L-1)', estado: 'sin_resolver' }, { texto: 'otro', estado: 'resuelto' }],
  limites: ['ECO no ve WhatsApp'],
};

const OK = {
  titular: 'Revisen hoy los documentos del viaje con asesoría legal y no publiquen nada hasta tener esa revisión.',
  hacer_hoy: ['Reúnan los recibos del viaje y revísenlos con asesoría legal el lunes 2.', 'Fijen una sola postura escrita con la gobernadora.'],
  no_hacer: ['No afirmen ni nieguen cómo se pagó el viaje sin documentos.'],
  cambiar_si: ['Si un documento contradice a la secretaria, pasen a la licencia.'],
  falta_saber: ['ECO no ve los recibos ni lo que circula en WhatsApp.'],
};

describe('validateResumen', () => {
  test('acepta un resumen limpio', () => {
    expect(validateResumen(OK, MEMO)).toEqual(OK);
  });

  test('rechaza códigos internos, UUID y jerga', () => {
    for (const bad of ['Según M-98 no hay que negar.', 'Ver M-40670165-27dc-47ef-9308-68ee1612abc9.', 'El camino 2 es el mejor.', 'Hay un veto abierto.', 'Objeción C0-1 mitigada.', 'El asiento legal lo pide.']) {
      expect(validateResumen({ ...OK, no_hacer: [bad] }, MEMO)).toBeNull();
    }
  });

  test('rechaza cifras que el memorando no tiene y acepta las que sí (coma o punto decimal)', () => {
    expect(validateResumen({ ...OK, cambiar_si: ['Si el índice pasa de 0,60, suban un nivel.'] }, MEMO)).toBeNull();
    expect(validateResumen({ ...OK, cambiar_si: ['Si el índice vuelve a pasar de 0,34, suban un nivel.'] }, MEMO)).not.toBeNull();
  });

  test('rechaza formas inválidas y excesos de largo', () => {
    expect(validateResumen(null, MEMO)).toBeNull();
    expect(validateResumen({ ...OK, hacer_hoy: ['una sola'] }, MEMO)).toBeNull();
    expect(validateResumen({ ...OK, titular: '' }, MEMO)).toBeNull();
    expect(validateResumen({ ...OK, titular: Array(41).fill('palabra').join(' ') }, MEMO)).toBeNull();
    expect(validateResumen({ ...OK, falta_saber: [Array(41).fill('dato').join(' ')] }, MEMO)).toBeNull();
    expect(validateResumen({ ...OK, hacer_hoy: Array(4).fill(Array(40).fill('verbo').join(' ')), no_hacer: Array(3).fill(Array(40).fill('no').join(' ')), cambiar_si: Array(3).fill(Array(40).fill('si').join(' ')) }, MEMO)).toBeNull();
  });
});

describe('entrada del redactor', () => {
  test('quita citas, UUID y códigos antes de dárselos al modelo', () => {
    const t = scrubForSummary('Revisar (M-40670165-27dc-47ef-9308-68ee1612abc9) y L-1 [métrica: indice_crisis=0.34, 2026-11-01] ya.');
    expect(t).not.toMatch(/M-4067|L-1|métrica/);
    expect(t).toContain('Revisar');
  });

  test('rotula las opciones con letras, marca la recomendada y deja solo vetos sin resolver', () => {
    const input = JSON.parse(summaryInput(MEMO));
    expect(input.recomendada).toBe('Opción C');
    expect(input.opciones.map((o: { opcion: string }) => o.opcion)).toEqual(['A', 'B', 'C']);
    expect(input.prohibiciones_sin_resolver).toEqual(['No negar sin pruebas']);
    expect(JSON.stringify(input)).not.toMatch(/M-98|M-4067|L-1\b|métrica/);
  });
});
