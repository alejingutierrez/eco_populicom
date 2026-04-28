// SVG chart primitives — no external libs, tuned to theme via CSS vars

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
  const min = minY !== null ? minY : Math.min(...vals);
  const max = maxY !== null ? maxY : Math.max(...vals);
  const range = max - min || 1;
  const step = (w - padding * 2) / Math.max(1, data.length - 1);
  const pts = data.map((d, i) => [padding + i * step, h - padding - ((accessor(d) - min) / range) * (h - padding * 2)]);
  let p = `M ${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const cx = (x0 + x1) / 2;
    p += ` C ${cx},${y0} ${cx},${y1} ${x1},${y1}`;
  }
  return { path: p, points: pts };
}

// Sparkline
function Sparkline({ data, width = 80, height = 24, color = 'var(--accent)', accessor = (d) => d, fill = true }) {
  const { path, points } = smoothLinePath(data, width, height, accessor, 2);
  const area = fill ? path + ` L ${points[points.length - 1][0]},${height} L ${points[0][0]},${height} Z` : '';
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      {fill && <path d={area} fill={color} opacity="0.12" />}
      <path d={path} stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round" />
    </svg>
  );
}

// Big area line chart
function AreaLineChart({ data, height = 180, accessor, color = 'var(--accent)', showAxis = true, showGrid = true, yMin = null, yMax = null }) {
  const ref = React.useRef(null);
  const [w, setW] = React.useState(600);
  React.useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
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
      <svg width={w} height={height}>
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
            return <text key={i} x={-6} y={y + 3} fontSize="10" textAnchor="end" fill="var(--text-3)" fontFamily="var(--ff-numeric)">{Math.round(t * 10) / 10}</text>;
          })}
          {showAxis && xIdxs.filter((idx) => data[idx] && data[idx].date).map((idx) => (
            <text key={idx} x={idx * step} y={innerH + 14} fontSize="10" textAnchor="middle" fill="var(--text-3)">{data[idx].date}</text>
          ))}
        </g>
      </svg>
    </div>
  );
}

// Multi-series line chart — stock-ticker style (crosshair, hover values, volume)
function MultiLineChart({ data, series, height = 260, onPointClick }) {
  const ref = React.useRef(null);
  const [w, setW] = React.useState(600);
  const [hover, setHover] = React.useState(null); // index or null
  React.useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  const padding = { t: 28, r: 20, b: 34, l: 20 };
  const innerW = Math.max(50, w - padding.l - padding.r);
  const innerH = height - padding.t - padding.b;

  // Normalize each series to 0-1 for display
  const normalized = series.map((s) => {
    const vals = data.map((d) => d[s.key]);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    return { ...s, min, max, range: max - min || 1, vals };
  });
  const step = innerW / Math.max(1, data.length - 1);
  const hoverIdx = hover == null ? data.length - 1 : hover;

  function onMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left - padding.l;
    const idx = Math.round(x / step);
    if (idx >= 0 && idx < data.length) setHover(idx);
  }

  function fmtVal(key, v) {
    if (key === 'totalMentions') return v >= 1000 ? (v/1000).toFixed(1) + 'K' : v.toFixed(0);
    if (key === 'nss') return (v > 0 ? '+' : '') + v.toFixed(1);
    if (key === 'crisisRiskScore') return v.toFixed(1);
    if (key === 'brandHealthIndex') return v.toFixed(2);
    if (key === 'engagementRate') return v.toFixed(1) + '%';
    return v.toFixed(1);
  }

  const dateLabel = data[hoverIdx]?.date || '';

  return (
    <div ref={ref} style={{ width: '100%', position: 'relative' }}>
      {/* Value strip / legend at top — stock-ticker style */}
      <div style={{ display: 'flex', gap: 18, alignItems: 'baseline', padding: '0 4px 10px', fontSize: 11, flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: 9, fontWeight: 700 }}>{dateLabel}</span>
        {normalized.map(s => {
          const v = data[hoverIdx][s.key];
          const first = s.vals[0];
          const delta = first ? ((v - first) / first) * 100 : 0;
          return (
            <div key={s.key} style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{ width: 8, height: 2, background: s.color }} />
              <span style={{ color: 'var(--text-3)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{s.label}</span>
              <span className="num" style={{ color: 'var(--text)', fontWeight: 600, fontSize: 13 }}>{fmtVal(s.key, v)}</span>
              <span className="num" style={{ color: delta >= 0 ? 'var(--pos)' : 'var(--neg)', fontSize: 10, fontWeight: 600 }}>
                {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}%
              </span>
            </div>
          );
        })}
      </div>

      <svg width={w} height={height} onMouseMove={onMove} onMouseLeave={() => setHover(null)}
        onClick={(e) => { if (!onPointClick) return; const rect = e.currentTarget.getBoundingClientRect(); const x = e.clientX - rect.left - padding.l; const idx = Math.round(x / step); if (idx >= 0 && idx < data.length) onPointClick(data[idx], idx); }}
        style={{ display: 'block', cursor: onPointClick ? 'pointer' : 'crosshair' }}>
        <defs>
          {normalized.map(s => (
            <linearGradient key={s.key} id={`mlg-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity="0.18" />
              <stop offset="100%" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        <g transform={`translate(${padding.l},${padding.t})`}>
          {/* subtle y gridlines */}
          {[0, 0.25, 0.5, 0.75, 1].map((p, i) => (
            <line key={i} x1={0} y1={p * innerH} x2={innerW} y2={p * innerH} stroke="var(--hairline)" strokeDasharray={i === 0 || i === 4 ? '0' : '2 3'} />
          ))}

          {/* Primary series area fill (first one only) */}
          {normalized[0] && (() => {
            const s = normalized[0];
            const pts = data.map((d, i) => [i * step, innerH - ((d[s.key] - s.min) / s.range) * innerH]);
            let p = `M ${pts[0][0]},${innerH} L ${pts[0][0]},${pts[0][1]}`;
            for (let i = 1; i < pts.length; i++) {
              const [x0, y0] = pts[i - 1];
              const [x1, y1] = pts[i];
              const cx = (x0 + x1) / 2;
              p += ` C ${cx},${y0} ${cx},${y1} ${x1},${y1}`;
            }
            p += ` L ${pts[pts.length - 1][0]},${innerH} Z`;
            return <path d={p} fill={`url(#mlg-${s.key})`} />;
          })()}

          {/* Lines */}
          {normalized.map((s) => {
            const pts = data.map((d, i) => [i * step, innerH - ((d[s.key] - s.min) / s.range) * innerH]);
            let p = `M ${pts[0][0]},${pts[0][1]}`;
            for (let i = 1; i < pts.length; i++) {
              const [x0, y0] = pts[i - 1];
              const [x1, y1] = pts[i];
              const cx = (x0 + x1) / 2;
              p += ` C ${cx},${y0} ${cx},${y1} ${x1},${y1}`;
            }
            return <path key={s.key} d={p} stroke={s.color} strokeWidth="1.75" fill="none" strokeLinecap="round" strokeLinejoin="round" />;
          })}

          {/* Crosshair + hover dots + right-edge value tags */}
          {hover != null && (
            <g>
              <line x1={hoverIdx * step} y1={0} x2={hoverIdx * step} y2={innerH} stroke="var(--text-3)" strokeWidth="0.75" strokeDasharray="3 3" />
              {normalized.map(s => {
                const y = innerH - ((data[hoverIdx][s.key] - s.min) / s.range) * innerH;
                return (
                  <g key={s.key}>
                    <circle cx={hoverIdx * step} cy={y} r="5" fill="var(--canvas)" stroke={s.color} strokeWidth="2" />
                  </g>
                );
              })}
            </g>
          )}

          {/* Last-point value tags on the right edge */}
          {normalized.map(s => {
            const lastIdx = data.length - 1;
            const y = innerH - ((data[lastIdx][s.key] - s.min) / s.range) * innerH;
            const v = data[lastIdx][s.key];
            return (
              <g key={s.key + '-tag'} transform={`translate(${innerW + 4}, ${y})`}>
                <rect x={0} y={-8} width={46} height={16} fill={s.color} rx={2} />
                <text x={23} y={3} fontSize="10" fontWeight="700" fill="#fff" textAnchor="middle" fontFamily="var(--ff-numeric)">{fmtVal(s.key, v)}</text>
              </g>
            );
          })}

          {/* X axis date labels */}
          {(() => {
            const xTickCount = Math.min(7, data.length);
            // Guard against division-by-zero (data.length === 1 makes
            // xTickCount-1 === 0, so the index becomes NaN and data[NaN]
            // crashes "Cannot read properties of undefined").
            const denom = Math.max(1, xTickCount - 1);
            const xIdxs = Array.from({ length: xTickCount }, (_, i) => Math.round((i * (data.length - 1)) / denom));
            return xIdxs
              .filter((idx) => data[idx] && data[idx].date)
              .map((idx) => (
                <text key={idx} x={idx * step} y={innerH + 16} fontSize="10" textAnchor="middle" fill="var(--text-3)" fontFamily="var(--ff-numeric)">{data[idx].date}</text>
              ));
          })()}
        </g>
      </svg>
    </div>
  );
}

// Stacked area (sentiment over time)
function StackedAreaChart({ data, keys, colors, height = 220, onPointClick }) {
  const ref = React.useRef(null);
  const [w, setW] = React.useState(600);
  React.useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  const padding = { t: 10, r: 10, b: 24, l: 36 };
  const innerW = Math.max(50, w - padding.l - padding.r);
  const innerH = height - padding.t - padding.b;
  const totals = data.map((d) => keys.reduce((s, k) => s + d[k], 0));
  const max = Math.max(...totals);
  const step = innerW / Math.max(1, data.length - 1);

  const stacks = data.map((d) => {
    let acc = 0;
    const out = {};
    keys.forEach((k) => { out[`${k}_start`] = acc; acc += d[k]; out[`${k}_end`] = acc; });
    return out;
  });

  function onSvgClick(e) {
    if (!onPointClick) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left - padding.l;
    const idx = Math.round(x / step);
    if (idx >= 0 && idx < data.length) onPointClick(data[idx], idx);
  }

  return (
    <div ref={ref} style={{ width: '100%' }}>
      <svg width={w} height={height} onClick={onSvgClick} style={{ cursor: onPointClick ? 'pointer' : 'default' }}>
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
          {[0, 0.5, 1].map((p, i) => {
            const v = max * (1 - p);
            return <text key={i} x={-6} y={innerH * p + 3} fontSize="10" textAnchor="end" fill="var(--text-3)" fontFamily="var(--ff-numeric)">{Math.round(v)}</text>;
          })}
          {(() => {
            const xTickCount = Math.min(7, data.length);
            const denom = Math.max(1, xTickCount - 1);
            const xIdxs = Array.from({ length: xTickCount }, (_, i) => Math.round((i * (data.length - 1)) / denom));
            return xIdxs
              .filter((idx) => data[idx] && data[idx].date)
              .map((idx) => (
                <text key={idx} x={idx * step} y={innerH + 16} fontSize="10" textAnchor="middle" fill="var(--text-3)">{data[idx].date}</text>
              ));
          })()}
        </g>
      </svg>
    </div>
  );
}

// Donut chart
function Donut({ data, size = 120, thickness = 16, colors, total = null }) {
  const sum = total ?? data.reduce((s, d) => s + d.value, 0);
  const r = (size - thickness) / 2;
  const cx = size / 2, cy = size / 2;
  let angle = -Math.PI / 2;
  return (
    <svg width={size} height={size}>
      {data.map((d, i) => {
        const frac = d.value / sum;
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {items.map((it, i) => {
        const clickable = !!onItemClick;
        const El = clickable ? 'button' : 'div';
        return (
          <El key={i}
            onClick={clickable ? () => onItemClick(it, i) : undefined}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, fontSize: 12,
              background: 'transparent', border: 'none', padding: clickable ? '4px 6px' : 0,
              marginInline: clickable ? -6 : 0,
              borderRadius: 6, textAlign: 'left', width: '100%',
              cursor: clickable ? 'pointer' : 'default',
            }}
            className={clickable ? 'row-hover' : undefined}>
            <div style={{ width: 120, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it[labelKey]}</div>
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
function Heatmap({ data, colorFn, cellSize = 16, gap = 2, hours = 24, days = 7, onCellClick }) {
  const labels = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  return (
    <div>
      <div style={{ display: 'flex', gap: 2, marginLeft: 30, fontSize: 9, color: 'var(--text-3)', marginBottom: 4 }}>
        {Array.from({ length: hours }).map((_, h) => (
          <div key={h} style={{ width: cellSize, textAlign: 'center' }}>{h % 4 === 0 ? h : ''}</div>
        ))}
      </div>
      {Array.from({ length: days }).map((_, d) => (
        <div key={d} style={{ display: 'flex', alignItems: 'center', gap: 2, marginBottom: gap }}>
          <div style={{ width: 28, fontSize: 10, color: 'var(--text-3)' }}>{labels[d]}</div>
          {Array.from({ length: hours }).map((_, h) => {
            const v = data[d * hours + h] ?? 0;
            const clickable = !!onCellClick;
            return (
              <div key={h}
                role={clickable ? 'button' : undefined}
                onClick={clickable ? () => onCellClick({ day: d, dayLabel: labels[d], hour: h, value: v }) : undefined}
                title={`${labels[d]} ${h}h: ${v}`}
                style={{ width: cellSize, height: cellSize, background: colorFn(v), borderRadius: 3, cursor: clickable ? 'pointer' : 'default', transition: 'transform 0.12s var(--ease)' }}
                onMouseEnter={clickable ? (e) => { e.currentTarget.style.transform = 'scale(1.25)'; e.currentTarget.style.outline = '2px solid var(--accent)'; } : undefined}
                onMouseLeave={clickable ? (e) => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.outline = 'none'; } : undefined}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

// Puerto Rico map — tile-style mockup (Mapbox/Leaflet look)
// Real map backed by Leaflet + OpenStreetMap tiles (no API key).
// Falls back to the SVG mockup if Leaflet hasn't loaded yet.
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
        minZoom: 8,
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
    }

    const layer = markersLayerRef.current;
    layer.clearLayers();

    const valid = (municipalities || []).filter((m) => m.lat && m.lon);
    if (valid.length === 0) return;
    const max = Math.max(...valid.map(accessor), 1);

    valid.forEach((m) => {
      const v = accessor(m);
      const r = 8 + (v / max) * 22;
      const color = colorFn(m);
      const clickable = !!onMunicipalityClick;
      const marker = L.circleMarker([m.lat, m.lon], {
        radius: r,
        fillColor: color,
        color: '#0E1620',
        weight: 1.5,
        fillOpacity: 0.78,
        className: 'eco-map-marker',
      });
      const nssStr = (m.nss > 0 ? '+' : '') + (m.nss ?? 0).toFixed(1);
      const nssColor = m.nss > 0 ? '#3FD47A' : m.nss < 0 ? '#FF6A3D' : '#8A94A1';
      const label = m.name.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      marker.bindTooltip(
        `<div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:11px;line-height:1.3;">
          <div style="font-weight:700;color:#E6ECF3;margin-bottom:2px;">${label}</div>
          <div style="color:#8A94A1;">${m.region}</div>
          <div style="margin-top:4px;"><span style="color:#E6ECF3;font-weight:600;">${v.toLocaleString('es-PR')}</span> menciones</div>
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
    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }
  }, []);

  // If Leaflet hasn't loaded, show a lightweight placeholder (never the fake SVG).
  if (typeof window !== 'undefined' && !window.L) {
    return (
      <div style={{ height: 420, borderRadius: 8, background: 'var(--canvas-2)', border: '1px solid var(--hairline)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: 12 }}>
        Cargando mapa…
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{
        height: 420,
        borderRadius: 8,
        overflow: 'hidden',
        border: '1px solid var(--hairline)',
        background: '#0E1620',
      }}
    />
  );
}

function PRMapLegacy({ municipalities, accessor, colorFn, onMunicipalityClick }) {
  const viewW = 900, viewH = 400;
  // Zoom state (1 = fit, 2 = 2x, etc). Max 4x. Scale anchored to center of viewport.
  const [zoom, setZoom] = React.useState(1);
  const [layers, setLayers] = React.useState({ munis: true, roads: true, rural: false });
  const zoomedViewW = viewW / zoom;
  const zoomedViewH = viewH / zoom;
  const zoomX = (viewW - zoomedViewW) / 2;
  const zoomY = (viewH - zoomedViewH) / 2;

  // More realistic PR outline (coast polygon — hand-traced into this aspect)
  const prPath = "M 60 180 L 75 172 L 95 168 L 115 170 L 140 165 L 165 160 L 195 158 L 225 155 L 260 152 L 295 150 L 330 148 L 365 150 L 400 152 L 440 155 L 480 160 L 520 165 L 560 170 L 600 175 L 640 180 L 680 185 L 720 192 L 755 200 L 780 210 L 795 225 L 800 245 L 790 262 L 770 275 L 740 285 L 700 292 L 660 296 L 615 298 L 565 298 L 515 296 L 465 294 L 415 292 L 365 290 L 315 288 L 270 285 L 225 280 L 185 274 L 148 266 L 115 256 L 88 244 L 70 228 L 58 210 L 55 195 Z";

  // Municipality positions in this coord space (approx geographic layout)
  const positions = {
    'aguadilla':   [95, 200],
    'mayaguez':    [105, 250],
    'arecibo':     [340, 195],
    'bayamon':     [555, 195],
    'guaynabo':    [580, 200],
    'san-juan':    [615, 190],
    'carolina':    [660, 195],
    'humacao':     [745, 235],
    'caguas':      [595, 240],
    'ponce':       [425, 275],
  };

  const max = Math.max(...municipalities.map(accessor));

  // Tile grid (fake raster)
  const tileSize = 50;
  const cols = Math.ceil(viewW / tileSize);
  const rows = Math.ceil(viewH / tileSize);

  // Fake road network
  const roads = [
    "M 55 195 L 200 192 L 340 195 L 480 195 L 615 190 L 745 230",
    "M 615 190 L 600 240 L 595 260 L 550 280 L 500 285 L 425 275 L 350 275 L 280 272 L 200 250 L 140 240",
    "M 95 200 L 115 230 L 105 250",
    "M 340 195 L 360 230 L 425 275",
    "M 615 190 L 660 195 L 745 235",
  ];

  return (
    <div style={{ position: 'relative', borderRadius: 4, overflow: 'hidden', border: '1px solid var(--hairline-strong)' }}>
      <svg viewBox={`${zoomX} ${zoomY} ${zoomedViewW} ${zoomedViewH}`} width="100%" style={{ display: 'block', background: '#DCE6EC', transition: 'all 0.2s var(--ease)' }}>
        <defs>
          <pattern id="tile-grid" width={tileSize} height={tileSize} patternUnits="userSpaceOnUse">
            <rect width={tileSize} height={tileSize} fill="none" />
            <path d={`M ${tileSize} 0 L 0 0 0 ${tileSize}`} fill="none" stroke="rgba(90,110,125,0.08)" strokeWidth="1" />
          </pattern>
          <pattern id="water-dots" width="4" height="4" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="0.5" fill="rgba(120,150,170,0.25)" />
          </pattern>
          <filter id="map-shadow" x="-5%" y="-5%" width="110%" height="110%">
            <feGaussianBlur stdDeviation="1.5" />
          </filter>
        </defs>

        {/* Ocean base */}
        <rect width={viewW} height={viewH} fill="#DCE6EC" />
        <rect width={viewW} height={viewH} fill="url(#water-dots)" />
        <rect width={viewW} height={viewH} fill="url(#tile-grid)" />

        {/* Land shadow */}
        <path d={prPath} fill="rgba(0,0,0,0.12)" transform="translate(0,3)" filter="url(#map-shadow)" />
        {/* Land */}
        <path d={prPath} fill="#F2EDE3" stroke="#C4B896" strokeWidth="1" />

        {/* Parks / shaded regions — rural areas layer */}
        {layers.rural && <>
          <ellipse cx="380" cy="235" rx="80" ry="25" fill="#D8E2C8" opacity="0.7" />
          <ellipse cx="520" cy="245" rx="55" ry="18" fill="#D8E2C8" opacity="0.7" />
        </>}

        {/* Small islands (Vieques, Culebra) */}
        <ellipse cx="820" cy="260" rx="30" ry="9" fill="#F2EDE3" stroke="#C4B896" strokeWidth="1" />
        <ellipse cx="855" cy="240" rx="14" ry="5" fill="#F2EDE3" stroke="#C4B896" strokeWidth="1" />
        <text x="820" y="278" fontSize="8" textAnchor="middle" fill="#7A6F55" fontStyle="italic">Vieques</text>
        <text x="855" y="232" fontSize="7" textAnchor="middle" fill="#7A6F55" fontStyle="italic">Culebra</text>

        {/* Roads */}
        {layers.roads && roads.map((d, i) => (
          <path key={i} d={d} fill="none" stroke="#FFFFFF" strokeWidth="2.5" opacity="0.8" />
        ))}
        {layers.roads && roads.map((d, i) => (
          <path key={'r'+i} d={d} fill="none" stroke="#E8B84A" strokeWidth="0.8" opacity="0.6" />
        ))}

        {/* Municipality bubbles */}
        {layers.munis && municipalities.map((m) => {
          const p = positions[m.slug];
          if (!p) return null;
          const v = accessor(m);
          const r = 8 + (v / max) * 26;
          const color = colorFn(m);
          const clickable = !!onMunicipalityClick;
          return (
            <g key={m.slug}
              onClick={clickable ? () => onMunicipalityClick(m) : undefined}
              style={{ cursor: clickable ? 'pointer' : 'default' }}>
              <circle cx={p[0]} cy={p[1]} r={r + 4} fill={color} opacity="0.12" />
              <circle cx={p[0]} cy={p[1]} r={r} fill={color} opacity="0.35" stroke={color} strokeWidth="1.5" />
              <circle cx={p[0]} cy={p[1]} r={Math.max(3, r * 0.35)} fill={color} />
              {/* Larger transparent hit target */}
              <circle cx={p[0]} cy={p[1]} r={Math.max(r + 6, 18)} fill="transparent" />
              <text x={p[0]} y={p[1] - r - 6} fontSize="11" textAnchor="middle" fill="#1a1a1a" fontWeight="600" style={{ paintOrder: 'stroke', stroke: '#FFFFFF', strokeWidth: 3, pointerEvents: 'none' }}>{m.name}</text>
              <text x={p[0]} y={p[1] + 3} fontSize="10" textAnchor="middle" fill="#FFFFFF" fontWeight="700" fontFamily="var(--ff-numeric)" style={{ paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.4)', strokeWidth: 2, pointerEvents: 'none' }}>{v > 999 ? (v/1000).toFixed(1) + 'K' : v}</text>
            </g>
          );
        })}

        {/* Graticule labels */}
        <text x="20" y="15" fontSize="9" fill="#7A6F55" fontFamily="var(--ff-numeric)">18.5°N</text>
        <text x="20" y={viewH - 6} fontSize="9" fill="#7A6F55" fontFamily="var(--ff-numeric)">17.9°N</text>
        <text x={viewW - 60} y="15" fontSize="9" fill="#7A6F55" fontFamily="var(--ff-numeric)">65.6°W</text>
      </svg>

      {/* Map chrome overlay */}
      <div style={{ position: 'absolute', top: 10, left: 10, display: 'flex', flexDirection: 'column', border: '1px solid rgba(0,0,0,0.2)', borderRadius: 3, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.2)' }}>
        <button onClick={() => setZoom((z) => Math.min(4, z * 1.4))}
          style={{ width: 28, height: 28, background: '#fff', border: 'none', borderBottom: '1px solid rgba(0,0,0,0.1)', cursor: 'pointer', fontSize: 18, lineHeight: 1, color: '#333' }}>+</button>
        <button onClick={() => setZoom((z) => Math.max(1, z / 1.4))}
          style={{ width: 28, height: 28, background: '#fff', border: 'none', cursor: 'pointer', fontSize: 18, lineHeight: 1, color: '#333' }}>−</button>
      </div>

      {/* Scale bar */}
      <div style={{ position: 'absolute', bottom: 10, left: 10, background: 'rgba(255,255,255,0.85)', padding: '3px 8px', fontSize: 10, color: '#333', fontFamily: 'var(--ff-numeric)', display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ width: 60, height: 6, borderLeft: '1px solid #333', borderRight: '1px solid #333', borderBottom: '1px solid #333' }} />
        50 km
      </div>

      {/* Attribution */}
      <div style={{ position: 'absolute', bottom: 0, right: 0, background: 'rgba(255,255,255,0.75)', padding: '2px 6px', fontSize: 9, color: '#555' }}>
        © Eco Intel · Base map tiles
      </div>

      {/* Layer toggle */}
      <div style={{ position: 'absolute', top: 10, right: 10, background: 'rgba(255,255,255,0.95)', border: '1px solid rgba(0,0,0,0.15)', padding: '6px 10px', fontSize: 10, display: 'flex', flexDirection: 'column', gap: 3, boxShadow: '0 1px 4px rgba(0,0,0,0.15)' }}>
        <div style={{ fontWeight: 600, marginBottom: 2, color: '#333' }}>Capas</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#444' }}>
          <input type="checkbox" checked={layers.munis} onChange={(e) => setLayers((l) => ({ ...l, munis: e.target.checked }))} style={{ margin: 0 }} /> Municipios
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#444' }}>
          <input type="checkbox" checked={layers.roads} onChange={(e) => setLayers((l) => ({ ...l, roads: e.target.checked }))} style={{ margin: 0 }} /> Carreteras
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#888' }}>
          <input type="checkbox" checked={layers.rural} onChange={(e) => setLayers((l) => ({ ...l, rural: e.target.checked }))} style={{ margin: 0 }} /> Áreas rurales
        </label>
      </div>
    </div>
  );
}

window.ECO_CHARTS = {
  Sparkline, AreaLineChart, MultiLineChart, StackedAreaChart,
  Donut, HBarList, RadialGauge, Heatmap, PRMap
};
