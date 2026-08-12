/* ============================================================
   ECO — Dataset canónico para los mockups de Vista Ejecutiva.
   DATOS ILUSTRATIVOS (no reales). Agencias del Gobierno de Puerto Rico.
   Escalas:
     bhi   Índice de Salud de Marca .......... 0–100  (mayor = mejor)
     nss   Sentimiento Neto .................. -100..+100 (%pos - %neg)
     crisis Riesgo de Crisis ................. 0.00–1.00 (mayor = peor)
            bandas: <0.25 NORMAL · <0.40 ELEVADO · <0.60 ALERTA · >=0.60 CRISIS
     polar Polarización ...................... 0.00–1.00 (mayor = más dividido)
     engVel Velocidad de Interacción ......... × vs. línea base (1.0 = normal)
     vol   Menciones (7 días) ................ entero
     reach Alcance estimado .................. personas
     pos/neu/neg  reparto de sentimiento ..... % (suman ~100)
     rankDelta  cambio de posición vs. semana anterior
   ============================================================ */
(function () {
  // ---- PRNG determinista (mulberry32): sparklines estables entre recargas ----
  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // serie de n puntos terminando ~end, con tendencia dir/punto y ruido amp
  function series(seed, n, end, dir, amp) {
    const r = rng(seed); const out = []; let v = end - dir * (n - 1);
    for (let i = 0; i < n; i++) { v += dir + (r() - 0.5) * (amp || 4); out.push(v); }
    const shift = end - out[out.length - 1];
    return out.map((x) => Math.round((x + shift) * 100) / 100);
  }

  // ---- formato ----
  const fmt = {
    int: (n) => Number(Math.round(n)).toLocaleString('en-US'),
    compact: (n) => {
      n = Number(n);
      if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
      if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
      return String(Math.round(n));
    },
    signed: (n, d) => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(Number(n)).toFixed(d == null ? 0 : d),
    pct: (n) => Math.round(n) + '%',
  };

  // ---- bandas ----
  function crisisBand(s) {
    if (s >= 0.60) return { label: 'CRISIS', cls: 'pill-neg', color: 'var(--neg)', isCrisis: true };
    if (s >= 0.40) return { label: 'ALERTA', cls: 'pill-neg', color: 'var(--neg)' };
    if (s >= 0.25) return { label: 'ELEVADO', cls: 'pill-warn', color: 'var(--warn)' };
    return { label: 'NORMAL', cls: 'pill-pos', color: 'var(--pos)' };
  }
  function bhiBand(v) {
    if (v < 40) return { label: 'Crítico', cls: 'pill-neg', color: 'var(--neg)' };
    if (v < 60) return { label: 'Débil', cls: 'pill-warn', color: 'var(--warn)' };
    if (v < 80) return { label: 'Sano', cls: 'pill-pos', color: 'var(--pos)' };
    return { label: 'Fuerte', cls: 'pill-info', color: 'var(--accent)' };
  }

  // ---- sparkline: path suave (Catmull-Rom → Bézier), igual que el prototipo ----
  function spark(data, w, h, pad) {
    pad = pad == null ? 2 : pad;
    if (!data || !data.length) return { line: '', area: '', points: [], last: [0, 0] };
    const min = Math.min.apply(null, data), max = Math.max.apply(null, data);
    const span = (max - min) || 1, n = data.length;
    const X = (i) => pad + (n === 1 ? 0 : (i / (n - 1)) * (w - 2 * pad));
    const Y = (v) => pad + (1 - (v - min) / span) * (h - 2 * pad);
    const p = data.map((v, i) => [X(i), Y(v)]);
    let d = 'M ' + p[0][0].toFixed(2) + ' ' + p[0][1].toFixed(2);
    for (let i = 0; i < p.length - 1; i++) {
      const p0 = p[i - 1] || p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] || p2;
      const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += ' C ' + c1x.toFixed(2) + ' ' + c1y.toFixed(2) + ', ' + c2x.toFixed(2) + ' ' + c2y.toFixed(2) + ', ' + p2[0].toFixed(2) + ' ' + p2[1].toFixed(2);
    }
    const area = d + ' L ' + p[n - 1][0].toFixed(2) + ' ' + h + ' L ' + p[0][0].toFixed(2) + ' ' + h + ' Z';
    return { line: d, area: area, points: p, last: p[n - 1] };
  }

  // ============================================================
  //  AGENCIAS — Gobierno de Puerto Rico (datos ilustrativos)
  //  Narrativa: Energía en CRISIS; Salud, AAA, DTOP, Educación y
  //  Seguridad en ALERTA; Turismo y DDEC como estrellas.
  // ============================================================
  const A = [
    { key: 'turismo', name: 'Compañía de Turismo', short: 'Turismo', sector: 'Económico',
      lead: 'Hon. Marielisa Cabán', role: 'Directora Ejecutiva',
      bhi: 78, bhiDelta: +2, nss: +52, nssDelta: +4, crisis: 0.12, polar: 0.21, engVel: 1.6,
      vol: 9800, reach: 1900000, pos: 64, neu: 27, neg: 9, rankDelta: +1, dir: 0.42, hue: 168,
      win: 'Récord de visitantes y ocupación hotelera en temporada alta',
      concern: 'Quejas aisladas por precios de hospedaje y Airbnb' },
    { key: 'ddec', name: 'Desarrollo Económico y Comercio', short: 'DDEC', sector: 'Económico',
      lead: 'Hon. Carlos Vendrell', role: 'Secretario',
      bhi: 71, bhiDelta: +1, nss: +34, nssDelta: +2, crisis: 0.18, polar: 0.28, engVel: 1.3,
      vol: 8600, reach: 1600000, pos: 56, neu: 31, neg: 13, rankDelta: 0, dir: 0.2, hue: 192,
      win: 'Anuncios de inversión extranjera y nuevos empleos manufactureros',
      concern: 'Percepción de demoras en permisos y trámites' },
    { key: 'drna', name: 'Recursos Naturales y Ambientales', short: 'DRNA', sector: 'Infraestructura',
      lead: 'Hon. Anaís Rodríguez', role: 'Secretaria',
      bhi: 63, bhiDelta: +3, nss: +19, nssDelta: +5, crisis: 0.24, polar: 0.36, engVel: 1.1,
      vol: 4200, reach: 720000, pos: 49, neu: 34, neg: 17, rankDelta: +2, dir: 0.5, hue: 142,
      win: 'Apertura de balnearios certificados y limpieza de costas',
      concern: 'Manejo de erosión costera y permisos de construcción' },
    { key: 'vivienda', name: 'Departamento de la Vivienda', short: 'Vivienda', sector: 'Social',
      lead: 'Hon. Roberto Declet', role: 'Secretario',
      bhi: 61, bhiDelta: -1, nss: +14, nssDelta: -2, crisis: 0.27, polar: 0.41, engVel: 1.2,
      vol: 4800, reach: 810000, pos: 45, neu: 36, neg: 19, rankDelta: -1, dir: -0.3, hue: 38,
      win: 'Desembolso acelerado de fondos CDBG-DR a municipios',
      concern: 'Lentitud percibida en reconstrucción del Programa R3' },
    { key: 'dtrh', name: 'Trabajo y Recursos Humanos', short: 'DTRH', sector: 'Económico',
      lead: 'Hon. Gabriel Maldonado', role: 'Secretario',
      bhi: 60, bhiDelta: +1, nss: +13, nssDelta: +1, crisis: 0.22, polar: 0.34, engVel: 1.0,
      vol: 3700, reach: 540000, pos: 44, neu: 39, neg: 17, rankDelta: 0, dir: 0.12, hue: 210,
      win: 'Baja histórica de la tasa de desempleo',
      concern: 'Fallas reportadas en el portal de reclamaciones' },
    { key: 'familia', name: 'Departamento de la Familia', short: 'Familia', sector: 'Social',
      lead: 'Hon. Suheil Vázquez', role: 'Secretaria',
      bhi: 58, bhiDelta: 0, nss: +11, nssDelta: -1, crisis: 0.29, polar: 0.44, engVel: 1.1,
      vol: 5900, reach: 980000, pos: 43, neu: 37, neg: 20, rankDelta: 0, dir: 0.0, hue: 286,
      win: 'Ampliación de asistencia nutricional (PAN) a más familias',
      concern: 'Casos de menores y listas de espera en ASSMCA' },
    { key: 'justicia', name: 'Departamento de Justicia', short: 'Justicia', sector: 'Seguridad',
      lead: 'Hon. Iván Colón', role: 'Secretario',
      bhi: 55, bhiDelta: -1, nss: +6, nssDelta: -2, crisis: 0.33, polar: 0.52, engVel: 1.2,
      vol: 6400, reach: 1100000, pos: 39, neu: 38, neg: 23, rankDelta: -1, dir: -0.2, hue: 256,
      win: 'Radicación de casos de corrupción de alto perfil',
      concern: 'Percepción de lentitud en el sistema judicial' },
    { key: 'seguridad', name: 'Seguridad Pública (Policía)', short: 'Seguridad', sector: 'Seguridad',
      lead: 'Hon. Héctor Ramos', role: 'Secretario',
      bhi: 52, bhiDelta: -2, nss: +2, nssDelta: -3, crisis: 0.44, polar: 0.58, engVel: 1.5,
      vol: 14500, reach: 2700000, pos: 35, neu: 36, neg: 29, rankDelta: -1, dir: -0.25, hue: 224,
      win: 'Reducción interanual de asesinatos',
      concern: 'Tiroteos de alto perfil y tiempos de respuesta' },
    { key: 'educacion', name: 'Departamento de Educación', short: 'Educación', sector: 'Social',
      lead: 'Hon. Liana Soto', role: 'Secretaria',
      bhi: 47, bhiDelta: -3, nss: -9, nssDelta: -6, crisis: 0.51, polar: 0.71, engVel: 1.7,
      vol: 22100, reach: 4100000, pos: 28, neu: 33, neg: 39, rankDelta: -2, dir: -0.6, hue: 12,
      win: 'Aumento salarial a maestros aprobado',
      concern: 'Cierres de escuelas y debate sobre vales educativos' },
    { key: 'dtop', name: 'Transportación y Obras Públicas', short: 'DTOP', sector: 'Infraestructura',
      lead: 'Hon. Edwin Marrero', role: 'Secretario',
      bhi: 44, bhiDelta: -1, nss: -12, nssDelta: -3, crisis: 0.48, polar: 0.55, engVel: 1.4,
      vol: 16800, reach: 3200000, pos: 25, neu: 35, neg: 40, rankDelta: -1, dir: -0.3, hue: 28,
      win: 'Millas de carreteras repavimentadas este trimestre',
      concern: 'Congestión, fallas de la AMA y semáforos apagados' },
    { key: 'aaa', name: 'Acueductos y Alcantarillados (AAA)', short: 'AAA', sector: 'Infraestructura',
      lead: 'Ing. Ramón Quiles', role: 'Presidente Ejecutivo',
      bhi: 39, bhiDelta: -2, nss: -22, nssDelta: -4, crisis: 0.58, polar: 0.49, engVel: 1.8,
      vol: 12300, reach: 2400000, pos: 21, neu: 30, neg: 49, rankDelta: -2, dir: -0.5, hue: 200,
      win: 'Inversión en plantas de filtración e infraestructura',
      concern: 'Racionamiento e interrupciones del servicio de agua' },
    { key: 'salud', name: 'Departamento de Salud', short: 'Salud', sector: 'Social',
      lead: 'Hon. Víctor Ferrer', role: 'Secretario',
      bhi: 41, bhiDelta: -2, nss: -18, nssDelta: -5, crisis: 0.59, polar: 0.61, engVel: 1.6,
      vol: 28400, reach: 5300000, pos: 24, neu: 31, neg: 45, rankDelta: -1, dir: -0.4, hue: 4,
      win: 'Campaña de vacunación y control del dengue',
      concern: 'Esperas en hospitales y reembolsos del Plan Vital' },
    { key: 'energia', name: 'Energía — AEE / LUMA / Genera', short: 'Energía', sector: 'Infraestructura',
      lead: 'Coordinación interagencial', role: 'AEE · LUMA · Genera PR',
      bhi: 28, bhiDelta: -4, nss: -47, nssDelta: -9, crisis: 0.86, polar: 0.74, engVel: 2.4,
      vol: 41200, reach: 7800000, pos: 12, neu: 22, neg: 66, rankDelta: 0, dir: -0.7, hue: 350,
      win: 'Adición de generación temporera para el verano',
      concern: 'Apagones recurrentes, facturación y desempeño de LUMA' },
  ];

  // tendencias deterministas por agencia (sparkline de 14 semanas del BHI)
  A.forEach((a, i) => {
    a.trend = series(i * 7 + 11, 14, a.bhi, a.dir, Math.max(2.5, 7 - a.bhi / 18));
    a.nssTrend = series(i * 9 + 5, 14, a.nss, a.dir * 2.4, 5);
    a.crisisTrend = series(i * 5 + 3, 14, a.crisis, -a.dir * 0.012, 0.05).map((x) => Math.max(0, Math.min(1, x)));
    a.volTrend = series(i * 11 + 2, 14, a.vol, a.dir * -20, a.vol * 0.05);
  });

  // ============================================================
  //  COMPUESTO DE GOBIERNO (ponderado por volumen/alcance)
  // ============================================================
  const totalVol = A.reduce((s, a) => s + a.vol, 0);       // 178,700
  const totalReach = A.reduce((s, a) => s + a.reach, 0);   // ~33.15M
  const gov = {
    name: 'Gobierno de Puerto Rico',
    principal: 'Vista para La Fortaleza',
    bhi: 50, bhiDelta: -3,
    nss: -11, nssDelta: -6,
    crisis: 0.47, crisisDelta: +0.05,      // ponderado por volumen → ALERTA
    polar: 0.49, polarDelta: +0.03,
    engVel: 1.7,
    vol: totalVol, volDelta: +14,          // % vs. semana anterior
    reach: totalReach,
    agenciesTracked: A.length,
    inCrisis: A.filter((a) => a.crisis >= 0.60).length,   // 1
    inAlert: A.filter((a) => a.crisis >= 0.40 && a.crisis < 0.60).length, // 5
    positivePct: 33, neutralPct: 31, negativePct: 36,
    trend: series(99, 14, 50, -0.35, 2.4),
    nssTrend: series(71, 14, -11, -0.9, 4),
    crisisTrend: series(53, 14, 0.47, 0.006, 0.03).map((x) => Math.max(0, Math.min(1, x))),
  };

  // ---- conversación / olas temáticas que cruzan agencias (para vistas que lo usen) ----
  const themes = [
    { label: 'Apagones / servicio eléctrico', vol: 38200, nss: -52, agencies: ['energia', 'salud', 'educacion'], crisis: 0.84 },
    { label: 'Servicio y calidad del agua', vol: 14100, nss: -28, agencies: ['aaa', 'salud'], crisis: 0.61 },
    { label: 'Vales educativos y escuelas', vol: 12800, nss: -7, agencies: ['educacion', 'familia'], crisis: 0.49, polar: 0.74 },
    { label: 'Carreteras y transporte', vol: 11900, nss: -16, agencies: ['dtop', 'seguridad'], crisis: 0.46 },
    { label: 'Criminalidad y seguridad', vol: 10400, nss: -9, agencies: ['seguridad', 'justicia'], crisis: 0.43 },
    { label: 'Inversión y empleos', vol: 9100, nss: +37, agencies: ['ddec', 'dtrh', 'turismo'], crisis: 0.16 },
    { label: 'Turismo y eventos', vol: 7600, nss: +49, agencies: ['turismo', 'ddec'], crisis: 0.12 },
  ];

  // ---- feed de escalamiento (para vistas tipo radar/tiempo real) ----
  const feed = [
    { t: '07:42', sev: 'crisis', agency: 'energia', title: 'Apagón masivo en zona metro afecta a ~340k abonados', metric: 'Menciones ×3.1 en 90 min', reach: 1200000 },
    { t: '07:18', sev: 'alerta', agency: 'salud', title: 'Reportes de sala de emergencias saturada en hospital regional', metric: 'NSS −31 en el tema', reach: 410000 },
    { t: '06:55', sev: 'alerta', agency: 'aaa', title: 'Racionamiento de agua se extiende a 9 municipios del área sur', metric: 'Volumen ×1.9', reach: 380000 },
    { t: '06:30', sev: 'elevado', agency: 'educacion', title: 'Debate sobre vales educativos se viraliza tras editorial', metric: 'Polarización 0.74', reach: 520000 },
    { t: '05:48', sev: 'elevado', agency: 'dtop', title: 'Tapón mayor por semáforos apagados tras corte eléctrico', metric: 'Menciones ×1.6', reach: 240000 },
    { t: 'Ayer', sev: 'positivo', agency: 'turismo', title: 'Cobertura nacional positiva por récord de cruceros', metric: 'NSS +58', reach: 690000 },
    { t: 'Ayer', sev: 'positivo', agency: 'ddec', title: 'Anuncio de planta manufacturera con 600 empleos', metric: 'NSS +44', reach: 470000 },
  ];

  window.MOCK = {
    meta: {
      product: 'ECO · Social Listening',
      client: 'Gobierno de Puerto Rico',
      scope: 'Vista Ejecutiva — Multi-agencia',
      principal: 'La Fortaleza',
      period: 'Últimos 7 días',
      periodShort: '7 días',
      updated: 'Hoy · 6:00 AM AST',
      disclaimer: 'Datos ilustrativos · mockup de diseño · no representan métricas reales',
    },
    gov: gov,
    agencies: A,
    themes: themes,
    feed: feed,
    fmt: fmt,
    crisisBand: crisisBand,
    bhiBand: bhiBand,
    spark: spark,
    byKey: (k) => A.find((a) => a.key === k),
  };
})();
