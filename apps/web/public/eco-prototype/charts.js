// SVG chart primitives — no external libs, tuned to theme via CSS vars

/**
 * Convierte un array de puntos [x,y] a un path SVG smooth usando Catmull-Rom
 * splines. A diferencia del bezier con tangentes horizontales (donde el
 * control point se centra en cx=(x0+x1)/2 con y=y_endpoint), Catmull-Rom usa
 * tangentes basadas en el slope de los puntos VECINOS. Resultado:
 *  - La curva pasa EXACTAMENTE por cada data point (sin overshoot).
 *  - Los peaks son puntiagudos en su día real, NO extendidos lateralmente
 *    (la "meseta" del bezier horizontal-tangent confundía al usuario sobre
 *    qué label X correspondía a un peak visible).
 *  - Tensión 0.5 = standard Catmull-Rom; 1.0 = más recto; 0 = más curvo.
 *
 * Conversión Catmull-Rom → cubic bezier:
 *  Para el segmento P1→P2, los control points son:
 *    cp1 = P1 + (P2 - P0) * tension / 6
 *    cp2 = P2 - (P3 - P1) * tension / 6
 *  Donde P0 y P3 son los puntos previo y siguiente (o reflexión en bordes).
 */
// Contrato de accesibilidad de las gráficas (WS-A1).
//
// Ninguno de los 9 SVG del producto tenía `<title>`, `role` ni foco por
// teclado: para un lector de pantalla ninguna gráfica de ECO existía, y para
// quien no usa ratón el tooltip —la única superficie con las cifras exactas—
// era inalcanzable.
//
// `chartA11y()` devuelve los props del <svg> (role img + aria-labelledby) y los
// nodos <title>/<desc>. `ChartTable` emite la tabla equivalente, visualmente
// oculta con .sr-only, que es la que de verdad permite leer los datos: un
// `<title>` resume, una tabla se navega.
let _chartUid = 0;
function useChartIds() {
  const ref = React.useRef(null);
  if (ref.current == null) { _chartUid += 1; ref.current = `eco-c${_chartUid}`; }
  return { titleId: `${ref.current}-t`, descId: `${ref.current}-d`, tableId: `${ref.current}-tb` };
}

function ChartTitle({ ids, title, desc }) {
  return (
    <>
      <title id={ids.titleId}>{title}</title>
      {desc ? <desc id={ids.descId}>{desc}</desc> : null}
    </>
  );
}

// Tabla equivalente. `columns` = [{key, label, format?}], `rows` = objetos.
function ChartTable({ ids, caption, columns, rows }) {
  if (!rows || rows.length === 0) return null;
  // El .sr-only va en un <div> envolvente, NO en la <table>: `width:1px` sobre
  // un elemento `display:table` es un MÍNIMO, no un máximo — la tabla crece
  // hasta su ancho intrínseco (medido: 1,153px) y desbordaba la página 838px.
  // Y no se puede arreglar con `display:block` en la tabla porque eso le quita
  // la semántica de tabla a los lectores de pantalla, que es justo lo que
  // queremos conservar.
  return (
    <div className="sr-only">
    <table id={ids.tableId}>
      <caption>{caption}</caption>
      <thead>
        <tr>{columns.map((c) => <th key={c.key} scope="col">{c.label}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {columns.map((c, ci) => {
              const v = c.format ? c.format(r[c.key], r) : r[c.key];
              const txt = (v == null || v === '') ? 'sin dato' : String(v);
              return ci === 0
                ? <th key={c.key} scope="row">{txt}</th>
                : <td key={c.key}>{txt}</td>;
            })}
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}

// Contrato de nulos de las gráficas (WS-P0.7).
//
// `/api/eco-data` emite valores nulos legítimos —p.ej. TIMELINE[].polarizationIndex
// cuando el snapshot de ese día no la trae— y antes eso (a) tumbaba la pantalla
// completa porque fmtVal hacía v.toFixed() sin guarda, y (b) cuando no tumbaba,
// el `?? 0` de los sitios de llamada dibujaba el hueco como si fuera un CERO
// MEDIDO: el sparkline de Polarización mostraba dos caídas al suelo que se leen
// como "la polarización se desplomó" cuando el dato simplemente no existe.
//
// Regla: un hueco NO es un cero. `isGap()` lo detecta, la escala lo ignora al
// calcular min/max, y las líneas se parten en ese punto en vez de bajar a cero.
function isGap(v) {
  return v == null || (typeof v === 'number' && !Number.isFinite(v));
}

// Parte una lista de puntos en tramos contiguos sin huecos, para que la línea
// se interrumpa donde falta el dato en vez de interpolarlo.
function splitSegments(pts) {
  const out = [];
  let cur = [];
  for (const p of pts) {
    if (p == null) { if (cur.length) { out.push(cur); cur = []; } }
    else cur.push(p);
  }
  if (cur.length) out.push(cur);
  return out;
}

function catmullRomPath(pts, tension = 1) {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M ${pts[0][0]},${pts[0][1]}`;
  let p = `M ${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || pts[i + 1];
    const cp1x = p1[0] + (p2[0] - p0[0]) * tension / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) * tension / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) * tension / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) * tension / 6;
    p += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2[0]},${p2[1]}`;
  }
  return p;
}

function linePath(data, w, h, accessor = (d) => d, padding = 4, minY = null, maxY = null) {
  if (!data.length) return '';
  const vals = data.map(accessor);
  const min = minY !== null ? minY : Math.min(...vals);
  const max = maxY !== null ? maxY : Math.max(...vals);
  const range = max - min || 1;
  const step = (w - padding * 2) / Math.max(1, data.length - 1);
  return data.map((d, i) => {
    const x = padding + i * step;
    const y = h - padding - ((accessor(d) - min) / range) * (h - padding * 2);
    return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(' ');
}

function smoothLinePath(data, w, h, accessor = (d) => d, padding = 6, minY = null, maxY = null) {
  if (!data.length) return '';
  const vals = data.map(accessor);
  // Huecos fuera del dominio: con `Math.min(...vals)` y un null dentro, min/max
  // salían NaN y el path entero se emitía como "M 2,NaN …" — el navegador lo
  // descartaba y el sparkline aparecía vacío, con 4 errores de consola por
  // render en el Scorecard.
  const finite = vals.filter((v) => v != null && Number.isFinite(v));
  if (finite.length === 0) return '';
  const min = minY !== null ? minY : Math.min(...finite);
  const max = maxY !== null ? maxY : Math.max(...finite);
  const range = max - min || 1;
  const step = (w - padding * 2) / Math.max(1, data.length - 1);
  // Los puntos sin dato se omiten; el tramo se une entre los que sí lo tienen.
  // (En un sparkline de 80px partir la línea sería ruido; lo importante es no
  // dibujar un cero que nadie midió.)
  const pts = data.map((d, i) => {
    const v = accessor(d);
    if (v == null || !Number.isFinite(v)) return null;
    return [padding + i * step, h - padding - ((v - min) / range) * (h - padding * 2)];
  }).filter(Boolean);
  if (pts.length === 0) return '';
  let p = `M ${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const cx = (x0 + x1) / 2;
    p += ` C ${cx},${y0} ${cx},${y1} ${x1},${y1}`;
  }
  return { path: p, points: pts };
}

// Robust container-width hook for responsive SVG charts. Measures via
// getBoundingClientRect in a layout effect (works even when ResizeObserver
// callbacks are throttled) and re-measures on window resize + RO. Charts keep
// using pixel coordinates equal to the rendered width, so click math and tick
// spacing stay exact — no viewBox distortion.
// Tope de eje REDONDEADO al múltiplo legible más cercano por arriba.
//
// Con el máximo crudo del dato el eje decía "346", y un cliente de gobierno lee
// un número así como si fuera un umbral, no como el techo accidental de la serie
// de esta semana. Redondear a 1 / 2 / 2.5 / 5 / 10 × 10^n da un tope que además
// se divide limpio en cuartos, así que las cinco rejillas caen en números
// enteros y se pueden etiquetar todas.
function niceMax(v, divisions) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 1;
  const div = divisions || 4;
  // Se elige primero el PASO de rejilla, no el tope: si el tope es redondo pero
  // el paso no, las rejillas intermedias salen con decimales (un tope de 15 en
  // cuartos da 3.75 y 11.25). Buscando el paso, las cinco etiquetas son enteras
  // por construcción.
  // Series de CONTEO: el paso no puede bajar de 1, o las rejillas salen en
  // fracciones de mención. Y con tope 1 un día de UNA mención llenaba el gráfico
  // entero, que es la lectura falsa que este redondeo viene a evitar: el piso en
  // `div` deja esa barra al 25% y rotula 0/1/2/3/4.
  if (n <= div) return div;
  const target = n / div;
  const mag = Math.pow(10, Math.floor(Math.log10(target || 1)));
  for (const m of [1, 2, 2.5, 5, 10]) {
    const step = m * mag;
    if (step * div >= n) return step * div;
  }
  return Math.ceil(n / (10 * mag * div)) * (10 * mag * div);
}

function useChartWidth(fallback) {
  const ref = React.useRef(null);
  const [w, setW] = React.useState(fallback);
  React.useLayoutEffect(() => {
    const measure = () => {
      if (!ref.current) return;
      const cw = ref.current.getBoundingClientRect().width;
      if (cw > 0) setW(cw);
    };
    measure();
    let ro = null;
    if (typeof ResizeObserver !== 'undefined' && ref.current) {
      ro = new ResizeObserver(measure);
      ro.observe(ref.current);
    }
    window.addEventListener('resize', measure);
    return () => { if (ro) ro.disconnect(); window.removeEventListener('resize', measure); };
  }, []);
  return [ref, w];
}

// Sparkline
// `width` acepta un número (ancho fijo) o la cadena 'auto', que MIDE el
// contenedor con useChartWidth igual que BandScale y MultiLineChart. 'auto'
// existe porque el KPI dibujaba 200px fijos dentro de cards cuyo content box es
// de 159px en desktop (219px las dos anchas) y ~133px en móvil a dos columnas: el
// `overflow:hidden` de la card cortaba el tramo FINAL de la serie —el valor más
// reciente, que es el que se lee— en Volumen y en Polarización, y dejaba ~19px de
// vacío a la derecha en NSS. En la card de Polarización el sparkline recortado
// convivía además con una BandScale al 100%, o sea dos bordes derechos distintos.
function Sparkline({ data, width = 80, height = 24, color = 'var(--accent)', accessor = (d) => d, fill = true }) {
  // El hook va ANTES de cualquier return: el orden de hooks debe ser estable.
  const auto = width === 'auto';
  const [ref, measured] = useChartWidth(120);
  const w = auto ? Math.max(1, measured) : width;
  // `width:100%` en el style hace que el rect medido sea el del contenedor; el
  // atributo `width` fija el sistema de coordenadas, así que ambos coinciden en
  // cuanto corre el layout effect (antes del primer pintado).
  const svgStyle = auto ? { display: 'block', width: '100%' } : { display: 'block' };
  const svgRef = auto ? ref : undefined;
  // Decorativo a propósito: un sparkline siempre acompaña al número que resume
  // la serie, así que anunciarlo duplicaría la información sin añadir nada.
  // Guard: sin datos no podemos calcular el path. smoothLinePath devuelve ''
  // y la destructuración `{ path, points } = ''` daba `points = undefined`,
  // que reventaba al leer `points[points.length - 1]`.
  if (!Array.isArray(data) || data.length === 0) {
    return <svg ref={svgRef} width={w} height={height} style={svgStyle} aria-hidden="true" focusable="false" />;
  }
  const res = smoothLinePath(data, w, height, accessor, 2);
  // Serie sin ningún valor finito: se devuelve un SVG vacío en vez de un path
  // con NaN. El caller ve un hueco, no una línea plana en cero.
  if (!res || !res.points || res.points.length === 0) {
    return <svg ref={svgRef} width={w} height={height} style={svgStyle} aria-hidden="true" focusable="false" />;
  }
  const { path, points } = res;
  const area = fill ? path + ` L ${points[points.length - 1][0]},${height} L ${points[0][0]},${height} Z` : '';
  return (
    <svg ref={svgRef} width={w} height={height} style={svgStyle} aria-hidden="true" focusable="false">
      {fill && <path d={area} fill={color} opacity="0.12" />}
      <path d={path} stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round" />
    </svg>
  );
}

// Big area line chart
function AreaLineChart({ data, height = 180, accessor, color = 'var(--accent)', showAxis = true, showGrid = true, yMin = null, yMax = null, a11yTitle }) {
  const [ref, w] = useChartWidth(600);
  const ids = useChartIds();
  const padding = { t: 10, r: 10, b: 22, l: 32 };
  const innerW = w - padding.l - padding.r;
  const innerH = height - padding.t - padding.b;
  const vals = data.map(accessor);
  const min = yMin !== null ? yMin : Math.min(...vals, 0);
  const max = yMax !== null ? yMax : Math.max(...vals);
  const range = max - min || 1;
  const step = innerW / Math.max(1, data.length - 1);
  const pts = data.map((d, i) => [i * step, innerH - ((accessor(d) - min) / range) * innerH]);
  let linePath = `M ${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const cx = (x0 + x1) / 2;
    linePath += ` C ${cx},${y0} ${cx},${y1} ${x1},${y1}`;
  }
  const areaPath = linePath + ` L ${pts[pts.length - 1][0]},${innerH} L ${pts[0][0]},${innerH} Z`;

  // y-axis ticks
  const yTicks = 4;
  const ticks = Array.from({ length: yTicks + 1 }, (_, i) => min + (range / yTicks) * i);
  const xTickCount = Math.min(6, data.length);
  const xIdxs = Array.from({ length: xTickCount }, (_, i) => Math.round((i * (data.length - 1)) / (xTickCount - 1)));

  return (
    <div ref={ref} style={{ width: '100%' }}>
      <svg width={w} height={height} role="img" aria-labelledby={ids.titleId}>
        <ChartTitle ids={ids} title={a11yTitle || 'Serie temporal'} />
        <defs>
          <linearGradient id="area-grad-ac" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <g transform={`translate(${padding.l},${padding.t})`}>
          {showGrid && ticks.map((t, i) => {
            const y = innerH - ((t - min) / range) * innerH;
            return <line key={i} x1={0} y1={y} x2={innerW} y2={y} stroke="var(--hairline)" strokeWidth="1" />;
          })}
          <path d={areaPath} fill="url(#area-grad-ac)" />
          <path d={linePath} stroke={color} strokeWidth="2" fill="none" />
          {showAxis && ticks.map((t, i) => {
            const y = innerH - ((t - min) / range) * innerH;
            return <text key={i} x={-6} y={y + 3} fontSize="var(--fs-overline)" textAnchor="end" fill="var(--text-3)" fontFamily="var(--ff-numeric)">{Math.round(t * 10) / 10}</text>;
          })}
          {showAxis && xIdxs.filter((idx) => data[idx] && data[idx].date).map((idx) => (
            <text key={idx} x={idx * step} y={innerH + 14} fontSize="var(--fs-overline)" textAnchor="middle" fill="var(--text-3)">{data[idx].date}</text>
          ))}
        </g>
      </svg>
    </div>
  );
}

// Multi-series line chart — stock-ticker style (crosshair, hover values, volume)
//
// Props:
//   sharedScale  (mio)    — todas las series comparten min=0/max=max(all);
//                           para sentiment timeline donde pos/neg deben ser
//                           comparables.
//   smooth       (mio)    — usa Catmull-Rom para las líneas (peaks puntiagudos
//                           sin "mesetas" laterales).
//   yDomain      (main)   — par [min, max] absoluto, fuerza ese rango Y. Útil
//                           en single-metric modal chart para mostrar el valor
//                           real dentro del rango oficial de la métrica. Tiene
//                           prioridad sobre sharedScale.
//   valueFormat  (main)   — función custom para formatear valores en tooltip;
//                           si no se pasa, usa el switch por key.
//   responsiveHeight (mio) — par [minH, maxH]. La altura se deriva del ANCHO
//                           medido del contenedor manteniendo una relación de
//                           aspecto legible (~2.6:1), acotada al par. Sin esto
//                           la altura era fija y el chart quedaba una banda
//                           delgada en pantallas grandes y apretada en chicas
//                           (petición del usuario: "deben ocupar mejor su
//                           contenedor... más dinámico su ancho de acuerdo a
//                           que se puede estar proyectando en pantallas más
//                           grandes o más chicas"). Tiene prioridad sobre
//                           `height`.
function MultiLineChart({ data, series, height = 260, responsiveHeight, onPointClick, sharedScale = false, smooth = false, yDomain, valueFormat, a11yTitle }) {
  const [ref, w] = useChartWidth(600);
  const ids = useChartIds();
  const [hover, setHover] = React.useState(null); // index or null
  // Altura derivada del ancho cuando se pide responsiveHeight: el chart crece
  // con su contenedor en vez de quedarse en una franja fija.
  const h = React.useMemo(() => {
    if (!Array.isArray(responsiveHeight) || responsiveHeight.length !== 2) return height;
    const [minH, maxH] = responsiveHeight;
    return Math.round(Math.max(minH, Math.min(maxH, w / 2.6)));
  }, [responsiveHeight, height, w]);
  // Padding left más amplio para que los Y-axis labels (números) quepan.
  // r=52: la etiqueta de último valor mide 46px y se dibuja en
  // translate(innerW + 4), así que necesita 4 + 46 = 50px. Con r=20 se
  // recortaban 30 de sus 46px y el chart cerraba mostrando un solo dígito.
  const padding = { t: 28, r: 52, b: 34, l: 44 };
  const innerW = Math.max(50, w - padding.l - padding.r);
  const innerH = h - padding.t - padding.b;

  // Guard de main: sin datos o sin series activas no podemos render — antes el
  // `data[hoverIdx][s.key]` tiraba "Cannot read properties of undefined" y
  // volaba toda la pantalla (Scorecard al cambiar a period sin TIMELINE).
  if (!Array.isArray(data) || data.length === 0 || !Array.isArray(series) || series.length === 0) {
    return (
      <div ref={ref} style={{ width: '100%', minHeight: h, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: 'var(--fs-caption)' }}>
        Sin datos suficientes para graficar.
      </div>
    );
  }

  // Normalize each series. Prioridad: yDomain absoluto (main, para modal KPI)
  // > sharedScale (mio, para sentiment timeline) > escala por serie (default).
  let normalized;
  if (Array.isArray(yDomain) && yDomain.length === 2) {
    const [yMin, yMax] = yDomain;
    normalized = series.map((s) => ({
      ...s, min: yMin, max: yMax, range: (yMax - yMin) || 1,
      vals: data.map((d) => d[s.key]),
    }));
  } else if (sharedScale) {
    // Los huecos se excluyen del dominio (antes `|| 0` los metía como ceros y
    // hundía el mínimo compartido).
    const allVals = series.flatMap((s) => data.map((d) => d[s.key])).filter((v) => !isGap(v));
    const sharedMin = 0;
    const sharedMax = Math.max(1, ...allVals);
    normalized = series.map((s) => ({
      ...s, min: sharedMin, max: sharedMax, range: sharedMax - sharedMin || 1,
      vals: data.map((d) => d[s.key]),
    }));
  } else {
    normalized = series.map((s) => {
      const vals = data.map((d) => d[s.key]);
      const finite = vals.filter((v) => !isGap(v));
      // Serie completamente vacía: dominio degenerado pero estable (nada que
      // dibujar, y ningún NaN propagándose al path).
      const min = finite.length ? Math.min(...finite) : 0;
      const max = finite.length ? Math.max(...finite) : 1;
      return { ...s, min, max, range: max - min || 1, vals };
    });
  }
  const step = innerW / Math.max(1, data.length - 1);
  const hoverIdx = hover == null ? data.length - 1 : hover;

  function onMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left - padding.l;
    const idx = Math.round(x / step);
    if (idx >= 0 && idx < data.length) setHover(idx);
  }

  // Formato del hover del strip multi-métrica. ESPEJO de @eco/shared/format
  // (escalas/umbrales canónicos viven allí; esto solo formatea por-punto del
  // chart, que la SPA estática no puede importar). Mantener en sync:
  //   crisis → % de riesgo · BHI → escala 1–10 · polarización → %.
  // Antes crisis/BHI salían como "0.59" crudo en el hover.
  function fmtVal(key, v) {
    // Guarda de nulos: sin esto, un null en cualquier serie lanzaba
    // "Cannot read properties of undefined (reading 'toFixed')" y el
    // EcoErrorBoundary se comía la pantalla entera.
    if (isGap(v)) return 's/d';
    if (typeof valueFormat === 'function') return valueFormat(v);
    if (key === 'totalMentions') return v >= 1000 ? (v/1000).toFixed(1) + 'K' : v.toFixed(0);
    if (key === 'nss') return (v > 0 ? '+' : '') + v.toFixed(1);
    if (key === 'crisisRiskScore') return Math.round(v * 100) + '%';
    if (key === 'brandHealthIndex') return (1 + v * 9).toFixed(1);
    if (key === 'polarizationIndex') return Math.round(v) + '%';
    if (key === 'engagementRate') return v.toFixed(1) + '%';
    return v.toFixed(1);
  }

  const dateLabel = data[hoverIdx]?.date || '';

  return (
    <div ref={ref} style={{ width: '100%', position: 'relative' }}>
      {/* Value strip / legend at top — stock-ticker style */}
      <div style={{ display: 'flex', gap: 'var(--sp-5)', alignItems: 'baseline', padding: '0 4px 10px', fontSize: 'var(--fs-overline)', flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: 'var(--fs-overline)', fontWeight: 700 }}>{dateLabel}</span>
        {normalized.map(s => {
          const v = data[hoverIdx][s.key];
          const first = s.vals.find((x) => !isGap(x));
          const delta = (!isGap(v) && !isGap(first) && first) ? ((v - first) / first) * 100 : null;
          return (
            <div key={s.key} style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--sp-15)' }}>
              <span style={{ width: 8, height: 2, background: s.color }} />
              <span style={{ color: 'var(--text-3)', fontSize: 'var(--fs-overline)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{s.label}</span>
              <span className="num" style={{ color: 'var(--text)', fontWeight: 600, fontSize: 'var(--fs-body-sm)' }}>{fmtVal(s.key, v)}</span>
              {/* La dirección la decide el contrato de la métrica, no el signo.
                  Esta tira pintaba TODA subida en --pos: un alza de Crisis
                  (declarada up-bad en data.js) salía verde, y una baja de
                  Menciones —volumen, declarado NEUTRO— salía roja. */}
              {delta == null ? (
                <span className="num" style={{ color: 'var(--text-3)', fontSize: 'var(--fs-overline)', fontWeight: 600 }}>—</span>
              ) : (
                <span className="num" style={{ color: window.ecoDeltaColor(s.metricKey || s.key, delta), fontSize: 'var(--fs-overline)', fontWeight: 600 }}>
                  {window.ecoDeltaArrow(delta)} {Math.abs(delta).toFixed(1)}%
                </span>
              )}
            </div>
          );
        })}
      </div>

      <svg width={w} height={h} role="img" aria-labelledby={`${ids.titleId} ${ids.descId}`}
        onMouseMove={onMove} onMouseLeave={() => setHover(null)}
        onClick={(e) => { if (!onPointClick) return; const rect = e.currentTarget.getBoundingClientRect(); const x = e.clientX - rect.left - padding.l; const idx = Math.round(x / step); if (idx >= 0 && idx < data.length) onPointClick(data[idx], idx); }}
        style={{ display: 'block', cursor: onPointClick ? 'pointer' : 'crosshair' }}>
        <ChartTitle ids={ids}
          title={a11yTitle || `Evolución de ${series.map((x) => x.label).join(', ')}`}
          desc={`${data.length} puntos, de ${data[0]?.date || ''} a ${data[data.length - 1]?.date || ''}. ` +
            (Array.isArray(yDomain) || sharedScale
              ? 'Todas las series comparten la escala vertical.'
              : 'Cada serie usa su propia escala vertical, así que las alturas no son comparables entre series.') +
            ' Los datos exactos están en la tabla que sigue.'} />
        <defs>
          {normalized.map(s => (
            <linearGradient key={s.key} id={`mlg-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity="0.18" />
              <stop offset="100%" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        <g transform={`translate(${padding.l},${padding.t})`}>
          {/* Y-axis gridlines + labels. Cuando sharedScale, mostramos valores
              numéricos en las gridlines. Si no, solo las líneas (cada serie
              tiene escala propia, no aplicaría un solo eje). */}
          {[0, 0.25, 0.5, 0.75, 1].map((p, i) => (
            <g key={i}>
              <line x1={0} y1={p * innerH} x2={innerW} y2={p * innerH} stroke="var(--hairline)" strokeDasharray={i === 0 || i === 4 ? '0' : '2 3'} />
              {sharedScale && normalized[0] && (
                <text x={-6} y={p * innerH + 3} fontSize="var(--fs-overline)" textAnchor="end" fill="var(--text-3)" fontFamily="var(--ff-numeric)">
                  {Math.round(normalized[0].max - (p * normalized[0].range))}
                </text>
              )}
            </g>
          ))}
          {/* Y-axis tick labels — solo cuando hay un yDomain absoluto, para
              dar contexto de escala (ej. crisis 0/0.5/1, BHI 1/5.5/10). Sin
              esto el usuario no sabe si la línea está en zona NORMAL o CRISIS. */}
          {Array.isArray(yDomain) && yDomain.length === 2 && normalized[0] && (() => {
            const s = normalized[0];
            return [0, 0.5, 1].map((p) => {
              const val = s.max - p * s.range;
              return (
                <text key={`yl-${p}`} x={-4} y={p * innerH + 3} fontSize="var(--fs-overline)" textAnchor="end"
                      fill="var(--text-3)" fontFamily="var(--ff-numeric)">
                  {fmtVal(s.key, val)}
                </text>
              );
            });
          })()}

          {/* Area fill SOLO cuando NO es sharedScale (donde tiene sentido
              destacar la primera serie). En shared-scale sentiment charts,
              el fill confundía visualmente. */}
          {!sharedScale && normalized[0] && (() => {
            const s = normalized[0];
            const pts = data.map((d, i) => isGap(d[s.key]) ? null : [i * step, innerH - ((d[s.key] - s.min) / s.range) * innerH]).filter(Boolean);
            if (pts.length < 2) return null;
            // Reemplazo el M inicial del path Catmull-Rom por L para anexarlo al
            // move-to bottom-left que abre el área.
            const lineFromL = catmullRomPath(pts).replace(/^M /, 'L ');
            const p = `M ${pts[0][0]},${innerH} ${lineFromL} L ${pts[pts.length - 1][0]},${innerH} Z`;
            return <path d={p} fill={`url(#mlg-${s.key})`} />;
          })()}

          {/* Lines — Catmull-Rom cuando smooth=true (pasa por cada punto sin
              overshoot ni mesetas) o straight L cuando smooth=false. */}
          {normalized.map((s) => {
            // Un hueco parte la línea: no se interpola por encima de un día sin
            // dato ni se baja a cero. Cada tramo contiguo es su propio <path>.
            const raw = data.map((d, i) => isGap(d[s.key]) ? null : [i * step, innerH - ((d[s.key] - s.min) / s.range) * innerH]);
            const segments = splitSegments(raw);
            return (
              <g key={s.key}>
                {segments.map((pts, si) => {
                  if (pts.length === 1) {
                    return <circle key={si} cx={pts[0][0]} cy={pts[0][1]} r="2.5" fill={s.color} />;
                  }
                  const useSmooth = smooth || (!sharedScale && pts.length > 2);
                  const p = useSmooth ? catmullRomPath(pts) : (() => {
                    let str = `M ${pts[0][0]},${pts[0][1]}`;
                    for (let i = 1; i < pts.length; i++) str += ` L ${pts[i][0]},${pts[i][1]}`;
                    return str;
                  })();
                  return <path key={si} d={p} stroke={s.color} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />;
                })}
              </g>
            );
          })}

          {/* Dots SIEMPRE visibles en cada día — el usuario puede verificar
              visualmente la posición exacta del peak y trazarla a la label X
              correspondiente. Tamaño pequeño (1.8px) para no saturar; grande
              (3.5px) en hover. */}
          {normalized.map((s) => (
            <g key={`${s.key}-dots`}>
              {data.map((d, i) => {
                if (isGap(d[s.key])) return null;
                const y = innerH - ((d[s.key] - s.min) / s.range) * innerH;
                const isHover = hover === i;
                return (
                  <circle key={i} cx={i * step} cy={y}
                    r={isHover ? 3.5 : (data.length <= 14 ? 2.5 : 1.8)}
                    fill={s.color} stroke="var(--canvas)" strokeWidth={isHover ? 1 : 0} />
                );
              })}
            </g>
          ))}

          {/* Crosshair + hover dots + tooltip flotante */}
          {hover != null && (() => {
            const xPos = hoverIdx * step;
            // Tooltip anclado al cursor con fecha + valores exactos para
            // eliminar ambiguedad cuando hay muchos días en pantalla (30D+).
            const tooltipW = 180;
            // Mostrar a la derecha por defecto, a la izquierda si está cerca
            // del borde derecho.
            const tooltipX = xPos + tooltipW + 8 > innerW ? xPos - tooltipW - 8 : xPos + 8;
            const tooltipY = 0;
            const lineCount = normalized.length;
            const tooltipH = 22 + lineCount * 18;
            const dotData = data[hoverIdx];
            return (
              <g>
                <line x1={xPos} y1={0} x2={xPos} y2={innerH} stroke="var(--text-3)" strokeWidth="0.75" strokeDasharray="3 3" />
                {normalized.map(s => {
                  if (isGap(dotData[s.key])) return null;
                  const y = innerH - ((dotData[s.key] - s.min) / s.range) * innerH;
                  return (
                    <g key={s.key}>
                      <circle cx={xPos} cy={y} r="5" fill="var(--canvas)" stroke={s.color} strokeWidth="2" />
                    </g>
                  );
                })}
                {/* Tooltip flotante — fondo + fecha + cada serie */}
                <g transform={`translate(${tooltipX},${tooltipY})`}>
                  <rect x={0} y={0} width={tooltipW} height={tooltipH} rx={6}
                    fill="var(--canvas)" stroke="var(--hairline-strong)" strokeWidth="1"
                    opacity="0.97" />
                  <text x={10} y={15} fontSize="11" fontWeight="700" fill="var(--text)" fontFamily="var(--ff-numeric)">
                    {dotData.fullDate || dotData.date || ''}
                  </text>
                  {normalized.map((s, i) => (
                    <g key={s.key}>
                      <rect x={10} y={22 + i * 18 + 4} width={8} height={8} fill={s.color} rx={2} />
                      <text x={24} y={22 + i * 18 + 11} fontSize="var(--fs-overline)" fill="var(--text-2)">{s.label}</text>
                      <text x={tooltipW - 10} y={22 + i * 18 + 11} fontSize="11" fontWeight="600" fill="var(--text)" textAnchor="end" fontFamily="var(--ff-numeric)">
                        {fmtVal(s.key, dotData[s.key])}
                      </text>
                    </g>
                  ))}
                </g>
              </g>
            );
          })()}

          {/* Last-point value tags on the right edge */}
          {normalized.map(s => {
            // Ancla al último punto CON dato: si la serie termina en hueco, la
            // etiqueta marcaba una posición inventada (o NaN).
            let lastIdx = -1;
            for (let i = data.length - 1; i >= 0; i--) { if (!isGap(data[i][s.key])) { lastIdx = i; break; } }
            if (lastIdx === -1) return null;
            const y = innerH - ((data[lastIdx][s.key] - s.min) / s.range) * innerH;
            const v = data[lastIdx][s.key];
            return (
              <g key={s.key + '-tag'} transform={`translate(${innerW + 4}, ${y})`}>
                <rect x={0} y={-8} width={46} height={16} fill={s.color} rx={2} />
                <text x={23} y={3} fontSize="var(--fs-overline)" fontWeight="700" fill="var(--on-accent)" textAnchor="middle" fontFamily="var(--ff-numeric)">{fmtVal(s.key, v)}</text>
              </g>
            );
          })}

          {/* X axis date labels — densidad adaptativa: muestra hasta 14
              labels cuando hay espacio para evitar ambiguedad visual entre
              picos y la fecha mostrada. */}
          {(() => {
            // Estimación conservadora: cada label necesita ~50px para no chocar.
            const maxLabels = Math.max(2, Math.floor(innerW / 50));
            const xTickCount = Math.min(maxLabels, data.length);
            const denom = Math.max(1, xTickCount - 1);
            const xIdxs = Array.from({ length: xTickCount }, (_, i) => Math.round((i * (data.length - 1)) / denom));
            // Deduplicar índices (cuando data.length < xTickCount).
            const seen = new Set();
            const unique = xIdxs.filter((idx) => {
              if (seen.has(idx)) return false;
              seen.add(idx);
              return true;
            });
            return unique
              .filter((idx) => data[idx] && data[idx].date)
              .map((idx) => (
                <text key={idx} x={idx * step} y={innerH + 16} fontSize="var(--fs-overline)" textAnchor="middle" fill="var(--text-3)" fontFamily="var(--ff-numeric)">{data[idx].date}</text>
              ));
          })()}
          {/* Tick marks bajo cada día (útil cuando hay >14 días y no caben labels) */}
          {data.length > 14 && data.map((_, i) => (
            <line key={`tick-${i}`} x1={i * step} y1={innerH} x2={i * step} y2={innerH + 3} stroke="var(--hairline)" strokeWidth="1" />
          ))}
        </g>
      </svg>
      <ChartTable ids={ids}
        caption={a11yTitle || `Datos de ${series.map((x) => x.label).join(', ')}`}
        columns={[{ key: 'date', label: 'Fecha' }].concat(series.map((x) => ({
          key: x.key, label: x.label, format: (v) => (isGap(v) ? 'sin dato' : fmtVal(x.key, v)),
        })))}
        rows={data} />
    </div>
  );
}

// BandScale — pista de bandas con marcador y etiquetas EN SU UMBRAL (WS-F8/G6).
//
// Reemplaza cuatro copias del mismo patrón (gauge de crisis en Overview y en
// Scorecard, BrandHealthMini, barra de Polarización), cada una con su propia
// aritmética y sus propias etiquetas.
//
// Arregla tres cosas que las cuatro copias tenían mal:
//
//  1. LAS ETIQUETAS ESTABAN EN EL SITIO EQUIVOCADO. Usaban
//     `justify-content: space-between`, que las reparte en cuartos IGUALES. Pero
//     los umbrales reales de crisis son 0.25 / 0.40 / 0.60, así que la palabra
//     "ALERTA" quedaba impresa sobre la zona de CRISIS y el marcador al 41%
//     parecía lejísimos de la alerta mientras el titular decía "Alerta". Aquí
//     cada etiqueta se ancla al CENTRO de su banda real.
//  2. SE PISABAN. Al subir la escala tipográfica a 11px, "APÁTICA MODERADA ALTA
//     EXTREMA" dejaba de caber y se leía "APÁTICAMODERADAALTAEXTREMA". Ahora las
//     etiquetas que no caben se ocultan (se conserva la primera y la última, que
//     son las que dan la escala) y siempre quedan legibles.
//  3. NO DECÍAN SU VALOR. El marcador no llevaba el número, así que había que
//     inferirlo de la posición.
function BandScale({ bands, value, max = 1, height = 6, valueLabel, ariaLabel }) {
  const [ref, w] = useChartWidth(240);
  const ids = useChartIds();
  const v = isGap(value) ? null : Math.min(max, Math.max(0, value));
  const pct = (x) => (x / max) * 100;

  // ¿Caben todas las etiquetas? Estimación conservadora de 6.4px por carácter a
  // 11px en Krub, más 8px de aire a cada lado.
  const totalChars = bands.reduce((n, b) => n + String(b.label).length, 0);
  // 6.9px/carácter y 14px de aire por etiqueta: la estimación anterior (6.4/8)
  // decía que caben y se tocaban («Elevado» pegado a «Alerta»).
  const fits = w === 0 || totalChars * 6.9 + bands.length * 14 <= w;
  const visible = fits
    ? bands.map((_, i) => i)
    // Si no caben, se conservan sólo los extremos: son los que fijan la escala.
    : [0, bands.length - 1];

  const activeIdx = v == null ? -1 : bands.findIndex((b, i) => v >= b.from && (v < b.to || i === bands.length - 1));

  return (
    <div ref={ref} style={{ width: '100%' }}>
      <div role="img" aria-labelledby={ids.titleId}
        style={{ height, borderRadius: 'var(--r-sm)', position: 'relative', overflow: 'hidden', display: 'flex' }}>
        <span id={ids.titleId} className="sr-only">
          {ariaLabel || 'Escala por bandas'}
          {v != null && activeIdx >= 0 ? `: ${valueLabel ?? v}, banda ${bands[activeIdx].label}` : ': sin dato'}
        </span>
        {bands.map((b, i) => (
          <span key={i} style={{
            // El ancho es proporcional al RANGO REAL de la banda, no 1/n.
            flex: (b.to - b.from),
            background: b.color,
            // La banda activa a plena saturación; las demás atenuadas, para que
            // el ojo vaya al veredicto sin perder la escala de referencia.
            // La severidad la codifica el COLOR, nunca la opacidad. Atenuar las
            // inactivas al 35% rompía la monotonía de la rampa: con el valor en
            // Alerta, la banda CRISIS —el extremo— quedaba más apagada que ella y
            // leía como "zona deshabilitada", y Elevado (ámbar) al 35% se volvía
            // oliva. La banda activa se marca con el anillo y con el marcador, no
            // apagando las demás.
            opacity: i === activeIdx ? 1 : 0.85,
            boxShadow: i === activeIdx ? 'inset 0 0 0 1px var(--text)' : undefined,
          }} />
        ))}
        {v != null && (
          <span aria-hidden="true" style={{
            position: 'absolute', left: `${pct(v)}%`, top: -2, bottom: -2,
            width: 2, background: 'var(--text)', transform: 'translateX(-50%)',
            borderRadius: 'var(--r-pill)',
          }} />
        )}
      </div>
      {/* Las etiquetas comparten la MISMA geometría que las bandas: cada una es
          un tramo flex con el mismo `flex: (to - from)`, así que el rótulo cae
          centrado sobre su banda por construcción y no por aritmética paralela.
          Antes había dos reglas de anclaje en la misma fila: los extremos al
          borde de la pista (left:0 / right:0) y los del medio al centro de su
          banda, de modo que "Crisis" —que rotula 0.60–1— se imprimía en el 100%,
          donde ya no hay banda que rotular, y "Normal" parecía el rótulo del
          origen de la escala. Las que no caben se ocultan con `visibility` y NO
          con return null: si desaparecieran del flex, las visibles se repartirían
          el ancho y volverían a descolocarse. */}
      <div style={{ display: 'flex', height: 15, marginTop: 'var(--sp-1)' }}>
        {bands.map((b, i) => (
          <span key={i} style={{
            flex: (b.to - b.from),
            minWidth: 0,
            textAlign: 'center',
            whiteSpace: 'nowrap',
            visibility: visible.includes(i) ? 'visible' : 'hidden',
            fontFamily: 'var(--ff-sans)',
            fontSize: 'var(--fs-overline)',
            fontWeight: i === activeIdx ? 700 : 500,
            color: i === activeIdx ? 'var(--text-2)' : 'var(--text-3)',
          }}>{b.label}</span>
        ))}
      </div>
    </div>
  );
}

// SeriesPanels — small multiples con dominio Y COMPARTIDO (WS-C2, arreglo de F2).
//
// El problema: `MultiLineChart` sin `sharedScale` normaliza cada serie a su
// propio min/max, así que dos series con el MISMO valor se dibujan a alturas
// distintas. Medido en el Overview: positivo=33 quedaba ~40% más arriba que
// negativo=35. El lector concluye lo contrario de lo que dicen los números.
//
// Por qué no basta con activar `sharedScale` en el mismo gráfico: con las tres
// líneas superpuestas y un pico grande (neg=203 en un día de crisis), la
// variación diaria normal se comprime en una banda plana al fondo — que es
// exactamente la queja que originó la normalización por serie.
//
// La salida es separar las series en paneles apilados que COMPARTEN el eje: cada
// una tiene su propia franja vertical (así se ve su forma) pero la misma escala
// (así las alturas son comparables). Se conservan las curvas suaves y el
// relleno, que es lo que el usuario pidió explícitamente.
function SeriesPanels({ data, series, panelHeight = 64, onPointClick, valueFormat, a11yTitle }) {
  const [ref, w] = useChartWidth(600);
  const ids = useChartIds();
  const [hover, setHover] = React.useState(null);
  const padding = { l: 44, r: 16 };
  const innerW = Math.max(50, w - padding.l - padding.r);

  if (!Array.isArray(data) || data.length === 0 || !Array.isArray(series) || series.length === 0) {
    return (
      <div ref={ref} style={{ width: '100%', minHeight: panelHeight * 2, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: 'var(--fs-caption)' }}>
        Sin datos suficientes para graficar.
      </div>
    );
  }

  // UN dominio para todas las series. Empieza en 0 porque son conteos: recortar
  // el cero exagera las diferencias relativas.
  const allVals = series.flatMap((sr) => data.map((d) => d[sr.key])).filter((v) => !isGap(v));
  const dMax = Math.max(1, ...allVals);
  const step = innerW / Math.max(1, data.length - 1);
  const hoverIdx = hover == null ? data.length - 1 : hover;
  const fmt = (v) => (isGap(v) ? 's/d' : (typeof valueFormat === 'function' ? valueFormat(v) : String(Math.round(v))));

  function onMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const idx = Math.round((e.clientX - rect.left - padding.l) / step);
    if (idx >= 0 && idx < data.length) setHover(idx);
  }

  const padTop = 8; // si no, la etiqueta del máximo del primer panel se recorta
  const totalH = padTop + series.length * panelHeight + 22;
  return (
    <div ref={ref} style={{ width: '100%', position: 'relative' }}>
      <svg width={w} height={totalH} role="img" aria-labelledby={`${ids.titleId} ${ids.descId}`}
        onMouseMove={onMove} onMouseLeave={() => setHover(null)}
        onClick={(e) => {
          if (!onPointClick) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const idx = Math.round((e.clientX - rect.left - padding.l) / step);
          if (idx >= 0 && idx < data.length) onPointClick(data[idx], idx);
        }}
        style={{ display: 'block', cursor: onPointClick ? 'pointer' : 'crosshair' }}>
        <ChartTitle ids={ids}
          title={a11yTitle || `Evolución de ${series.map((x) => x.label).join(', ')}`}
          desc={`${series.length} paneles apilados que comparten la misma escala vertical (0 a ${Math.round(dMax)}), así que las alturas SÍ son comparables entre series. ${data.length} puntos, de ${data[0]?.date || ''} a ${data[data.length - 1]?.date || ''}.`} />
        {series.map((sr, si) => {
          const top = padTop + si * panelHeight;
          const h = panelHeight - 12;
          const y = (v) => top + h - ((v - 0) / dMax) * h;
          const raw = data.map((d, i) => isGap(d[sr.key]) ? null : [padding.l + i * step, y(d[sr.key])]);
          const segs = splitSegments(raw);
          const hv = data[hoverIdx][sr.key];
          return (
            <g key={sr.key}>
              {/* base del panel */}
              <line x1={padding.l} y1={top + h} x2={padding.l + innerW} y2={top + h} stroke="var(--chart-grid)" />
              {/* techo = máximo compartido, rotulado UNA vez por panel para que la
                  escala sea visible y no haya que confiar en la memoria */}
              <line x1={padding.l} y1={top} x2={padding.l + innerW} y2={top} stroke="var(--chart-grid)" strokeDasharray="2 3" />
              <text x={padding.l - 6} y={top + 4} fontSize="var(--fs-overline)" textAnchor="end" fill="var(--chart-axis)" fontFamily="var(--ff-numeric)">{Math.round(dMax)}</text>
              <text x={padding.l - 6} y={top + h + 3} fontSize="var(--fs-overline)" textAnchor="end" fill="var(--chart-axis)" fontFamily="var(--ff-numeric)">0</text>
              {/* relleno + curva suave, que es lo que se quería conservar */}
              {segs.map((pts, i) => {
                if (pts.length < 2) return pts.length === 1 ? <circle key={i} cx={pts[0][0]} cy={pts[0][1]} r="2" fill={sr.color} /> : null;
                const line = catmullRomPath(pts);
                const area = `M ${pts[0][0]},${top + h} ${line.replace(/^M /, 'L ')} L ${pts[pts.length - 1][0]},${top + h} Z`;
                return (
                  <g key={i}>
                    <path d={area} fill={sr.color} opacity="0.14" />
                    <path d={line} stroke={sr.color} strokeWidth="1.75" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  </g>
                );
              })}
              {/* etiqueta de la serie DENTRO del panel */}
              <text x={padding.l + 4} y={top + 10} fontSize="var(--fs-overline)" fontWeight="600" fill={sr.color} fontFamily="var(--ff-sans)">{sr.label}</text>
              {/* valor en el punto bajo el cursor */}
              {!isGap(hv) && (
                <>
                  <circle cx={padding.l + hoverIdx * step} cy={y(hv)} r="3.5" fill="var(--canvas)" stroke={sr.color} strokeWidth="2" />
                  <text x={padding.l + innerW} y={top + 10} fontSize="11" fontWeight="700" textAnchor="end" fill="var(--text)" fontFamily="var(--ff-numeric)">{fmt(hv)}</text>
                </>
              )}
            </g>
          );
        })}
        {/* crosshair único, atravesando los paneles */}
        {hover != null && (
          <line x1={padding.l + hoverIdx * step} y1={padTop} x2={padding.l + hoverIdx * step} y2={padTop + series.length * panelHeight - 12}
            stroke="var(--chart-crosshair)" strokeWidth="0.75" strokeDasharray="3 3" />
        )}
        {/* eje X compartido */}
        {(() => {
          const maxLabels = Math.max(2, Math.floor(innerW / 62));
          const n = Math.min(maxLabels, data.length);
          const denom = Math.max(1, n - 1);
          const idxs = [...new Set(Array.from({ length: n }, (_, i) => Math.round((i * (data.length - 1)) / denom)))];
          return idxs.filter((i) => data[i]?.date).map((i) => (
            <text key={i} x={padding.l + i * step} y={totalH - 6} fontSize="var(--fs-overline)" textAnchor="middle" fill="var(--chart-axis)" fontFamily="var(--ff-numeric)">{data[i].date}</text>
          ));
        })()}
      </svg>
      <ChartTable ids={ids}
        caption={a11yTitle || `Datos de ${series.map((x) => x.label).join(', ')}`}
        columns={[{ key: 'date', label: 'Fecha' }].concat(series.map((x) => ({ key: x.key, label: x.label, format: (v) => fmt(v) })))}
        rows={data} />
    </div>
  );
}

// Stacked area (sentiment over time)
function StackedAreaChart({ data, keys, colors, height = 220, onPointClick, labels, a11yTitle }) {
  const [ref, w] = useChartWidth(600);
  const ids = useChartIds();
  const [hover, setHover] = React.useState(null); // índice del punto bajo el cursor
  const padding = { t: 10, r: 10, b: 24, l: 36 };
  const innerW = Math.max(50, w - padding.l - padding.r);
  const innerH = height - padding.t - padding.b;
  if (!Array.isArray(data) || data.length === 0 || !Array.isArray(keys) || keys.length === 0) {
    return (
      <div ref={ref} style={{ width: '100%', minHeight: height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: 'var(--fs-caption)' }}>
        Sin datos suficientes para graficar.
      </div>
    );
  }
  const totals = data.map((d) => keys.reduce((s, k) => s + (d[k] || 0), 0));
  // Tope redondeado: el eje deja de anunciar el máximo del dato como si fuera un
  // umbral, y el dominio se divide limpio entre las cinco rejillas.
  const max = niceMax(Math.max(1, ...totals), 4);
  const step = innerW / Math.max(1, data.length - 1);

  const stacks = data.map((d) => {
    let acc = 0;
    const out = {};
    keys.forEach((k) => { out[`${k}_start`] = acc; acc += (d[k] || 0); out[`${k}_end`] = acc; });
    return out;
  });

  function pickIdx(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left - padding.l;
    const idx = Math.round(x / step);
    return (idx >= 0 && idx < data.length) ? idx : null;
  }
  function onSvgClick(e) { if (!onPointClick) return; const idx = pickIdx(e); if (idx != null) onPointClick(data[idx], idx); }
  function onMove(e) { const idx = pickIdx(e); if (idx != null) setHover(idx); }

  // Label legible por serie. `labels` opcional permite { positivo: 'Positivo' }.
  function seriesLabel(k) {
    if (labels && labels[k]) return labels[k];
    return k.charAt(0).toUpperCase() + k.slice(1);
  }

  return (
    <div ref={ref} style={{ width: '100%' }}>
      <svg width={w} height={height} role="img" aria-labelledby={ids.titleId}
        onClick={onSvgClick}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        style={{ cursor: onPointClick ? 'pointer' : 'crosshair', display: 'block' }}>
        <ChartTitle ids={ids}
          title={a11yTitle || 'Volumen por sentimiento en el tiempo'}
          desc={`${(data || []).length} días. Área apilada: la altura total de cada columna es el volumen del día.`} />
        <g transform={`translate(${padding.l},${padding.t})`}>
          {[0, 0.25, 0.5, 0.75, 1].map((p, i) => (
            <line key={i} x1={0} y1={innerH * p} x2={innerW} y2={innerH * p} stroke="var(--hairline)" />
          ))}
          {keys.map((k, ki) => {
            const topPts = stacks.map((s, i) => [i * step, innerH - (s[`${k}_end`] / max) * innerH]);
            const botPts = stacks.map((s, i) => [i * step, innerH - (s[`${k}_start`] / max) * innerH]).reverse();
            const pts = [...topPts, ...botPts];
            const p = pts.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt[0]},${pt[1]}`).join(' ') + ' Z';
            return <path key={k} d={p} fill={colors[ki]} opacity="0.85" />;
          })}
          {/* Las cinco, no tres: con 5 rejillas y 3 etiquetas quedaban dos líneas
              huérfanas que el ojo tiene que interpolar. Ahora que el tope es
              redondo, los cinco valores son enteros. */}
          {[0, 0.25, 0.5, 0.75, 1].map((p, i) => {
            const v = max * (1 - p);
            return <text key={i} x={-6} y={innerH * p + 3} fontSize="var(--fs-overline)" textAnchor="end" fill="var(--text-3)" fontFamily="var(--ff-numeric)">{Math.round(v)}</text>;
          })}
          {(() => {
            const xTickCount = Math.min(7, data.length);
            const denom = Math.max(1, xTickCount - 1);
            const xIdxs = Array.from({ length: xTickCount }, (_, i) => Math.round((i * (data.length - 1)) / denom));
            return xIdxs
              .filter((idx) => data[idx] && data[idx].date)
              .map((idx, i, arr) => (
                // Los ticks EXTREMOS se ancklan al borde, no al centro: con
              // textAnchor='middle' el último se centraba en x=innerW y pedía
              // ~14px a la derecha, pero padding.r es 10, así que el svg lo
              // recortaba y en el eje se leía "27 ju" —una fecha cortada en la
              // gráfica principal, lo primero que se ve al proyectar—. El
              // primero, centrado en x=0, metía su mitad izquierda en la
              // canaleta del eje Y y se leía pegado al rótulo "0".
              <text key={idx} x={idx * step} y={innerH + 16} fontSize="var(--fs-overline)"
                textAnchor={i === 0 ? 'start' : i === arr.length - 1 ? 'end' : 'middle'}
                fill="var(--text-3)">{data[idx].date}</text>
              ));
          })()}

          {/* Crosshair + tooltip — patrón portado de MultiLineChart para que el
              gráfico de la pestaña Sentimiento muestre el dato exacto del día
              bajo el cursor (issue #3 del review). */}
          {hover != null && (() => {
            const d = data[hover];
            if (!d) return null;
            const xPos = hover * step;
            const lineCount = keys.length + 1; // +1 línea para el total
            const tooltipW = 180;
            const tooltipH = 22 + lineCount * 18;
            const tooltipX = (xPos + tooltipW + 8 > innerW) ? xPos - tooltipW - 8 : xPos + 8;
            const tooltipY = 0;
            const total = keys.reduce((s, k) => s + (d[k] || 0), 0);
            return (
              <g pointerEvents="none">
                <line x1={xPos} y1={0} x2={xPos} y2={innerH} stroke="var(--text-3)" strokeWidth="0.75" strokeDasharray="3 3" />
                {keys.map((k, ki) => {
                  const yEnd = innerH - ((stacks[hover][`${k}_end`]) / max) * innerH;
                  return <circle key={k} cx={xPos} cy={yEnd} r="4" fill="var(--canvas)" stroke={colors[ki]} strokeWidth="2" />;
                })}
                <g transform={`translate(${tooltipX},${tooltipY})`}>
                  <rect x={0} y={0} width={tooltipW} height={tooltipH} rx={6}
                    fill="var(--canvas)" stroke="var(--hairline-strong)" strokeWidth="1" opacity="0.97" />
                  <text x={10} y={15} fontSize="11" fontWeight="700" fill="var(--text)" fontFamily="var(--ff-numeric)">
                    {d.fullDate || d.date || ''}
                  </text>
                  {keys.map((k, i) => (
                    <g key={k}>
                      <rect x={10} y={22 + i * 18 + 4} width={8} height={8} fill={colors[i]} rx={2} />
                      <text x={24} y={22 + i * 18 + 11} fontSize="var(--fs-overline)" fill="var(--text-2)">{seriesLabel(k)}</text>
                      <text x={tooltipW - 10} y={22 + i * 18 + 11} fontSize="11" fontWeight="600" fill="var(--text)" textAnchor="end" fontFamily="var(--ff-numeric)">
                        {Math.round(d[k] || 0)}
                      </text>
                    </g>
                  ))}
                  <g>
                    <text x={10} y={22 + keys.length * 18 + 11} fontSize="var(--fs-overline)" fill="var(--text-3)" fontWeight="700">Total</text>
                    <text x={tooltipW - 10} y={22 + keys.length * 18 + 11} fontSize="11" fontWeight="700" fill="var(--text)" textAnchor="end" fontFamily="var(--ff-numeric)">
                      {Math.round(total)}
                    </text>
                  </g>
                </g>
              </g>
            );
          })()}
        </g>
      </svg>
    </div>
  );
}

// Donut chart
function Donut({ data, size = 120, thickness = 16, colors, total = null, a11yTitle }) {
  const ids = useChartIds();
  const sum = total ?? data.reduce((s, d) => s + (Number(d.value) || 0), 0);
  const r = (size - thickness) / 2;
  const cx = size / 2, cy = size / 2;
  let angle = -Math.PI / 2;
  // Un período sin menciones clasificadas trae `sum === 0`, y entonces
  // `frac = 0/0 = NaN` se escribía tal cual en el atributo `d`: tres <path>
  // inválidos y tres errores de consola en cada render. Es el mismo contrato que
  // smoothLinePath: una primitiva de gráfica NO emite NaN al DOM, pase lo que
  // pase con el dato. Sin datos se dibuja el anillo vacío, que ocupa el mismo
  // espacio y no miente: no hay composición que mostrar.
  const vacio = !Number.isFinite(sum) || sum <= 0;
  return (
    <svg width={size} height={size} role="img" aria-labelledby={ids.titleId}>
      <ChartTitle ids={ids}
        title={a11yTitle || 'Distribución'}
        desc={vacio
          ? 'Sin menciones clasificadas en el período.'
          : (data || []).map((d) => `${d.label || d.name}: ${d.value}`).join('; ')} />
      {vacio ? (
        <circle cx={cx} cy={cy} r={r} fill="none"
          stroke="var(--chart-void)" strokeWidth={thickness} />
      ) : data.map((d, i) => {
        const frac = (Number(d.value) || 0) / sum;
        if (!Number.isFinite(frac) || frac <= 0) return null;   // segmento sin dato: no se dibuja
        const a0 = angle;
        const a1 = angle + frac * Math.PI * 2;
        angle = a1;
        const large = frac > 0.5 ? 1 : 0;
        const x0 = cx + Math.cos(a0) * r;
        const y0 = cy + Math.sin(a0) * r;
        const x1 = cx + Math.cos(a1) * r;
        const y1 = cy + Math.sin(a1) * r;
        return (
          <path key={i}
            d={`M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`}
            stroke={colors[i]} strokeWidth={thickness} fill="none" strokeLinecap="butt" />
        );
      })}
    </svg>
  );
}

// Horizontal bar list
function HBarList({ items, colorFn, max, labelKey = 'label', valueKey = 'value', trackHeight = 6, onItemClick }) {
  const _max = max ?? Math.max(...items.map(i => i[valueKey]));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
      {items.map((it, i) => {
        const clickable = !!onItemClick;
        const El = clickable ? 'button' : 'div';
        return (
          <El key={i}
            onClick={clickable ? () => onItemClick(it, i) : undefined}
            aria-label={clickable ? `${it[labelKey]}: ${it[valueKey]}` : undefined}
            style={{
              display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', fontSize: 'var(--fs-caption)',
              background: 'transparent', border: 'none', padding: clickable ? '4px 6px' : 0,
              marginInline: clickable ? -6 : 0,
              borderRadius: 'var(--r-md)', textAlign: 'left', width: '100%',
              cursor: clickable ? 'pointer' : 'default',
            }}
            className={clickable ? 'row-hover' : undefined}>
            {/* title: la caja del rótulo es fija (120 px) y se trunca con
                ellipsis, así que sin tooltip un nombre largo de regla o de
                municipio deja de ser identificable. */}
            <div title={String(it[labelKey])} style={{ width: 120, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it[labelKey]}</div>
            <div className="bar-track" style={{ flex: 1, height: trackHeight }}>
              <div style={{ height: '100%', width: `${(it[valueKey] / _max) * 100}%`, background: colorFn ? colorFn(it, i) : 'var(--accent)', borderRadius: 'inherit', transition: 'width 0.3s var(--ease)' }} />
            </div>
            <div className="num" style={{ width: 44, textAlign: 'right', color: 'var(--text)', fontWeight: 600 }}>{it[valueKey].toLocaleString('es-PR')}</div>
          </El>
        );
      })}
    </div>
  );
}

// Radial gauge (crisis risk)
function RadialGauge({ value, max = 3, size = 120, thickness = 10, colorStops }) {
  const r = (size - thickness) / 2;
  const cx = size / 2, cy = size / 2;
  const start = Math.PI * 0.75, end = Math.PI * 2.25;
  const pct = Math.min(1, Math.max(0, value / max));
  const ang = start + (end - start) * pct;
  const largeBg = (end - start) > Math.PI ? 1 : 0;

  const x0 = cx + Math.cos(start) * r;
  const y0 = cy + Math.sin(start) * r;
  const x1 = cx + Math.cos(end) * r;
  const y1 = cy + Math.sin(end) * r;
  const xv = cx + Math.cos(ang) * r;
  const yv = cy + Math.sin(ang) * r;
  const largeV = (ang - start) > Math.PI ? 1 : 0;

  // color based on value
  let color = 'var(--pos)';
  if (value >= 2) color = 'var(--neg)';
  else if (value >= 1) color = 'var(--warn)';
  else if (value >= 0.5) color = 'var(--warn)';

  return (
    <svg width={size} height={size}>
      <path d={`M ${x0} ${y0} A ${r} ${r} 0 ${largeBg} 1 ${x1} ${y1}`}
        stroke="var(--canvas-2)" strokeWidth={thickness} fill="none" strokeLinecap="round" />
      <path d={`M ${x0} ${y0} A ${r} ${r} 0 ${largeV} 1 ${xv} ${yv}`}
        stroke={color} strokeWidth={thickness} fill="none" strokeLinecap="round" />
      <circle cx={xv} cy={yv} r={thickness / 1.6} fill="var(--canvas)" stroke={color} strokeWidth="2" />
    </svg>
  );
}

// Heatmap (hour x weekday)
// Mejoras issue #8: etiquetas de horas cada 2h en vez de cada 4h, separadores
// visuales en transiciones de turno (madrugada→mañana→tarde→noche), hover más
// pronunciado con z-index para que destaque sobre las celdas vecinas.
function Heatmap({ data, colorFn, gap = 2, hours = 24, days = 7, onCellClick, a11yTitle }) {
  const ids = useChartIds();
  const labels = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  // El agrupamiento lo decide el ANCHO MEDIDO del contenedor, no el viewport.
  //
  // Antes salía de `ecoUseBreakpoint()`, así que el heatmap del Scorecard —que
  // vive en una card de 292px— recibía 24 columnas por estar en un viewport de
  // desktop. Con celdas de 24px eso pide 622px, y el ancestro con
  // `overflow: hidden` recortaba 313px: TRECE DE LAS VEINTICUATRO HORAS
  // desaparecían sin ninguna señal. Con celdas fluidas no se recortaba nada pero
  // quedaban a 12px de ancho, bajo el mínimo táctil AA (SC 2.5.8).
  //
  // Agrupar es la salida que no miente: 24 horas en franjas de 2, 3, 4 o 6 horas
  // siguen mostrando el día completo, con celdas que se pueden tocar y una
  // etiqueta que dice el rango real (ver hourLabel). Se elige el grupo MÁS FINO
  // que quepa.
  const [wrapRef, boxW] = useChartWidth(0);
  const CELL_MIN = 24;
  const LABEL_W = 30;          // la canaleta del rótulo del día
  const bucket = React.useMemo(() => {
    // Sin medida todavía (primer render): franja de 2h, que es la que cabe en
    // cualquier ancho razonable, para no parpadear de 24 a 12 columnas.
    if (!boxW) return 2;
    for (const b of [1, 2, 3, 4, 6]) {
      const n = Math.ceil(hours / b);
      if (LABEL_W + n * CELL_MIN + (n - 1) * 2 <= boxW) return b;
    }
    return 6;
  }, [boxW, hours]);
  const cols = Math.ceil(hours / bucket);
  // Separadores en horas que marcan transición de turno (6am, 12pm, 6pm).
  // Cortes de turno (6am / 12pm / 6pm) expresados en columnas del grupo actual,
  // para que sigan cayendo en la misma HORA con cualquier agrupamiento.
  const SHIFT_BREAKS = new Set([6, 12, 18]
    .map((h) => h / bucket)
    .filter((c) => Number.isInteger(c) && c > 0 && c < cols));
  const extraGap = (c) => SHIFT_BREAKS.has(c) ? 4 : 0;
  const hourOf = (c) => c * bucket;
  const valueOf = (d, c) => {
    let sum = 0;
    for (let k = 0; k < bucket; k++) sum += (data[d * hours + hourOf(c) + k] ?? 0);
    return sum;
  };
  const hourLabel = (c) => bucket === 1
    ? `${String(hourOf(c)).padStart(2, '0')}:00`
    : `${String(hourOf(c)).padStart(2, '0')}:00–${String(hourOf(c) + bucket - 1).padStart(2, '0')}:59`;
  // Celdas fluidas: ocupan el ancho disponible en vez de un cellSize fijo.
  // `minmax(24px, 1fr)`, no `minmax(0, 1fr)`. Con base 0 la celda se comprimía a
  // 12-19px de ANCHO — bajo el mínimo de objetivo táctil de WCAG 2.2 AA (SC
  // 2.5.8), que aplica también con ratón — mientras `minHeight: 24` sólo defendía
  // el alto. El defecto llevaba ahí desde antes; no se veía porque el heatmap sin
  // datos no dibuja celdas que medir. Cuando 24 columnas a 24px no caben, la card
  // ya scrollea en horizontal (.scroll-x), que es preferible a un objetivo que no
  // se puede tocar.
  // minmax(CELL_MIN, 1fr): el piso defiende el objetivo táctil y el 1fr reparte
  // lo que sobre. Como `bucket` ya garantiza que caben, el piso nunca desborda.
  const gridCols = `repeat(${cols}, minmax(${CELL_MIN}px, 1fr))`;
  // Tabla equivalente: una rejilla de 7x12 (o 7x24) de celdas de color es
  // ilegible con lector de pantalla. Las celdas siguen siendo focoables una a
  // una (tabIndex + aria-label), y la tabla da la lectura completa.
  const tableRows = Array.from({ length: days }).map((_, d) => {
    const row = { dia: labels[d] };
    for (let c = 0; c < cols; c++) row[`h${c}`] = valueOf(d, c);
    return row;
  });
  const tableCols = [{ key: 'dia', label: 'Día' }].concat(
    Array.from({ length: cols }).map((_, c) => ({ key: `h${c}`, label: hourLabel(c) })));
  return (
    <div ref={wrapRef} role="group" aria-label={a11yTitle || 'Actividad por día y hora'}>
      <div style={{ display: 'grid', gridTemplateColumns: gridCols, gap: 'var(--sp-05)', marginLeft: 30, fontSize: 'var(--fs-overline)', color: 'var(--text-3)', marginBottom: 'var(--sp-1)' }}>
        {Array.from({ length: cols }).map((_, c) => (
          <div key={c} style={{ textAlign: 'center', marginLeft: extraGap(c), fontWeight: SHIFT_BREAKS.has(c) ? 700 : 400, color: SHIFT_BREAKS.has(c) ? 'var(--text-2)' : 'var(--text-3)' }}>
            {/* Con 24 columnas se rotula hora par para que no se apiñen; agrupado
                cabe una etiqueta por columna. */}
            {(bucket === 1 ? hourOf(c) % 2 === 0 : true) ? hourOf(c) : ''}
          </div>
        ))}
      </div>
      {Array.from({ length: days }).map((_, d) => (
        <div key={d} style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-05)', marginBottom: gap }}>
          <div style={{ width: 28, flexShrink: 0, fontSize: 'var(--fs-caption)', color: 'var(--text-3)', fontWeight: d === 5 || d === 6 ? 700 : 500 }}>{labels[d]}</div>
          <div style={{ display: 'grid', gridTemplateColumns: gridCols, gap: 'var(--sp-05)', flex: 1, minWidth: 0 }}>
            {Array.from({ length: cols }).map((_, c) => {
              const v = valueOf(d, c);
              const clickable = !!onCellClick;
              return (
                <div key={c}
                  role={clickable ? 'button' : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  aria-label={clickable ? `${labels[d]} ${hourLabel(c)}: ${v} menciones` : undefined}
                  onClick={clickable ? () => onCellClick({ day: d, dayLabel: labels[d], hour: hourOf(c), hourEnd: hourOf(c) + bucket - 1, value: v }) : undefined}
                  onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCellClick({ day: d, dayLabel: labels[d], hour: hourOf(c), hourEnd: hourOf(c) + bucket - 1, value: v }); } } : undefined}
                  title={`${labels[d]} ${hourLabel(c)} — ${v} menciones`}
                  className={clickable ? 'eco-heat-cell' : undefined}
                  style={{
                    // Sin `aspectRatio: '1 / 1'`: era una declaración muerta y
                    // contradictoria. Con 24 columnas fluidas la celda mide ~12px de
                    // ancho en la card de desktop, así que el cuadrado pedía 12px de
                    // alto y `minHeight` ganaba siempre: las celdas medidas son 12x24,
                    // nunca cuadradas. Se declara lo que de verdad manda.
                    // >=24px en ambos modos: es el mínimo de objetivo táctil de
                    // WCAG 2.2 AA (SC 2.5.8), y aplica también con ratón.
                    minHeight: 24,
                    background: colorFn(v),
                    borderRadius: 'var(--r-sm)',
                    marginLeft: extraGap(c),
                    cursor: clickable ? 'pointer' : 'default',
                    position: 'relative',
                  }}
                />
              );
            })}
          </div>
        </div>
      ))}
      <ChartTable ids={ids}
        caption={a11yTitle || 'Menciones por día de la semana y franja horaria'}
        columns={tableCols} rows={tableRows} />
    </div>
  );
}

// Puerto Rico map — tile-style mockup (Mapbox/Leaflet look)
// Real map backed by Leaflet + OpenStreetMap tiles (no API key).
// Falls back to the SVG mockup if Leaflet hasn't loaded yet.
// Alto del mapa. Era 420px literal en cualquier viewport: en móvil la isla
// ocupa 107 de esos 420 (25%) y el resto es basemap vacío, en la pantalla donde
// el alto es el recurso escaso. Ahora sale del ancho con la proporción de la
// isla (~2.6:1), con piso de 240 para que el encuadre no se quede sin sitio y
// techo en los 420 de antes para no crecer en pantallas anchas.
const MAP_HEIGHT = 'clamp(240px, 30vw, 420px)';

function PRMap({ municipalities, accessor, colorFn, onMunicipalityClick }) {
  const containerRef = React.useRef(null);
  const mapRef = React.useRef(null);
  const markersLayerRef = React.useRef(null);
  const tilesRef = React.useRef({ dark: null, light: null, active: null });

  // Mount Leaflet once, then re-render markers whenever inputs change.
  React.useEffect(() => {
    if (!containerRef.current || typeof window === 'undefined' || !window.L) return;
    const L = window.L;
    if (!mapRef.current) {
      const map = L.map(containerRef.current, {
        center: [18.22, -66.59],
        zoom: 9,
        // 7 y no 8: en móvil el fitBounds ya tocaba el piso de zoom (el control
        // de alejar sale deshabilitado), así que la isla quedaba recortada y las
        // etiquetas del basemap se encavalgaban con los marcadores.
        minZoom: 7,
        maxZoom: 14,
        scrollWheelZoom: true,
        zoomControl: true,
        attributionControl: true,
      });
      // Two tile layers — swapped when the Mando/Costa mode toggle changes.
      const dark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19,
      });
      const light = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19,
      });
      tilesRef.current = { dark, light, active: null };

      function applyMode() {
        const mode = document.documentElement.getAttribute('data-mode') || 'dark';
        const nextLayer = mode === 'light' ? light : dark;
        if (tilesRef.current.active === nextLayer) return;
        if (tilesRef.current.active) map.removeLayer(tilesRef.current.active);
        nextLayer.addTo(map);
        tilesRef.current.active = nextLayer;
      }
      applyMode();

      // Watch the <html data-mode> attribute so the map base layer follows
      // the dashboard's theme toggle automatically.
      const observer = new MutationObserver(applyMode);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode'] });
      tilesRef.current.observer = observer;

      markersLayerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;

      // Leaflet mide el contenedor al construirse; si el ancho aún no se ha
      // asentado (montaje inicial, colapso del sidebar que no dispara resize
      // de window, etc.) los tiles quedan recortados/desplazados. Un
      // ResizeObserver + un invalidateSize inicial lo mantienen correcto.
      requestAnimationFrame(() => { if (mapRef.current) mapRef.current.invalidateSize(); });
      if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
        const ro = new ResizeObserver(() => { if (mapRef.current) mapRef.current.invalidateSize(); });
        ro.observe(containerRef.current);
        tilesRef.current.resizeObserver = ro;
      }
    }

    const layer = markersLayerRef.current;
    layer.clearLayers();

    const valid = (municipalities || []).filter((m) => m.lat && m.lon);
    if (valid.length === 0) return;
    const max = Math.max(...valid.map(accessor), 1);

    // De mayor a menor, para que con relleno opaco un municipio pequeño no
    // desaparezca debajo de San Juan: el pequeño se pinta encima.
    [...valid].sort((a, b) => accessor(b) - accessor(a)).forEach((m) => {
      const v = accessor(m);
      const r = mapMarkerRadius(v, max);
      const color = colorFn(m);
      const clickable = !!onMunicipalityClick;
      // Leaflet recibe los colores como STRINGS en opciones JS, no como CSS, así
      // que no puede resolver `var(--pos)`. Por eso van por ecoTokenValue(), que
      // los resuelve con getComputedStyle en cada render — y por eso el modo
      // CLARO estaba roto aquí: los marcadores y el tooltip llevaban hex de modo
      // oscuro (#0E1620, #3FD47A, #FF6A3D, #8A94A1, #E6ECF3) escritos a mano.
      const T = (t) => window.ecoTokenValue(t);
      const marker = L.circleMarker([m.lat, m.lon], {
        radius: r,
        fillColor: color.startsWith('var(') ? T(color) : color,
        color: T('var(--canvas)'),
        weight: 1.5,
        // El alpha vive en el TOKEN (--seq-* es una rampa de opacidad): un 0.78
        // encima lo multiplicaba por segunda vez, así que el chip de la leyenda
        // y el marcador del mismo dato no coincidían (−18% de luminancia) y el
        // paso más bajo quedaba en alpha efectivo 0.06.
        fillOpacity: 1,
        className: 'eco-map-marker',
      });
      // Escala canónica del NSS (−100..100, #92): entero, sin decimal.
      const nssStr = (m.nss > 0 ? '+' : '') + Math.round(m.nss ?? 0);
      // El tooltip juzga el NSS con el MISMO umbral que el relleno del marcador
      // y que la leyenda (ecoNssColor, banda ±20). Antes con >0/<0, así que el
      // mismo municipio salía ámbar en el círculo y rojo en su tooltip.
      const nssColor = T(window.ecoNssColor(m.nss));
      const label = m.name.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      // El tooltip siempre muestra el conteo real de menciones (m.count). En
      // modo "Sentimiento" el accessor devuelve |NSS|, que NO es un conteo, así
      // que nunca debe etiquetarse como "menciones".
      const cnt = (m.count ?? 0).toLocaleString('es-PR');
      marker.bindTooltip(
        `<div style="font-family:${T('var(--ff-sans)')};font-size:12px;line-height:1.35;">
          <div style="font-weight:700;color:${T('var(--text)')};margin-bottom:2px;">${label}</div>
          <div style="color:${T('var(--text-2)')};">${m.region}</div>
          <div style="margin-top:4px;"><span style="color:${T('var(--text)')};font-weight:600;">${cnt}</span> menciones</div>
          <div style="color:${nssColor};font-weight:600;">NSS ${nssStr}</div>
        </div>`,
        { direction: 'top', offset: [0, -4], opacity: 0.95, className: 'eco-map-tooltip' },
      );
      if (clickable) marker.on('click', () => onMunicipalityClick(m));
      marker.addTo(layer);
    });

    // Fit the map to the markers so the user always sees PR framed.
    const group = L.featureGroup(layer.getLayers());
    if (group.getLayers().length > 0) {
      mapRef.current.fitBounds(group.getBounds(), { padding: [24, 24], maxZoom: 10 });
    }
  }, [municipalities, accessor, colorFn, onMunicipalityClick]);

  // Cleanup on unmount.
  React.useEffect(() => () => {
    if (tilesRef.current.observer) tilesRef.current.observer.disconnect();
    if (tilesRef.current.resizeObserver) tilesRef.current.resizeObserver.disconnect();
    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }
  }, []);

  // If Leaflet hasn't loaded, show a lightweight placeholder (never the fake SVG).
  if (typeof window !== 'undefined' && !window.L) {
    return (
      <div style={{ height: MAP_HEIGHT, borderRadius: 'var(--r-lg)', background: 'var(--canvas-2)', border: '1px solid var(--hairline)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: 'var(--fs-caption)' }}>
        Cargando mapa…
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{
        height: MAP_HEIGHT,
        borderRadius: 'var(--r-lg)',
        overflow: 'hidden',
        border: '1px solid var(--hairline)',
        background: 'var(--canvas-2)',
      }}
    />
  );
}

// Radio del marcador del mapa. El ojo lee el ÁREA del círculo, no el radio: con
// el radio lineal en el dato (r = 8 + v/max*22) Bayamón —146 menciones, 42% de
// San Juan— dibujaba un área del 33%, y TODOS los municipios medios salían ~20
// puntos por debajo de su volumen real. Con la raíz el área ES el dato: 42% del
// dato, 42% del área. El piso de 6px existe sólo como objetivo de click para un
// municipio con 1-2 menciones (por debajo de ~4% del máximo el círculo
// sobre-representa, que es el lado seguro del error).
// Exportada porque la LEYENDA de tamaño tiene que medir con esta misma función:
// leyenda y marca no pueden divergir (fue el hallazgo F6 en el eje del color).
function mapMarkerRadius(v, max) {
  const R_MAX = 30, R_MIN = 6;
  const frac = max > 0 ? Math.max(0, Math.min(1, v / max)) : 0;
  return Math.max(R_MIN, R_MAX * Math.sqrt(frac));
}

window.ECO_CHARTS = {
  // useChartWidth se exporta porque el streamgraph y el mapa de Narrativas
  // dibujan en un viewBox propio, y dentro de un viewBox escalado ningún
  // `font-size` vale lo que dice el token: se multiplica por (ancho renderizado
  // / ancho del viewBox). Medir el contenedor es la única forma de que --fs-*
  // signifique píxeles también dentro de un SVG.
  useChartWidth,
  SeriesPanels,
  BandScale,
  Sparkline, AreaLineChart, MultiLineChart, StackedAreaChart,
  Donut, HBarList, RadialGauge, Heatmap, PRMap,
  mapMarkerRadius,
};
