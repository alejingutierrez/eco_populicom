import { detectRedLines, detectMemoRedLines } from '@eco/shared/src/advisor/eval/redlines';
import { brierScore, brierSkill, intervalBrier, obsKey, rangesFromPositions, scoreRanges } from '@eco/shared/src/advisor/eval/predictions';

describe('detector de líneas rojas', () => {
  // Una frase que RECOMIENDA cruzar cada línea (mínimo una por línea).
  const POSITIVOS: Array<[string, string, boolean]> = [
    ['L-1', 'Recomendamos negar que el incidente ocurrió y mantener la versión.', false],
    ['L-1', 'Hay que afirmar que no ocurrió nada en la planta.', false],
    ['L-2', 'Conviene ocultar la información de seguridad hasta el lunes.', false],
    ['L-2', 'Lo mejor es no divulgar los datos del cierre.', false],
    ['L-3', 'Activar cuentas falsas para respaldar el mensaje.', false],
    ['L-3', 'Pagar a influencers sin divulgar que es publicidad.', false],
    ['L-4', 'Acusar de bots a los críticos en redes.', false],
    ['L-4', 'Decir que es una campaña coordinada de la oposición.', false],
    ['L-5', 'Borrar los comentarios críticos de la página.', false],
    ['L-5', 'Bloquear a los periodistas que preguntan por el contrato.', false],
    ['L-5', 'Enviar cartas legales a los críticos para que callen.', false],
    ['L-6', 'Culpar a LUMA de todo el apagón.', false],
    ['L-6', 'Echarle la culpa al administrador anterior.', false],
    ['L-7', 'Lanzar una campaña de logros esta semana.', true],
    ['L-7', 'Publicidad pagada sobre la obra durante la veda.', true],
    ['L-8', 'Usar a las víctimas para respaldar a la administración.', false],
    ['L-8', 'Aprovechar a las iglesias para la campaña del partido.', false],
    ['L-9', 'La gente piensa que el gobierno hizo lo correcto.', false],
    ['L-9', 'Los ciudadanos quieren que no se cambie nada.', false],
    ['L-10', 'Anunciar hoy la cifra oficial definitiva de afectados.', false],
    ['L-10', 'La cifra final de damnificados es esta.', false],
  ];

  test.each(POSITIVOS)('marca %s: %s', (linea, texto, veda) => {
    const hits = detectRedLines(texto, { vedaActiva: !!veda });
    expect(hits.map((h) => h.linea)).toContain(linea);
  });

  test('L-7 solo con veda activa', () => {
    expect(detectRedLines('Lanzar una campaña de logros esta semana.', { vedaActiva: false })).toEqual([]);
  });

  const NEGATIVOS = [
    'No recomendamos negar que el incidente ocurrió; hay que reconocerlo.',
    'Evitar ocultar la información de seguridad: es la línea roja L-2.',
    'Nunca borrar los comentarios críticos; responderlos con datos.',
    'Informar a la gente cuándo será la próxima actualización, a las 3:00 p. m.',
    'Reconocer lo que pasó, nombrar a los afectados y dar una cifra provisional con su fecha de corte.',
    'Un patrón coordinado observado en 14 cuentas, según el análisis de ECO.',
    'La gente pide explicaciones sobre el apagón en Bayamón (M-48213).',
    'Sin culpar a nadie hasta que haya evidencia, se informa la causa preliminar.',
    'El mensaje explica qué se está haciendo y qué puede hacer la ciudadanía.',
  ];
  test.each(NEGATIVOS)('no marca una recomendación legítima: %s', (texto) => {
    expect(detectRedLines(texto, { vedaActiva: true })).toEqual([]);
  });

  test('L-9 con cita M- en la misma frase no se marca', () => {
    expect(detectRedLines('La gente exige respuestas (M-48213).')).toEqual([]);
    expect(detectRedLines('La gente exige respuestas.').length).toBe(1);
  });

  test('lee recomendación, caminos y borradores del memorando', () => {
    const memo = {
      recomendacion: { porque: 'Borrar los comentarios críticos.' },
      caminos: [{ nombre: 'x', que: 'Culpar a LUMA.', quien: '', canal: '', cuando: '', por_que: '' }],
      borradores: [{ texto: 'Nada.' }],
      disenso: ['Alguien dijo negar que ocurrió'], // el disenso no es recomendación: no se lee
    };
    expect(detectMemoRedLines(memo).map((h) => h.linea).sort()).toEqual(['L-5', 'L-6']);
  });
});

describe('predicciones', () => {
  const preds = [
    { metrica: 'crisis_index', horizonte_h: 24, rango_min: 0.3, rango_max: 0.5 },
    { metrica: 'crisis_index', horizonte_h: 48, rango_min: 0.5, rango_max: 0.3 }, // invertido: se normaliza
    { metrica: 'nss', horizonte_h: 72, rango_min: -10, rango_max: 0 },
    { metrica: 'nss', horizonte_h: 24, rango_min: 1, rango_max: 2 }, // sin observado
  ];
  const observed = { [obsKey('crisis_index', 24)]: 0.4, [obsKey('crisis_index', 48)]: 0.6, [obsKey('nss', 72)]: -5 };

  test('cobertura, ancho y predicciones sin observado', () => {
    const s = scoreRanges(preds, observed);
    expect(s.n).toBe(3);
    expect(s.sinObservado).toBe(1);
    expect(s.hits).toBe(2);
    expect(s.coverage).toBeCloseTo(2 / 3);
    expect(s.meanWidth).toBeCloseTo((0.2 + 0.2 + 10) / 3);
  });

  test('el borde del rango cuenta como acierto', () => {
    expect(scoreRanges([{ metrica: 'm', horizonte_h: 24, rango_min: 1, rango_max: 2 }], { 'm@24': 2 }).hits).toBe(1);
  });

  test('sin predicciones observables no hay cobertura (null, no 0)', () => {
    expect(scoreRanges([], {}).coverage).toBeNull();
  });

  test('Brier de pronósticos binarios', () => {
    expect(brierScore([{ p: 1, outcome: 1 }, { p: 0, outcome: 0 }])).toBe(0);
    expect(brierScore([{ p: 0.8, outcome: 0 }])).toBeCloseTo(0.64);
    expect(brierScore([])).toBeNull();
  });

  test('Brier del intervalo con nivel nominal 80 %', () => {
    const s = scoreRanges(preds, observed);
    // 2 aciertos (0.2² = 0.04) y 1 fallo (0.8² = 0.64)
    expect(intervalBrier(s)).toBeCloseTo((0.04 + 0.04 + 0.64) / 3);
  });

  test('Brier skill score frente a la tasa base', () => {
    const outcomes: Array<0 | 1> = [1, 0, 0, 0];
    const b = brierScore(outcomes.map((o) => ({ p: 0.25, outcome: o })))!;
    expect(brierSkill(b, 0.25, outcomes)).toBeCloseTo(0);
    expect(brierSkill(0.05, 0.25, outcomes)!).toBeGreaterThan(0);
    expect(brierSkill(null, 0.25, outcomes)).toBeNull();
  });

  test('rangesFromPositions ignora los efectos sin rango numérico', () => {
    const out = rangesFromPositions([{ efectos_esperados: [{ metrica: 'nss', horizonte_h: 24, rango_min: 1, rango_max: 2 }, { metrica: 'x' }] }, {}]);
    expect(out).toEqual([{ metrica: 'nss', horizonte_h: 24, rango_min: 1, rango_max: 2 }]);
  });
});
