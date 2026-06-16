// Dashboard + screens
const { Sparkline, AreaLineChart, MultiLineChart, StackedAreaChart, Donut, HBarList, RadialGauge, Heatmap, PRMap } = window.ECO_CHARTS;
const { MentionDrawer, MentionsSliceModal, MetricInsightModal } = window.ECO_SHELL;
const D = window.ECO_DATA;
const I2 = window.Icons;

function KpiCard({ label, value, delta, sub, icon, trendData, accent = 'var(--accent)', tone, highlight, invertDelta, children, onClick }) {
  const IconC = icon ? I2[icon] : null;
  const deltaColor = delta == null ? 'var(--text-3)' : (invertDelta ? (delta < 0 ? 'var(--pos)' : 'var(--neg)') : (delta > 0 ? 'var(--pos)' : delta < 0 ? 'var(--neg)' : 'var(--text-3)'));
  const clickable = !!onClick;
  return (
    <div
      className="card"
      onClick={clickable ? onClick : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      style={{
        padding: 18, position: 'relative', overflow: 'hidden',
        borderTop: highlight ? `2px solid ${accent}` : undefined,
        cursor: clickable ? 'pointer' : 'default',
        transition: 'transform 0.12s var(--ease), box-shadow 0.12s var(--ease)',
      }}
      onMouseEnter={clickable ? (e) => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 6px 18px rgba(0,0,0,0.18)'; } : undefined}
      onMouseLeave={clickable ? (e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = ''; } : undefined}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        {IconC && <div style={{ width: 26, height: 26, borderRadius: 6, background: 'var(--accent-fill)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: accent }}><IconC size={14} color={accent} /></div>}
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
        {tone && <span className={`pill pill-${tone}`} style={{ marginLeft: 'auto' }}>{tone === 'neg' ? 'Alerta' : tone === 'warn' ? 'Elevado' : 'Normal'}</span>}
        {clickable && !tone && (
          <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 9, color: 'var(--text-3)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            <I2.Sparkles size={10} /> Detalles
          </span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <div className="num" style={{ fontSize: 34, fontWeight: 600, color: 'var(--text)', lineHeight: 1, fontFamily: 'var(--ff-display)' }}>{value}</div>
        {delta != null && (
          <div style={{ fontSize: 12, fontWeight: 600, color: deltaColor, display: 'flex', alignItems: 'center', gap: 2 }}>
            {delta > 0 ? <I2.ArrowUp size={11} /> : delta < 0 ? <I2.ArrowDown size={11} /> : null}
            {Math.abs(delta)}{typeof delta === 'number' && Number.isInteger(Math.abs(delta) * 10) ? '' : ''}
            {sub ? ` ${sub}` : ''}
          </div>
        )}
      </div>
      {trendData && <div style={{ marginTop: 10 }}><Sparkline data={trendData} width={200} height={30} color={accent} /></div>}
      {children && <div style={{ marginTop: 10 }}>{children}</div>}
    </div>
  );
}

function fmt(n) {
  if (n == null) return '—';
  if (Math.abs(n) >= 1_000_000) return (n/1_000_000).toFixed(1)+'M';
  if (Math.abs(n) >= 1_000) return (n/1_000).toFixed(1)+'K';
  return n.toLocaleString('es-PR');
}

/**
 * Helper compartido para abrir un MetricInsightModal desde cualquier pantalla.
 * Construye el slice inicial con headlineValue + subcomponents + skeleton de
 * insight, lo aplica vía setSlice, y dispara un fetch (con polling) al
 * endpoint /api/eco-metric-insight. Al llegar la respuesta actualiza el slice
 * con el texto del insight.
 *
 * @param {Function} setSlice — el setter del state local de cada screen.
 * @param {Object} opts — { metric, value, accent, label, periodStart?, periodEnd?, periodPreset?, agency, subcomponents, filter }
 */
function openMetricInsightShared(setSlice, opts) {
  const headlineValue = opts.value != null && opts.value !== '' ? String(opts.value) : '—';
  setSlice({
    eyebrow: opts.label,
    title: `${opts.label}${opts.periodLabel ? ' · ' + opts.periodLabel : ''}`,
    accent: opts.accent || 'var(--accent)',
    headlineValue,
    headlineLabel: opts.label,
    subcomponents: opts.subcomponents || [],
    insightText: '__loading__',
    mentions: [],
    _filter: opts.filter || {},
  });

  const params = new URLSearchParams({ metric: opts.metric });
  if (opts.periodStart && opts.periodEnd) {
    params.set('from', opts.periodStart);
    params.set('to', opts.periodEnd);
  } else if (opts.periodPreset) {
    params.set('period', opts.periodPreset);
  }
  if (opts.agency) params.set('agency', opts.agency);

  const startedAt = Date.now();
  const MAX_POLL_MS = 90 * 1000;
  const POLL_MS = 3000;

  async function tick() {
    try {
      const res = await fetch('/api/eco-metric-insight?' + params.toString(), {
        credentials: 'same-origin', cache: 'no-store',
      });
      if (res.status === 202) {
        if (Date.now() - startedAt > MAX_POLL_MS) {
          setSlice((s) => s ? { ...s, insightText: 'Insight no disponible (timeout).' } : s);
          return;
        }
        setTimeout(tick, POLL_MS);
        return;
      }
      if (!res.ok) {
        setSlice((s) => s ? { ...s, insightText: 'No se pudo cargar el insight.' } : s);
        return;
      }
      const json = await res.json();
      setSlice((s) => s ? { ...s, insightText: json.insight || 'Sin insight disponible.' } : s);
    } catch (_) {
      setSlice((s) => s ? { ...s, insightText: 'Error de red al cargar el insight.' } : s);
    }
  }
  tick();
}

// Sanitiza HTML del briefing IA — solo permite <strong>/</strong>. El lambda
// que genera el briefing ya hace este filtro server-side; esta función es
// defensa en profundidad por si una fila vieja escapó el filtro o si en el
// futuro se llena la tabla por otra vía.
function sanitizeBriefingHtml(html) {
  if (!html) return '';
  return String(html).replace(/<(?!\/?strong\b)[^>]*>/gi, '');
}

// =============== DASHBOARD ===============
function DashboardScreen({ onMentionClick, period, setPeriod, setActive, agency }) {
  const m = D.CURRENT_METRICS;
  // Default: solo "Menciones" (issue #6). El usuario puede sumar series con
  // los chips, máx 3 a la vez.
  const [activeMetrics, setActiveMetrics] = useState(['totalMentions']);
  // Modo del Resumen ejecutivo: signal | emerging | crisis. El backend
  // devuelve D.BRIEFING como objeto con esas 3 claves.
  const [focus, setFocus] = useState('signal');
  const [slice, setSlice] = useState(null);
  const [metricModal, setMetricModal] = useState(null);

  // Resumen ejecutivo activo según `focus`. Si el backend solo devolvió el
  // shape antiguo (un solo briefing), fallback a él para no romper la UI.
  const briefingByMode = (D.BRIEFING && typeof D.BRIEFING === 'object' && D.BRIEFING.signal !== undefined)
    ? D.BRIEFING
    : null;
  const activeBriefing = briefingByMode
    ? (briefingByMode[focus] || briefingByMode.signal || null)
    : D.BRIEFING;

  // Helper para clicks en KPIs del Scorecard. Usa el period preset (no
  // periodStart/periodEnd) porque DashboardScreen consume /api/eco-data que
  // no expone esos campos; el endpoint /api/eco-metric-insight resolverá la
  // ventana con closedWindowYmdInTZ del period preset.
  function openKpiInsight(metric, value, accent) {
    const labels = {
      crisis: 'Riesgo de crisis',
      polarization: 'Polarización',
      nss: 'Net Sentiment Score',
      bhi: 'Brand Health',
      volume: 'Volumen',
    };
    const filter = metric === 'crisis' ? { sentiment: 'negativo', pertinence: 'alta' }
      : metric === 'nss' ? { sentiment: 'negativo' }
      : metric === 'polarization' ? {}
      : {};
    openMetricInsightShared(setSlice, {
      metric, value, accent,
      label: labels[metric] || metric,
      periodPreset: period || '7D',
      agency,
      subcomponents: [],
      filter,
    });
  }

  const seriesConfig = [
    { key: 'nss', label: 'NSS', color: 'var(--accent)' },
    { key: 'brandHealthIndex', label: 'Brand Health', color: 'var(--pos)' },
    { key: 'totalMentions', label: 'Menciones', color: 'var(--text-2)' },
    { key: 'crisisRiskScore', label: 'Crisis', color: 'var(--neg)' },
    { key: 'polarizationIndex', label: 'Polarización', color: '#8B5CF6' },
    { key: 'engagementRate', label: 'Engagement', color: 'var(--warn)' },
  ];

  function openTimelineDaySlice(d, idx) {
    const total = Math.round((d.totalMentions || d.positivo + d.neutral + d.negativo) || 0);
    const bias = d.negativo > d.positivo ? 'negativo' : d.positivo > d.negativo ? 'positivo' : 'neutral';
    const accent = bias === 'negativo' ? 'var(--neg)' : bias === 'positivo' ? 'var(--pos)' : 'var(--accent)';
    const hours = Array.from({ length: 24 }, (_, h) => {
      const base = Math.sin((h - 10) / 24 * Math.PI) * 0.5 + 0.5;
      return Math.round(base * (total / 24) * 1.6);
    });
    const dayIso = d.fullDate ? d.fullDate.slice(0, 10) : undefined;
    setSlice({
      eyebrow: d.date,
      title: `NSS ${d.nss > 0 ? '+' : ''}${(d.nss ?? 0).toFixed(1)}`,
      accent, volume: total,
      sentiment: { pos: d.positivo || 0, neu: d.neutral || 0, neg: d.negativo || 0 },
      histogram: { label: 'Volumen por hora', values: hours, xLabels: Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2,'0')}:00`) },
      mentions: [],
      _filter: { day: dayIso },
    });
  }

  function openSourceSlice(src) {
    const key = src.key;
    const colors = { facebook: '#0A7EA4', twitter: 'var(--accent)', news: 'var(--pos)', instagram: '#8B5CF6', youtube: 'var(--neg)', blog: 'var(--warn)' };
    setSlice({
      eyebrow: 'Fuente',
      title: src.label,
      accent: colors[key] || 'var(--accent)',
      mentions: [],
      _filter: { source: key },
    });
  }

  function openHeatmapSlice(cell) {
    setSlice({
      eyebrow: `${cell.dayLabel} · ${String(cell.hour).padStart(2,'0')}:00 – ${String(cell.hour).padStart(2,'0')}:59`,
      title: 'Franja horaria',
      accent: 'var(--accent)',
      mentions: [],
      _filter: { dow: cell.day, hour: cell.hour },
    });
  }

  function openTopicSlice(t) {
    const palette = ['#E1767B', '#4A7FB5', '#6B9E7F', '#C08457', '#8B6BB0', '#D4A73E', '#5A9FA8', '#A3624D'];
    const slugIdx = {};
    D.TOPICS.forEach((tp, i) => { slugIdx[tp.slug] = i; });
    const accent = palette[slugIdx[t.slug] % palette.length] || 'var(--accent)';
    setSlice({
      eyebrow: 'Tópico',
      title: t.name,
      accent,
      mentions: [],
      _filter: { topic: t.slug },
    });
  }

  function openBriefingSlice() {
    // Hero CTA opens the mention slice for the actual dominant topic reported
    // by the active briefing mode (falls back to the first topic by volume).
    const briefingTopicName = (activeBriefing && activeBriefing.dominantSignal || '').split(' · ')[0];
    const topic = (briefingTopicName && D.TOPICS.find(t => t.name === briefingTopicName)) || D.TOPICS[0];
    if (topic) openTopicSlice(topic);
  }

  function openMetric(key, label, accent) {
    let value = null;
    if (m) {
      if (key === 'crisis') value = m.crisisRiskScore;
      else if (key === 'volume') value = m.totalMentions;
      // BHI: el cálculo interno es 0-1 pero la UI presenta 1-10 (1=crítico,
      // 10=fuerte). Pre-convertimos el placeholder para que el modal hable
      // SIEMPRE en la misma escala — antes el headline saltaba de "0.6"
      // (mientras cargaba el fetch) a "59.5" (después, por una segunda
      // multiplicación errónea contra el valor ya escalado del API).
      else if (key === 'bhi') value = m.brandHealthIndex != null
        ? Number((1 + m.brandHealthIndex * 9).toFixed(1))
        : null;
      else if (key === 'polarization') value = m.polarizationIndex;
      else value = m.nss;
    }
    setMetricModal({ metricKey: key, value, label, accent });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ── Executive Briefing (3 modos: signal | emerging | crisis) ── */}
      <div className="card" style={{ padding: 20, display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 24, alignItems: 'stretch' }}>
        <div>
          <div className="section-eyebrow" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span>Resumen ejecutivo · {(activeBriefing && activeBriefing.eyebrow) || new Date().toLocaleDateString('es-PR', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
            {activeBriefing && activeBriefing.source === 'ai' && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 9, fontWeight: 700, color: 'var(--accent)', background: 'var(--accent-fill)', padding: '2px 6px', borderRadius: 4, letterSpacing: '0.05em' }}>
                <Icons.Sparkles size={9} /> IA · {activeBriefing.generatedAtLabel || 'reciente'}
              </span>
            )}
            {activeBriefing && activeBriefing.source === 'rule' && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 9, fontWeight: 700, color: 'var(--text-3)', background: 'var(--canvas-2)', padding: '2px 6px', borderRadius: 4, letterSpacing: '0.05em' }}>
                Resumen automatizado
              </span>
            )}
          </div>
          {/* Fuente reducida a 18px y line-height 1.45 (issue #1). Narrativas
              cap a 75 palabras desde el prompt. */}
          <div style={{ fontFamily: 'var(--ff-display)', fontSize: 18, fontWeight: 500, lineHeight: 1.45, letterSpacing: 'var(--letter-display)', marginTop: 10, color: 'var(--text)' }}>
            {activeBriefing ? (
              <span dangerouslySetInnerHTML={{ __html: sanitizeBriefingHtml(activeBriefing.narrativeHtml || '') }} />
            ) : (
              <>Sin suficientes menciones en este período para generar un resumen.</>
            )}
          </div>
          <div style={{ display: 'flex', gap: 20, marginTop: 16, fontSize: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ color: 'var(--text-3)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>Señal dominante</div>
              <div style={{ color: 'var(--text)', fontWeight: 600, marginTop: 2 }}>{(activeBriefing && activeBriefing.dominantSignal) || '—'}</div>
            </div>
            <div>
              <div style={{ color: 'var(--text-3)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>Alcance del período</div>
              <div className="num" style={{ color: 'var(--text)', fontWeight: 600, marginTop: 2 }}>{(activeBriefing && activeBriefing.reachLabel) || (m?.totalReach ? fmt(m.totalReach) + ' impresiones' : '—')}</div>
            </div>
            <div>
              <div style={{ color: 'var(--text-3)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>Siguiente paso</div>
              <div style={{ color: `var(--${activeBriefing && activeBriefing.actionTone === 'neg' ? 'neg' : activeBriefing && activeBriefing.actionTone === 'pos' ? 'pos' : activeBriefing && activeBriefing.actionTone === 'warn' ? 'warn' : 'accent'})`, fontWeight: 600, marginTop: 2 }}>{(activeBriefing && activeBriefing.action) || 'Explorar tópicos activos →'}</div>
            </div>
          </div>
          <div style={{ marginTop: 18, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn btn-primary" onClick={openBriefingSlice} style={{ fontSize: 12 }}>
              <Icons.Eye size={13} /> Ver menciones
            </button>
            <span style={{ width: 1, height: 16, background: 'var(--hairline)', margin: '0 4px' }} />
            <button className={`chip ${focus === 'signal' ? 'active' : ''}`} onClick={() => setFocus('signal')}>Señal del día</button>
            <button className={`chip ${focus === 'emerging' ? 'active' : ''}`} onClick={() => setFocus('emerging')}>Narrativas emergentes</button>
            <button className={`chip ${focus === 'crisis' ? 'active' : ''}`} onClick={() => setFocus('crisis')}>Vigilancia de crisis</button>
          </div>
        </div>
        <div style={{ borderLeft: '1px solid var(--hairline)', paddingLeft: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Pulso en vivo · últimas menciones</div>
          {(D.PULSE || []).map((e, i) => (
            <button key={i} onClick={() => e.mention && onMentionClick(e.mention)}
              style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 12, background: 'transparent', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer' }}
              className="row-hover">
              <span className="mono" style={{ color: 'var(--text-3)', fontSize: 10, marginTop: 2, width: 54, flexShrink: 0 }}>{e.time}</span>
              <span className="dot" style={{ background: `var(--${e.dot})`, marginTop: 5, flexShrink: 0 }} />
              <span style={{ flex: 1, color: 'var(--text)' }}>{e.text}</span>
              <span className="num" style={{ color: 'var(--text-3)', fontSize: 11 }}>{e.eng}</span>
            </button>
          ))}
          {!(D.PULSE && D.PULSE.length > 0) && (
            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Sin actividad reciente en el período.</div>
          )}
        </div>
      </div>

      {/* ── Hero KPIs: NSS + Crisis prominent. Click → modal con serie temporal e insight AI. ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1.3fr 1fr 1fr 1fr', gap: 12 }}>
        <KpiCard label="Net Sentiment Score" value={m.nss != null ? `${m.nss > 0 ? '+' : ''}${m.nss}` : '—'} delta={m.nssDelta} sub="vs 30d ant." icon="Activity" accent="var(--accent)" highlight trendData={D.TIMELINE.map(t => t.nss)}
          onClick={() => openMetric('nss', 'Net Sentiment Score', 'var(--accent)')}>
          <div style={{ display: 'flex', gap: 16, fontSize: 10, color: 'var(--text-3)', marginTop: -4 }}>
            <span>7d <strong className="num" style={{ color: 'var(--text-2)' }}>{m.nss7d != null ? (m.nss7d > 0 ? '+' : '') + m.nss7d : '—'}</strong></span>
            <span>30d <strong className="num" style={{ color: 'var(--text-2)' }}>{m.nss30d != null ? (m.nss30d > 0 ? '+' : '') + m.nss30d : '—'}</strong></span>
          </div>
        </KpiCard>
        <KpiCard label="Riesgo de crisis" value={m.crisisRiskScore != null ? m.crisisRiskScore.toFixed(2) : '—'} delta={m.crisisDelta} sub="rango 0–1" icon="Shield" accent="var(--neg)" tone="neg" invertDelta highlight
          onClick={() => openMetric('crisis', 'Riesgo de crisis', 'var(--neg)')}>
          {/* Escala 0–1: gate condicional → 0; >0.25 elevado; >0.40 alerta; >0.60 crisis. Umbrales del backtest 482 días. */}
          <div style={{ marginTop: -2 }}>
            <div style={{ height: 6, borderRadius: 3, background: 'linear-gradient(90deg, var(--pos) 0%, var(--pos) 25%, var(--warn) 25%, var(--warn) 60%, var(--neg) 60%, var(--neg) 100%)', position: 'relative' }}>
              <div style={{ position: 'absolute', left: `${Math.min(((m.crisisRiskScore ?? 0))*100, 100)}%`, top: -3, width: 12, height: 12, borderRadius: '50%', background: 'var(--canvas)', border: '2px solid var(--neg)', transform: 'translateX(-50%)' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--text-3)', marginTop: 4, fontFamily: 'var(--ff-mono)' }}>
              <span>NORMAL</span><span>ELEVADO</span><span>ALERTA</span><span>CRISIS</span>
            </div>
          </div>
        </KpiCard>
        <KpiCard label="Volumen · período" value={fmt(D.TIMELINE.reduce((s, t) => s + (t.totalMentions || 0), 0))} delta={m.totalMentionsDelta} sub="% vs ventana ant." icon="MessageSquare" accent="var(--text-2)" trendData={D.TIMELINE.map(t => t.totalMentions)}
          onClick={() => openMetric('volume', 'Volumen de menciones', 'var(--text-2)')} />
        {/* Brand Health en escala 1–10 (display): cálculo interno sigue siendo
            0–1 (backtest 482d). UI maps display = 1 + valor*9 para que 1 = crítico
            y 10 = fuerte. Bandas semánticas: 1–4 crítico, 4–6 débil, 6–8 sano, 8–10 fuerte. */}
        <KpiCard label="Brand Health" value={m.brandHealthIndex != null ? (1 + m.brandHealthIndex * 9).toFixed(1) : '—'} delta={m.brandHealthDelta != null ? Number((m.brandHealthDelta * 9).toFixed(1)) : null} sub="escala 1–10" icon="Heart" accent="var(--pos)"
          onClick={() => openMetric('bhi', 'Brand Health Index', 'var(--pos)')}>
          <BrandHealthMini value={m.brandHealthIndex ?? 0} />
        </KpiCard>
        {/* Polarization Index: distingue polarización (50/50 pos vs neg) de apatía (todo neutral) cuando NSS≈0.
            Solo es útil leído junto con NSS — alta polarización + NSS bajo = crisis emergente. */}
        <KpiCard label="Polarización" value={m.polarizationIndex != null ? `${m.polarizationIndex.toFixed(0)}%` : '—'} sub="opinión vs neutral" icon="Polarization" accent="#8B5CF6" trendData={D.TIMELINE.map(t => t.polarizationIndex ?? 0)}
          onClick={() => openMetric('polarization', 'Polarización', '#8B5CF6')}>

          <div style={{ marginTop: -2 }}>
            <div style={{ height: 6, borderRadius: 3, background: 'linear-gradient(90deg, var(--text-3) 0%, var(--text-3) 30%, var(--warn) 30%, var(--warn) 60%, #8B5CF6 60%, #8B5CF6 100%)', position: 'relative' }}>
              <div style={{ position: 'absolute', left: `${Math.min(Math.max(m.polarizationIndex ?? 0, 0), 100)}%`, top: -3, width: 12, height: 12, borderRadius: '50%', background: 'var(--canvas)', border: '2px solid #8B5CF6', transform: 'translateX(-50%)' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--text-3)', marginTop: 4, fontFamily: 'var(--ff-mono)' }}>
              <span>APÁTICA</span><span>MODERADA</span><span>ALTA</span><span>EXTREMA</span>
            </div>
          </div>
        </KpiCard>
      </div>

      {/* ── Row 2: Timeline ocupa todo el ancho (issue #5 eliminó pie de sentimiento) ── */}
      <div className="card">
        <div className="card-hd">
          <div>
            <div className="card-hd-title">Evolución multi-métrica</div>
            <div className="card-hd-sub">Selecciona hasta 3 series · pasa el cursor para ver valores</div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {seriesConfig.map((s) => {
              const on = activeMetrics.includes(s.key);
              return (
                <button key={s.key} onClick={() => {
                  if (on) setActiveMetrics(activeMetrics.filter(k => k !== s.key));
                  else if (activeMetrics.length < 3) setActiveMetrics([...activeMetrics, s.key]);
                }} style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '4px 9px', borderRadius: 999,
                  fontSize: 10, fontWeight: 600,
                  border: `1px solid ${on ? s.color : 'var(--hairline)'}`,
                  background: on ? s.color : 'transparent',
                  color: on ? '#fff' : 'var(--text-3)',
                }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: on ? '#fff' : s.color }} />
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="card-bd">
          {/* Issue #6: sin selector de timeframe local — el header global lo cubre. */}
          <MultiLineChart data={D.TIMELINE} series={seriesConfig.filter(s => activeMetrics.includes(s.key))} height={240} onPointClick={openTimelineDaySlice} />
        </div>
      </div>

      {/* ── Row 3: Topics (emerging) + Sources + Heatmap ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: 12 }}>
        <div className="card">
          <div className="card-hd">
            <div><div className="card-hd-title">Tópicos emergentes</div><div className="card-hd-sub">Ordenados por crecimiento</div></div>
            <button className="chip" onClick={() => setActive && setActive('topics')}>Ver todo</button>
          </div>
          <div className="card-bd" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {D.TOPICS.slice(0, 5).map((t) => (
              <div key={t.slug} onClick={() => openTopicSlice(t)} className="row-hover" style={{ padding: '8px 10px', marginInline: -10, borderRadius: 6, cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                  <div style={{ flex: 1, fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{t.name}</div>
                  <span className="num" style={{ fontSize: 12, fontWeight: 600 }}>{fmt(t.count)}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: t.delta > 0 ? 'var(--neg)' : 'var(--pos)', minWidth: 40, textAlign: 'right' }}>
                    {t.delta > 0 ? '+' : ''}{t.delta}%
                  </span>
                </div>
                <div style={{ display: 'flex', height: 4, borderRadius: 2, overflow: 'hidden', background: 'var(--canvas-2)' }}>
                  <div style={{ width: `${t.positivePct}%`, background: 'var(--pos)' }} />
                  <div style={{ width: `${t.neutralPct}%`, background: 'var(--text-3)' }} />
                  <div style={{ width: `${t.negativePct}%`, background: 'var(--neg)' }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-hd"><div><div className="card-hd-title">Fuentes top</div><div className="card-hd-sub">Por volumen · 30d</div></div></div>
          <div className="card-bd">
            <HBarList
              items={D.TOP_SOURCES.map(s => ({ label: s.source, value: s.count, key: s.key }))}
              colorFn={(it) => ({ facebook: '#0A7EA4', twitter: 'var(--accent)', news: 'var(--pos)', instagram: '#8B5CF6', youtube: 'var(--neg)', blog: 'var(--warn)' })[it.key] || 'var(--accent)'}
              onItemClick={openSourceSlice}
            />
          </div>
        </div>

        <HourActivityCard onCellClick={openHeatmapSlice} />
      </div>

      {slice && <MentionsSliceModal slice={slice} onClose={() => setSlice(null)} onMentionClick={onMentionClick} />}
      {metricModal && MetricInsightModal && (
        <MetricInsightModal
          metricKey={metricModal.metricKey}
          value={metricModal.value}
          label={metricModal.label}
          accent={metricModal.accent}
          period={period}
          agency={(window.ECO_DATA && window.ECO_DATA.USER_AGENCY_SLUG) || (localStorage.getItem('eco.agency') || '')}
          onClose={() => setMetricModal(null)}
        />
      )}

      {/* ── Recent mentions table (dense) — issue #9: sin columna pertinencia,
          engagement=0 muestra "—". El backend ya excluye twitter y baja
          pertinencia del feed. ── */}
      <div className="card">
        <div className="card-hd">
          <div><div className="card-hd-title">Menciones destacadas</div><div className="card-hd-sub">Más recientes · sin twitter ni baja pertinencia</div></div>
          <a href="#mentions" className="link" style={{ fontSize: 12 }}>Ver todas ({fmt(m.totalMentions)}) →</a>
        </div>
        <div>
          {D.MENTIONS.slice(0, 7).map((mn, idx) => {
            const sourceIcon = { facebook: 'Facebook', twitter: 'Twitter', news: 'Newspaper', instagram: 'Instagram', youtube: 'Youtube' }[mn.source] || 'Globe';
            const SIcon = Icons[sourceIcon];
            const sc = mn.sentiment === 'positivo' ? 'pill-pos' : mn.sentiment === 'negativo' ? 'pill-neg' : mn.sentiment === 'neutral' ? 'pill-neu' : 'pill-unknown';
            return (
              <div key={mn.id} onClick={() => onMentionClick(mn)}
                className="row-hover"
                style={{
                  display: 'grid', gridTemplateColumns: '20px 2fr 130px 100px 100px', gap: 12,
                  alignItems: 'center', padding: '10px 16px',
                  borderTop: idx > 0 ? '1px solid var(--hairline)' : 'none',
                  fontSize: 12, cursor: 'pointer',
                }}>
                <SIcon size={14} color="var(--text-3)" />
                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <div style={{ color: 'var(--text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{mn.title}</div>
                  <div style={{ color: 'var(--text-3)', fontSize: 10 }}>{mn.author} · {mn.domain}</div>
                </div>
                <span className={`pill ${sc}`} style={{ justifySelf: 'start' }}>{mn.sentiment}</span>
                <span className="num" style={{ color: 'var(--text-2)', fontWeight: 600, textAlign: 'right' }}>{mn.engagement > 0 ? fmt(mn.engagement) : '—'}</span>
                <span style={{ color: 'var(--text-3)', fontSize: 11 }}>{mn.publishedAt}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// --- BrandHealthMini: gauge segmentado. Internamente trabaja con value 0..1
//     (output del backtest), pero el label de la banda y los hitos se muestran
//     en escala 1–10 para alinearse con la presentación del KpiCard.
//     Segmentos (valor interno): Crítico (0-.4), Débil (.4-.6), Sano (.6-.8), Fuerte (.8-1).
//     Equivalente en escala 1-10: 1-4.6, 4.6-6.4, 6.4-8.2, 8.2-10.
function BrandHealthMini({ value }) {
  const segments = [
    { from: 0, to: 0.4, color: 'var(--neg)' },
    { from: 0.4, to: 0.6, color: 'var(--warn)' },
    { from: 0.6, to: 0.8, color: 'var(--pos)' },
    { from: 0.8, to: 1, color: 'var(--accent)' },
  ];
  const bandLabel = value < 0.4 ? 'Crítico' : value < 0.6 ? 'Débil' : value < 0.8 ? 'Sano' : 'Fuerte';
  const bandColor = value < 0.4 ? 'var(--neg)' : value < 0.6 ? 'var(--warn)' : value < 0.8 ? 'var(--pos)' : 'var(--accent)';
  return (
    <div style={{ marginTop: -2 }}>
      <div style={{ display: 'flex', gap: 2, height: 8, borderRadius: 2, overflow: 'hidden' }}>
        {segments.map((s, i) => {
          const isActive = value >= s.from && value <= s.to;
          return (
            <div key={i} style={{
              flex: s.to - s.from,
              background: isActive ? s.color : `color-mix(in oklab, ${s.color} 18%, var(--canvas-2))`,
              position: 'relative',
            }}>
              {isActive && (
                <div style={{
                  position: 'absolute',
                  left: `${((value - s.from) / (s.to - s.from)) * 100}%`,
                  top: -2, bottom: -2, width: 2,
                  background: 'var(--text)', transform: 'translateX(-50%)',
                }} />
              )}
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 9, color: 'var(--text-3)', fontWeight: 600, fontFamily: 'var(--ff-mono)' }}>
        <span>1</span><span>4.6</span><span>6.4</span><span>8.2</span><span>10</span>
      </div>
      <div style={{ fontSize: 10, color: bandColor, fontWeight: 700, marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{bandLabel}</div>
    </div>
  );
}

// --- HourActivityCard: heatmap fed from window.ECO_DATA.HOUR_HEATMAP ---
function HourActivityCard({ onCellClick }) {
  const data = React.useMemo(() => {
    const remote = window.ECO_DATA && window.ECO_DATA.HOUR_HEATMAP;
    if (Array.isArray(remote) && remote.length === 7 * 24) return remote;
    // Fallback stub if backend hasn't populated it yet — flat, near-zero.
    return Array.from({ length: 7 * 24 }, () => 0);
  }, []);
  const max = Math.max(1, ...data);
  const peakIdx = data.indexOf(Math.max(...data));
  const peakDay = Math.floor(peakIdx / 24);
  const peakHour = peakIdx % 24;
  const dayLabels = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  const total = data.reduce((s, v) => s + v, 0);

  return (
    <div className="card">
      <div className="card-hd">
        <div>
          <div className="card-hd-title">Actividad por hora</div>
          <div className="card-hd-sub">Mapa de calor · {fmt(total)} menciones · click una franja</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--text-3)' }}>
          <span>menos</span>
          <div style={{ display: 'flex', gap: 1 }}>
            {[0.1, 0.3, 0.5, 0.7, 0.95].map((o, i) => (
              <div key={i} style={{ width: 8, height: 8, background: `rgba(11, 95, 128, ${o})`, borderRadius: 1 }} />
            ))}
          </div>
          <span>más</span>
        </div>
      </div>
      <div className="card-bd">
        <div style={{ fontSize: 11, color: 'var(--text-2)', marginBottom: 10, padding: '6px 10px', background: 'color-mix(in oklab, var(--accent) 6%, var(--canvas))', borderRadius: 4, borderLeft: '2px solid var(--accent)' }}>
          Pico de actividad: <strong>{dayLabels[peakDay]} a las {peakHour}:00</strong>
        </div>
        <Heatmap
          data={data}
          colorFn={(v) => {
            const intensity = max > 0 ? Math.min(1, v / max) : 0;
            return `rgba(255, 106, 61, ${0.08 + intensity * 0.85})`;
          }}
          cellSize={14}
          onCellClick={onCellClick}
        />
      </div>
    </div>
  );
}

// =============== MENTIONS ===============
// El feed de menciones ya NO filtra el array `D.MENTIONS` precargado.
// Hace fetch directo a `/api/eco-mentions` con paginación + búsqueda
// server-side para que los filtros funcionen sobre el universo completo y la
// paginación numerada navegue por TODAS las menciones del período, no solo
// las 20-50 que vienen en el cargue inicial del dashboard.
const PAGE_SIZE = 25;
const VIRAL_THRESHOLD = 5000;

// Opciones canónicas compartidas entre MentionsScreen y SearchScreen para que
// no diverjan dos listas copiadas a mano (la auditoría encontró duplicación).
const SOURCE_OPTIONS = [
  { v: 'all', l: 'Todas las fuentes' },
  { v: 'facebook', l: 'Facebook' },
  { v: 'twitter', l: 'X / Twitter' },
  { v: 'news', l: 'Noticias' },
  { v: 'instagram', l: 'Instagram' },
  { v: 'youtube', l: 'YouTube' },
];
const VIEW_MODES = [
  { k: 'list', l: 'Lista', icon: 'List' },
  { k: 'cards', l: 'Cards', icon: 'Grid' },
  { k: 'table', l: 'Tabla', icon: 'Table' },
];
// Orden respaldado por /api/eco-mentions (recent | engagement | relevance).
// 'relevance' requiere query; sin ella se resuelve a 'recent'. NO existe orden
// por 'sentiment' en la API — se eliminó de la UI porque era opción muerta.
const SORT_OPTIONS = [
  { k: 'relevance', l: 'Relevancia', needsQuery: true },
  { k: 'recent', l: 'Reciente' },
  { k: 'engagement', l: 'Engagement' },
];
// Resuelve el orden efectivo: 'relevance' sin query cae a 'recent', para que el
// control nunca marque una opción que la API ignora.
function resolveSort(sortBy, hasQuery) {
  if (sortBy === 'relevance' && !hasQuery) return 'recent';
  return sortBy || 'recent';
}

function SourceSelect({ value, onChange, style }) {
  return (
    <select className="input" value={value} onChange={onChange} style={style}>
      {SOURCE_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
    </select>
  );
}

function ViewToggle({ viewMode, setViewMode }) {
  return (
    <div style={{ display: 'flex', gap: 6, fontSize: 11 }}>
      {VIEW_MODES.map((o) => {
        const IC = Icons[o.icon] || Icons.List;
        return (
          <button key={o.k} onClick={() => setViewMode(o.k)} className={`chip ${viewMode === o.k ? 'active' : ''}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <IC size={11} /> {o.l}
          </button>
        );
      })}
    </div>
  );
}

// Control de orden compartido (chips). Deshabilita 'relevance' sin query y
// resalta el orden EFECTIVO. Se agrupa nowrap para que la etiqueta no se
// despegue de sus chips al hacer wrap.
function SortChips({ sortBy, setSortBy, hasQuery }) {
  const effective = resolveSort(sortBy, hasQuery);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'nowrap', marginLeft: 'auto' }}>
      <span className="section-eyebrow" style={{ margin: 0 }}>Ordenar</span>
      <div style={{ display: 'flex', gap: 4 }}>
        {SORT_OPTIONS.map((o) => {
          const disabled = o.needsQuery && !hasQuery;
          return (
            <button key={o.k} className={`chip ${effective === o.k ? 'active' : ''}`}
              onClick={() => { if (!disabled) setSortBy(o.k); }} disabled={disabled}
              style={disabled ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
              title={disabled ? 'Requiere un término de búsqueda' : undefined}>
              {o.l}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MentionsScreen({ onMentionClick }) {
  // Estado de filtros (server-side). `q` se sincroniza con `queryInput` con
  // debounce de 300ms para evitar un fetch por cada tecla.
  const [queryInput, setQueryInput] = useState('');
  const [filters, setFilters] = useState({
    q: '', sentiment: 'all', source: 'all', topic: '', region: '', sortBy: 'recent',
  });
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ mentions: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [viralCount, setViralCount] = useState(null); // null = loading
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('eco.viewMode') || 'list');
  const [moreOpen, setMoreOpen] = useState(false);
  const [slice, setSlice] = useState(null);

  React.useEffect(() => { localStorage.setItem('eco.viewMode', viewMode); }, [viewMode]);

  // Debounce del buscador → filters.q
  React.useEffect(() => {
    const id = setTimeout(() => {
      setFilters((f) => f.q === queryInput ? f : { ...f, q: queryInput });
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [queryInput]);

  // Cuando cambian los filtros (no la página), reset a página 1.
  // Cuando cambia la página, no reseteamos filtros.
  React.useEffect(() => { setPage(1); }, [filters.sentiment, filters.source, filters.topic, filters.region, filters.sortBy]);

  // Fetch del feed con filtros + paginación.
  React.useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    const agency = localStorage.getItem('eco.agency') || '';
    // ecoGetPeriodParams respeta el rango personalizado (eco.from/to); leer
    // eco.period a mano lo ignoraba y /mentions mostraba 30 días rolantes.
    const params = new URLSearchParams({
      ...window.ecoGetPeriodParams(),
      limit: String(PAGE_SIZE),
      offset: String((page - 1) * PAGE_SIZE),
    });
    if (agency) params.set('agency', agency);
    if (filters.q) params.set('q', filters.q);
    if (filters.sentiment !== 'all') params.set('sentiment', filters.sentiment);
    if (filters.source !== 'all') params.set('source', filters.source);
    if (filters.topic) params.set('topic', filters.topic);
    if (filters.region) params.set('region', filters.region);
    const sort = resolveSort(filters.sortBy, !!filters.q);
    if (sort !== 'recent') params.set('sortBy', sort);
    fetch('/api/eco-mentions?' + params.toString(), { signal: ctrl.signal, credentials: 'same-origin', cache: 'no-store' })
      .then((r) => r.ok ? r.json() : { mentions: [], total: 0 })
      .then((j) => setData({ mentions: j.mentions || [], total: Number(j.total || 0) }))
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [filters, page]);

  // Conteo de "Virales": una consulta separada con limit=1 (solo nos
  // interesa `total`). Se recalcula cuando cambia el período/agency, pero
  // NO cuando cambian filtros de búsqueda — virales es un agregado global.
  React.useEffect(() => {
    const ctrl = new AbortController();
    const agency = localStorage.getItem('eco.agency') || '';
    const params = new URLSearchParams({
      ...window.ecoGetPeriodParams(), limit: '1', minEngagement: String(VIRAL_THRESHOLD),
    });
    if (agency) params.set('agency', agency);
    setViralCount(null);
    fetch('/api/eco-mentions?' + params.toString(), { signal: ctrl.signal, credentials: 'same-origin', cache: 'no-store' })
      .then((r) => r.ok ? r.json() : { total: 0 })
      .then((j) => setViralCount(Number(j.total || 0)))
      .catch(() => setViralCount(0));
    return () => ctrl.abort();
  }, []);

  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const topicsList = (D.TOPICS || []).filter((t) => t && t.slug);
  const regions = Array.from(new Set((D.MUNICIPALITIES || []).map((m) => m && m.region).filter(Boolean))).sort();

  const activeMoreFiltersCount = (filters.topic ? 1 : 0) + (filters.region ? 1 : 0) + (filters.sortBy !== 'recent' ? 1 : 0);
  const searchTerms = filters.q ? filters.q.trim().split(/\s+/).filter((t) => t.length >= 2) : [];

  function openViralSlice() {
    setSlice({
      eyebrow: 'Menciones virales',
      title: 'Engagement ≥ ' + VIRAL_THRESHOLD.toLocaleString('es-PR'),
      accent: 'var(--neg)',
      _filter: { minEngagement: String(VIRAL_THRESHOLD) },
    });
  }
  const MentionsSliceModal = (window.ECO_SHELL && window.ECO_SHELL.MentionsSliceModal) || null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Filter bar */}
      <div className="card" style={{ padding: 14, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 240 }}>
          <Icons.Search size={14} color="var(--text-3)" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
          <input className="input" value={queryInput} onChange={(e) => setQueryInput(e.target.value)} placeholder="Buscar en menciones…" style={{ paddingLeft: 34 }} />
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {[{ k: 'all', l: 'Todas' }, { k: 'positivo', l: 'Positivo', tone: 'pos' }, { k: 'neutral', l: 'Neutral' }, { k: 'negativo', l: 'Negativo', tone: 'neg' }].map((x) => (
            <button key={x.k} onClick={() => setFilters((f) => ({ ...f, sentiment: x.k }))} className={`chip ${filters.sentiment === x.k ? 'active' : ''}`}>
              {x.tone && <span className="dot" style={{ background: `var(--${x.tone})` }} />}{x.l}
            </button>
          ))}
        </div>
        <div style={{ width: 1, height: 24, background: 'var(--hairline)' }} />
        <SourceSelect value={filters.source} onChange={(e) => setFilters((f) => ({ ...f, source: e.target.value }))} style={{ width: 160 }} />
        <div style={{ position: 'relative' }}>
          <button className="btn" onClick={() => setMoreOpen((v) => !v)}>
            <Icons.Filter size={13} /> Más filtros {activeMoreFiltersCount > 0 && <span style={{ color: 'var(--accent)', fontSize: 10 }}>·{activeMoreFiltersCount}</span>}
          </button>
          {moreOpen && (
            <div className="card" style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 80, padding: 12, minWidth: 260, boxShadow: '0 8px 24px -8px rgba(0,0,0,0.4)' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Tópico</div>
              <select className="input" value={filters.topic} onChange={(e) => setFilters((f) => ({ ...f, topic: e.target.value }))} style={{ width: '100%', marginBottom: 10 }}>
                <option value="">Todos los tópicos</option>
                {topicsList.map((t) => <option key={t.slug} value={t.slug}>{t.name || t.slug}</option>)}
              </select>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Región</div>
              <select className="input" value={filters.region} onChange={(e) => setFilters((f) => ({ ...f, region: e.target.value }))} style={{ width: '100%', marginBottom: 10 }}>
                <option value="">Todas las regiones</option>
                {regions.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Ordenar por</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {SORT_OPTIONS.map((o) => {
                  const disabled = o.needsQuery && !filters.q;
                  const effective = resolveSort(filters.sortBy, !!filters.q);
                  return (
                    <button key={o.k} className={`chip ${effective === o.k ? 'active' : ''}`}
                      onClick={() => { if (!disabled) setFilters((f) => ({ ...f, sortBy: o.k })); }} disabled={disabled}
                      style={disabled ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
                      title={disabled ? 'Requiere un término de búsqueda' : undefined}>
                      {o.l}
                    </button>
                  );
                })}
              </div>
              {activeMoreFiltersCount > 0 && (
                <button className="chip" style={{ marginTop: 12 }} onClick={() => setFilters((f) => ({ ...f, topic: '', region: '', sortBy: 'recent' }))}>
                  Limpiar filtros
                </button>
              )}
            </div>
          )}
        </div>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
          {loading ? 'Cargando…' : `${data.total.toLocaleString('es-PR')} menciones`}
        </span>
      </div>

      {/* Quick metrics — 4 cards (sin "Alta pertinencia"). "Virales" es clickeable. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <QuickMetric label="Total" value={fmt(D.CURRENT_METRICS.totalMentions)} />
        <QuickMetric label="Alcance" value={fmt(D.CURRENT_METRICS.totalReach)} />
        <QuickMetric label="Engagement rate" value={D.CURRENT_METRICS.engagementRate + '%'} />
        <QuickMetric
          label={`Virales (≥ ${(VIRAL_THRESHOLD / 1000)}K)`}
          value={viralCount == null ? '…' : fmt(viralCount)}
          tone="neg"
          onClick={viralCount != null && viralCount > 0 ? openViralSlice : null}
        />
      </div>

      {/* Mentions table */}
      <div className="card">
        <div className="card-hd">
          <div>
            <div className="card-hd-title">Menciones</div>
            <div className="card-hd-sub">
              {loading ? 'Cargando…' : (
                data.total === 0
                  ? 'Sin resultados'
                  : `Página ${page} de ${totalPages} · ${data.total.toLocaleString('es-PR')} en total`
              )}
            </div>
          </div>
          <ViewToggle viewMode={viewMode} setViewMode={setViewMode} />
        </div>
        {data.mentions.length === 0 && !loading && (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
            No se encontraron menciones con los filtros actuales.
          </div>
        )}
        {viewMode === 'list' && <MentionsList mentions={data.mentions} onMentionClick={onMentionClick} highlight={searchTerms} />}
        {viewMode === 'cards' && <MentionsCards mentions={data.mentions} onMentionClick={onMentionClick} highlight={searchTerms} />}
        {viewMode === 'table' && <MentionsTable mentions={data.mentions} onMentionClick={onMentionClick} highlight={searchTerms} />}
        {data.total > PAGE_SIZE && (
          <div style={{ padding: '14px 16px', borderTop: '1px solid var(--hairline)', display: 'flex', justifyContent: 'center' }}>
            <Pagination page={page} totalPages={totalPages} onChange={setPage} />
          </div>
        )}
      </div>
      {slice && MentionsSliceModal && (
        <MentionsSliceModal slice={slice} onClose={() => setSlice(null)} onMentionClick={onMentionClick} />
      )}
    </div>
  );
}

function QuickMetric({ label, value, tone, onClick }) {
  const color = tone === 'neg' ? 'var(--neg)' : tone === 'warn' ? 'var(--warn)' : 'var(--text)';
  const baseStyle = {
    padding: 14,
    cursor: onClick ? 'pointer' : 'default',
    transition: 'background 0.15s ease',
  };
  return (
    <div
      className="card"
      style={baseStyle}
      onClick={onClick || undefined}
      onMouseEnter={onClick ? (e) => (e.currentTarget.style.background = 'var(--canvas-2)') : undefined}
      onMouseLeave={onClick ? (e) => (e.currentTarget.style.background = '') : undefined}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
        {label}
        {onClick && <Icons.ChevronRight size={10} color="var(--text-3)" style={{ marginLeft: 'auto' }} />}
      </div>
      <div className="num" style={{ fontSize: 22, fontWeight: 600, color, marginTop: 6, fontFamily: 'var(--ff-display)' }}>{value}</div>
    </div>
  );
}

function Pagination({ page, totalPages, onChange }) {
  // Estilo clásico: Anterior · 1 2 3 … N · Siguiente. Muestra hasta 5 páginas
  // alrededor de la actual con elipses en los extremos cuando hay más.
  const window = 2; // vecinos a cada lado
  const pages = [];
  const push = (p) => { if (!pages.includes(p) && p >= 1 && p <= totalPages) pages.push(p); };
  push(1);
  for (let p = page - window; p <= page + window; p++) push(p);
  push(totalPages);
  pages.sort((a, b) => a - b);

  const out = [];
  let prev = 0;
  for (const p of pages) {
    if (p - prev > 1) out.push({ ellipsis: true, key: 'e-' + prev });
    out.push({ p, key: 'p-' + p });
    prev = p;
  }

  const btnStyle = (active, disabled) => ({
    minWidth: 32,
    padding: '6px 10px',
    border: '1px solid ' + (active ? 'var(--accent)' : 'var(--hairline)'),
    background: active ? 'var(--accent-fill)' : 'var(--canvas)',
    color: disabled ? 'var(--text-3)' : (active ? 'var(--accent)' : 'var(--text-2)'),
    borderRadius: 6,
    fontSize: 12,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontWeight: active ? 700 : 500,
    fontFamily: 'var(--ff-numeric)',
  });

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
      <button
        onClick={() => page > 1 && onChange(page - 1)}
        disabled={page <= 1}
        style={btnStyle(false, page <= 1)}
        aria-label="Página anterior"
      >
        <Icons.ChevronLeft size={12} style={{ verticalAlign: 'middle' }} />
        <span style={{ marginLeft: 4, fontSize: 11 }}>Anterior</span>
      </button>
      {out.map((item) => item.ellipsis ? (
        <span key={item.key} style={{ padding: '6px 4px', color: 'var(--text-3)', fontSize: 12 }}>…</span>
      ) : (
        <button
          key={item.key}
          onClick={() => onChange(item.p)}
          style={btnStyle(item.p === page, false)}
          aria-current={item.p === page ? 'page' : undefined}
        >
          {item.p}
        </button>
      ))}
      <button
        onClick={() => page < totalPages && onChange(page + 1)}
        disabled={page >= totalPages}
        style={btnStyle(false, page >= totalPages)}
        aria-label="Página siguiente"
      >
        <span style={{ marginRight: 4, fontSize: 11 }}>Siguiente</span>
        <Icons.ChevronRight size={12} style={{ verticalAlign: 'middle' }} />
      </button>
    </div>
  );
}

// Resalta los términos de búsqueda dentro de un texto. `terms` es un array de
// tokens (los mismos que se mandan como `q` al API). Si no hay términos,
// devuelve el texto tal cual — así las pantallas que no buscan (o el feed sin
// query) renderizan exactamente igual que antes. Cada token se escapa para que
// caracteres especiales de regex no rompan el match.
function HL({ text, terms }) {
  if (text == null || text === '') return text || null;
  const list = (terms || []).map((t) => String(t).trim()).filter((t) => t.length >= 2);
  if (list.length === 0) return text;
  const escaped = list.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  let re;
  try { re = new RegExp('(' + escaped.join('|') + ')', 'ig'); } catch (_) { return text; }
  const parts = String(text).split(re);
  return parts.map((part, i) => (i % 2 === 1)
    ? <mark key={i} style={{ background: 'var(--accent-fill)', color: 'var(--accent)', padding: '0 2px', borderRadius: 3, fontWeight: 600 }}>{part}</mark>
    : <React.Fragment key={i}>{part}</React.Fragment>);
}

// --- Mentions: List view (dense table-row, sin columnas Engagement ni Pertinencia) ---
function MentionsList({ mentions, onMentionClick, highlight }) {
  return (
    <>
      <div style={{ padding: '10px 16px 6px', display: 'grid', gridTemplateColumns: '20px 2fr 110px 110px 80px 30px', gap: 12, fontSize: 10, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', borderBottom: '1px solid var(--hairline)' }}>
        <span /><span>Mención</span><span>Sentimiento</span><span>Tópico</span><span>Hora</span><span />
      </div>
      {mentions.map((mn) => {
        const sourceIcon = { facebook: 'Facebook', twitter: 'Twitter', news: 'Newspaper', instagram: 'Instagram', youtube: 'Youtube' }[mn.source] || 'Globe';
        const SIcon = Icons[sourceIcon];
        const sc = mn.sentiment === 'positivo' ? 'pill-pos' : mn.sentiment === 'negativo' ? 'pill-neg' : mn.sentiment === 'neutral' ? 'pill-neu' : 'pill-unknown';
        return (
          <div key={mn.id} onClick={() => onMentionClick(mn)} className="row-hover"
            style={{ display: 'grid', gridTemplateColumns: '20px 2fr 110px 110px 80px 30px', gap: 12, alignItems: 'center', padding: '12px 16px', borderTop: '1px solid var(--hairline)', fontSize: 12, cursor: 'pointer' }}>
            <SIcon size={14} color="var(--text-3)" />
            <div style={{ overflow: 'hidden' }}>
              <div style={{ color: 'var(--text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><HL text={mn.title} terms={highlight} /></div>
              <div style={{ color: 'var(--text-3)', fontSize: 10 }}>{mn.author} · {mn.domain}</div>
            </div>
            <span className={`pill ${sc}`} style={{ justifySelf: 'start' }}>{mn.sentiment}</span>
            <span style={{ color: 'var(--text-2)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{mn.topicName || mn.topic || '—'}</span>
            <span style={{ color: 'var(--text-3)', fontSize: 11 }}>{mn.publishedAt}</span>
            <Icons.ChevronRight size={14} color="var(--text-3)" />
          </div>
        );
      })}
    </>
  );
}

// --- Mentions: Cards view (rich tiles, sin pill de pertinencia) ---
function MentionsCards({ mentions, onMentionClick, highlight }) {
  return (
    <div style={{ padding: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 12 }}>
      {mentions.map((mn) => {
        const sourceIcon = { facebook: 'Facebook', twitter: 'Twitter', news: 'Newspaper', instagram: 'Instagram', youtube: 'Youtube' }[mn.source] || 'Globe';
        const SIcon = Icons[sourceIcon];
        const sc = mn.sentiment === 'positivo' ? 'pill-pos' : mn.sentiment === 'negativo' ? 'pill-neg' : mn.sentiment === 'neutral' ? 'pill-neu' : 'pill-unknown';
        const accent = mn.sentiment === 'positivo' ? 'var(--pos)' : mn.sentiment === 'negativo' ? 'var(--neg)' : 'var(--warn)';
        return (
          <div key={mn.id} onClick={() => onMentionClick(mn)}
            style={{ background: 'var(--canvas)', border: '1px solid var(--hairline)', borderLeft: `3px solid ${accent}`, padding: 14, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 10 }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--canvas-2)'}
            onMouseLeave={e => e.currentTarget.style.background = 'var(--canvas)'}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
              <SIcon size={12} /> {mn.domain}
              <span>·</span>
              <span>{mn.publishedAt}</span>
              <span style={{ marginLeft: 'auto' }} className={`pill ${sc}`}>{mn.sentiment}</span>
            </div>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}><HL text={mn.title} terms={highlight} /></div>
            {mn.snippet && <div style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}><HL text={mn.snippet} terms={highlight} /></div>}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, color: 'var(--text-3)', paddingTop: 8, borderTop: '1px solid var(--hairline)' }}>
              <span style={{ fontWeight: 600, color: 'var(--text-2)' }}>{mn.author || '—'}</span>
              <span style={{ marginLeft: 'auto', color: 'var(--text-2)' }}>{mn.topicName || mn.topic || '—'}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// --- Mentions: Table view (compact, sin columnas Engagement ni Pertinencia) ---
function MentionsTable({ mentions, onMentionClick, highlight }) {
  const columns = ['', 'Título', 'Autor', 'Dominio', 'Sentim.', 'Tópico', 'Subtópico', 'Municipio', 'Fecha'];
  return (
    <div style={{ overflow: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--hairline-strong)', background: 'var(--canvas-2)' }}>
            {columns.map((c) => (
              <th key={c} style={{ padding: '8px 10px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {mentions.map(mn => {
            const sourceIcon = { facebook: 'Facebook', twitter: 'Twitter', news: 'Newspaper', instagram: 'Instagram', youtube: 'Youtube' }[mn.source] || 'Globe';
            const SIcon = Icons[sourceIcon];
            const sc = mn.sentiment === 'positivo' ? 'pill-pos' : mn.sentiment === 'negativo' ? 'pill-neg' : mn.sentiment === 'neutral' ? 'pill-neu' : 'pill-unknown';
            return (
              <tr key={mn.id} onClick={() => onMentionClick(mn)} className="row-hover" style={{ borderBottom: '1px solid var(--hairline)', cursor: 'pointer' }}>
                <td style={{ padding: '8px 10px' }}><SIcon size={12} color="var(--text-3)" /></td>
                <td style={{ padding: '8px 10px', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}><HL text={mn.title} terms={highlight} /></td>
                <td style={{ padding: '8px 10px', color: 'var(--text-2)', whiteSpace: 'nowrap' }}>{mn.author || '—'}</td>
                <td style={{ padding: '8px 10px', color: 'var(--text-2)' }}>{mn.domain}</td>
                <td style={{ padding: '8px 10px' }}><span className={`pill ${sc}`}>{mn.sentiment}</span></td>
                <td style={{ padding: '8px 10px', color: 'var(--text-2)' }}>{mn.topicName || mn.topic || '—'}</td>
                <td style={{ padding: '8px 10px', color: 'var(--text-2)' }}>
                  {(mn.subtopics && mn.subtopics.length > 0) ? (
                    <>
                      {mn.subtopics[0]}
                      {mn.subtopics.length > 1 && (
                        <span style={{ color: 'var(--text-3)', marginLeft: 4 }}>+{mn.subtopics.length - 1}</span>
                      )}
                    </>
                  ) : '—'}
                </td>
                <td style={{ padding: '8px 10px', color: 'var(--text-2)' }}>{mn.municipality || '—'}</td>
                <td style={{ padding: '8px 10px', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{mn.publishedAt}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// =============== SEARCH (página de resultados global) ===============
// Buscador unificado: el command palette (⌘K) abre esta pantalla con la query
// y aquí viven los resultados completos — facetas con conteos, orden,
// resaltado y paginación. Reusa el mismo /api/eco-mentions que el feed de
// Menciones, así que respeta agencia, período (incl. rango custom) y filtros.
function readRecentSearches() {
  try {
    const arr = JSON.parse(localStorage.getItem('eco.recentSearches') || '[]');
    return Array.isArray(arr) ? arr.filter((s) => typeof s === 'string') : [];
  } catch (_) { return []; }
}
function pushRecentSearch(term) {
  const t = String(term || '').trim();
  if (t.length < 2) return;
  try {
    const prev = readRecentSearches().filter((s) => s.toLowerCase() !== t.toLowerCase());
    localStorage.setItem('eco.recentSearches', JSON.stringify([t, ...prev].slice(0, 8)));
  } catch (_) {}
}

function SearchScreen({ onMentionClick, agency, searchQuery, setSearchQuery, setActive }) {
  // Query inicial: prop del palette > ?q= de la URL > vacío.
  const initialQ = (() => {
    if (searchQuery && searchQuery.trim()) return searchQuery.trim();
    try { return new URLSearchParams(location.search).get('q') || ''; } catch (_) { return ''; }
  })();
  const [queryInput, setQueryInput] = useState(initialQ);
  const [q, setQ] = useState(initialQ);
  const [sortBy, setSortBy] = useState('relevance');
  const [filters, setFilters] = useState({ sentiment: 'all', source: 'all', topic: '', region: '' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ mentions: [], total: 0, sentiment: { pos: 0, neu: 0, neg: 0 } });
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('eco.viewMode') || 'list');
  const [recent, setRecent] = useState(readRecentSearches);
  const [moreOpen, setMoreOpen] = useState(false);
  const inputRef = React.useRef(null);

  const filtersActive = filters.sentiment !== 'all' || filters.source !== 'all' || !!filters.topic || !!filters.region;
  const activeMoreFiltersCount = (filters.topic ? 1 : 0) + (filters.region ? 1 : 0);
  const hasCriteria = (!!q && q.length >= 2) || filtersActive;
  const searchTerms = q ? q.trim().split(/\s+/).filter((t) => t.length >= 2) : [];
  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const topicsList = (D.TOPICS || []).filter((t) => t && t.slug);
  const popularTopics = topicsList.slice(0, 8);
  const regions = Array.from(new Set((D.MUNICIPALITIES || []).map((m) => m && m.region).filter(Boolean))).sort();

  React.useEffect(() => { localStorage.setItem('eco.viewMode', viewMode); }, [viewMode]);
  React.useEffect(() => { if (inputRef.current) inputRef.current.focus(); }, []);

  // Si el palette navega de nuevo a /search con otra query estando ya aquí,
  // sincroniza el input.
  React.useEffect(() => {
    if (searchQuery != null && searchQuery.trim() && searchQuery.trim() !== queryInput) {
      setQueryInput(searchQuery.trim());
    }
  }, [searchQuery]);

  // Debounce queryInput -> q. Sincroniza URL (?q=), recientes y estado
  // compartido para que palette y deep-links queden alineados.
  React.useEffect(() => {
    const id = setTimeout(() => {
      const term = queryInput.trim();
      setQ(term);
      setPage(1);
      if (setSearchQuery) setSearchQuery(term);
      try {
        history.replaceState(history.state, '', term ? '/search?q=' + encodeURIComponent(term) : '/search');
      } catch (_) {}
      if (term.length >= 2) { pushRecentSearch(term); setRecent(readRecentSearches()); }
    }, 320);
    return () => clearTimeout(id);
  }, [queryInput]);

  React.useEffect(() => { setPage(1); }, [filters.sentiment, filters.source, filters.topic, filters.region, sortBy]);

  // Fetch de resultados. Se omite cuando no hay criterio (estado vacío).
  React.useEffect(() => {
    const active = (!!q && q.length >= 2) || filters.sentiment !== 'all' || filters.source !== 'all' || !!filters.topic || !!filters.region;
    if (!active) { setData({ mentions: [], total: 0, sentiment: { pos: 0, neu: 0, neg: 0 } }); setLoading(false); return; }
    const ctrl = new AbortController();
    setLoading(true);
    const params = new URLSearchParams({ ...window.ecoGetPeriodParams(), limit: String(PAGE_SIZE), offset: String((page - 1) * PAGE_SIZE) });
    if (agency) params.set('agency', agency);
    if (q && q.length >= 2) params.set('q', q);
    const sort = resolveSort(sortBy, !!(q && q.length >= 2));
    if (sort !== 'recent') params.set('sortBy', sort);
    if (filters.sentiment !== 'all') params.set('sentiment', filters.sentiment);
    if (filters.source !== 'all') params.set('source', filters.source);
    if (filters.topic) params.set('topic', filters.topic);
    if (filters.region) params.set('region', filters.region);
    fetch('/api/eco-mentions?' + params.toString(), { signal: ctrl.signal, credentials: 'same-origin', cache: 'no-store' })
      .then((r) => r.ok ? r.json() : { mentions: [], total: 0, sentiment: { pos: 0, neu: 0, neg: 0 } })
      .then((j) => setData({ mentions: j.mentions || [], total: Number(j.total || 0), sentiment: j.sentiment || { pos: 0, neu: 0, neg: 0 } }))
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [q, sortBy, filters, page, agency]);

  const sentChips = [
    { k: 'all', l: 'Todas', tone: null, count: data.total },
    { k: 'positivo', l: 'Positivo', tone: 'pos', count: data.sentiment.pos },
    { k: 'neutral', l: 'Neutral', tone: null, count: data.sentiment.neu },
    { k: 'negativo', l: 'Negativo', tone: 'neg', count: data.sentiment.neg },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Hero search */}
      <div className="card" style={{ padding: 16 }}>
        <div style={{ position: 'relative' }}>
          <Icons.Search size={18} color="var(--text-3)" style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)' }} />
          <input
            ref={inputRef} className="input" value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { setQ(queryInput.trim()); setPage(1); } }}
            placeholder="Buscar en todas las menciones — palabras clave, autor, tema…"
            aria-label="Buscar en todas las menciones"
            style={{ paddingLeft: 42, paddingRight: queryInput ? 40 : 14, fontSize: 16, height: 48, width: '100%' }}
          />
          {queryInput && (
            <button onClick={() => { setQueryInput(''); if (inputRef.current) inputRef.current.focus(); }} title="Limpiar búsqueda" aria-label="Limpiar búsqueda"
              style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: 20, lineHeight: 1 }}>×</button>
          )}
        </div>
      </div>

      {/* Estado vacío: recientes + tópicos frecuentes */}
      {!hasCriteria && (
        <div className="card" style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 22 }}>
          <div style={{ textAlign: 'center' }}>
            <Icons.Search size={28} color="var(--text-3)" />
            <div style={{ marginTop: 10, fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>Busca en todas las menciones</div>
            <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-3)', maxWidth: 460, marginLeft: 'auto', marginRight: 'auto' }}>
              Escribe una o más palabras clave para encontrar menciones por título o contenido. Combina términos para afinar y usa los filtros para acotar por sentimiento, fuente o tópico.
            </div>
          </div>
          {recent.length > 0 && (
            <div>
              <div className="section-eyebrow">Búsquedas recientes</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {recent.map((s) => (
                  <button key={s} className="chip" onClick={() => { setQueryInput(s); setQ(s); setPage(1); }}>{s}</button>
                ))}
                <button className="chip" style={{ color: 'var(--text-3)' }}
                  onClick={() => { try { localStorage.removeItem('eco.recentSearches'); } catch (_) {} setRecent([]); }}>
                  Limpiar
                </button>
              </div>
            </div>
          )}
          {popularTopics.length > 0 && (
            <div>
              <div className="section-eyebrow">Tópicos frecuentes</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {popularTopics.map((t) => (
                  <button key={t.slug} className="chip" onClick={() => setFilters((f) => ({ ...f, topic: t.slug }))}>
                    <Icons.Hash size={11} /> {t.name || t.slug}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Facet bar + resultados */}
      {hasCriteria && (
        <>
          <div className="card" style={{ padding: 14, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 6 }}>
              {sentChips.map((x) => (
                <button key={x.k} onClick={() => setFilters((f) => ({ ...f, sentiment: x.k }))} className={`chip ${filters.sentiment === x.k ? 'active' : ''}`}>
                  {x.tone && <span className="dot" style={{ background: `var(--${x.tone})` }} />}{x.l}
                  {filters.sentiment === 'all' && <span className="num" style={{ marginLeft: 6, color: 'var(--text-3)' }}>{Number(x.count || 0).toLocaleString('es-PR')}</span>}
                </button>
              ))}
            </div>
            <div style={{ width: 1, height: 24, background: 'var(--hairline)' }} />
            <SourceSelect value={filters.source} onChange={(e) => setFilters((f) => ({ ...f, source: e.target.value }))} style={{ width: 160 }} />
            <div style={{ position: 'relative' }}>
              <button className="btn" onClick={() => setMoreOpen((v) => !v)}>
                <Icons.Filter size={13} /> Más filtros {activeMoreFiltersCount > 0 && <span style={{ color: 'var(--accent)', fontSize: 10 }}>·{activeMoreFiltersCount}</span>}
              </button>
              {moreOpen && (
                <div className="card" style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 80, padding: 12, minWidth: 260, boxShadow: '0 8px 24px -8px rgba(0,0,0,0.4)' }}>
                  <div className="section-eyebrow" style={{ marginBottom: 6 }}>Tópico</div>
                  <select className="input" value={filters.topic} onChange={(e) => setFilters((f) => ({ ...f, topic: e.target.value }))} style={{ width: '100%', marginBottom: 10 }}>
                    <option value="">Todos los tópicos</option>
                    {topicsList.map((t) => <option key={t.slug} value={t.slug}>{t.name || t.slug}</option>)}
                  </select>
                  <div className="section-eyebrow" style={{ marginBottom: 6 }}>Región</div>
                  <select className="input" value={filters.region} onChange={(e) => setFilters((f) => ({ ...f, region: e.target.value }))} style={{ width: '100%', marginBottom: 10 }}>
                    <option value="">Todas las regiones</option>
                    {regions.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  {(filters.topic || filters.region) && (
                    <button className="chip" onClick={() => setFilters((f) => ({ ...f, topic: '', region: '' }))}>Limpiar</button>
                  )}
                </div>
              )}
            </div>
            {filtersActive && (
              <button className="chip" onClick={() => setFilters({ sentiment: 'all', source: 'all', topic: '', region: '' })}>Limpiar filtros</button>
            )}
            <SortChips sortBy={sortBy} setSortBy={setSortBy} hasQuery={!!(q && q.length >= 2)} />
          </div>

          <div className="card">
            <div className="card-hd">
              <div>
                <div className="card-hd-title">{q ? <>Resultados para «{q}»</> : 'Resultados'}</div>
                <div className="card-hd-sub">
                  {loading
                    ? 'Buscando…'
                    : (data.total === 0
                        ? 'Sin resultados'
                        : `${data.total.toLocaleString('es-PR')} menciones · página ${page} de ${totalPages}`)}
                </div>
              </div>
              <ViewToggle viewMode={viewMode} setViewMode={setViewMode} />
            </div>
            {loading && data.mentions.length === 0 && (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>Buscando…</div>
            )}
            {!loading && data.total === 0 && (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
                No se encontraron menciones{q ? <> para «{q}»</> : ''}{filtersActive ? ' con los filtros actuales' : ''}.
                {filtersActive && (
                  <div style={{ marginTop: 12 }}>
                    <button className="chip" onClick={() => setFilters({ sentiment: 'all', source: 'all', topic: '', region: '' })}>Quitar filtros</button>
                  </div>
                )}
              </div>
            )}
            {data.mentions.length > 0 && viewMode === 'list' && <MentionsList mentions={data.mentions} onMentionClick={onMentionClick} highlight={searchTerms} />}
            {data.mentions.length > 0 && viewMode === 'cards' && <MentionsCards mentions={data.mentions} onMentionClick={onMentionClick} highlight={searchTerms} />}
            {data.mentions.length > 0 && viewMode === 'table' && <MentionsTable mentions={data.mentions} onMentionClick={onMentionClick} highlight={searchTerms} />}
            {data.total > PAGE_SIZE && (
              <div style={{ padding: '14px 16px', borderTop: '1px solid var(--hairline)', display: 'flex', justifyContent: 'center' }}>
                <Pagination page={page} totalPages={totalPages} onChange={setPage} />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// =============== SENTIMENT ===============
function SentimentScreen({ onMentionClick, period, agency }) {
  const [slice, setSlice] = useState(null);
  const [groupBy, setGroupBy] = useState('source');
  const m = D.CURRENT_METRICS;

  // Mapa de dimensiones del breakdown "Sentimiento por X". Las 4 fuentes de
  // datos vienen del API /api/eco-data — ver eco-data/route.ts.
  const GROUP_BY_OPTIONS = [
    { k: 'source',   l: 'Fuente',    dataKey: 'SENTIMENT_BY_SOURCE',   itemKey: 'source' },
    { k: 'topic',    l: 'Tópico',    dataKey: 'SENTIMENT_BY_TOPIC',    itemKey: 'topic' },
    { k: 'subtopic', l: 'Subtópico', dataKey: 'SENTIMENT_BY_SUBTOPIC', itemKey: 'subtopic' },
    { k: 'region',   l: 'Región',    dataKey: 'SENTIMENT_BY_REGION',   itemKey: 'region' },
  ];
  const activeGroup = GROUP_BY_OPTIONS.find((o) => o.k === groupBy) || GROUP_BY_OPTIONS[0];
  const groupRows = (D[activeGroup.dataKey] || []).map((r) => ({
    ...r,
    label: r[activeGroup.itemKey] || r.source || r.topic || r.subtopic || r.region || '—',
  }));

  function openNssInsight() {
    if (m.nss == null) return;
    openMetricInsightShared(setSlice, {
      metric: 'nss',
      value: `${m.nss > 0 ? '+' : ''}${m.nss}`,
      accent: 'var(--accent)',
      label: 'Net Sentiment Score',
      periodPreset: period || '7D',
      agency,
      subcomponents: [],
      filter: {},
    });
  }

  function openSentimentSlice(name) {
    const row = D.SENTIMENT_BREAKDOWN.find(s => s.name === name);
    if (!row) return;
    const accent = name === 'positivo' ? 'var(--pos)' : name === 'negativo' ? 'var(--neg)' : 'var(--text-3)';
    const values = D.TIMELINE.map(d => d[name] || 0);
    const xLabels = D.TIMELINE.map(d => d.date);
    setSlice({
      eyebrow: 'Sentimiento',
      title: `Menciones ${row.label.toLowerCase()}`,
      accent,
      histogram: { label: `Evolución diaria · ${row.label.toLowerCase()}`, values, xLabels },
      mentions: [],
      _filter: { sentiment: name },
    });
  }

  function openEmotionSlice(e) {
    const accent = `var(--${e.color})`;
    setSlice({
      eyebrow: 'Emoción detectada',
      title: e.emotion,
      accent,
      mentions: [],
      _filter: { emotion: e.emotion },
    });
  }

  function openTimelineDaySlice(d) {
    const total = (d.positivo || 0) + (d.neutral || 0) + (d.negativo || 0);
    const bias = d.negativo > d.positivo ? 'negativo' : d.positivo > d.negativo ? 'positivo' : 'neutral';
    const accent = bias === 'negativo' ? 'var(--neg)' : bias === 'positivo' ? 'var(--pos)' : 'var(--text-3)';
    const hours = Array.from({ length: 24 }, (_, h) => {
      const base = Math.sin((h - 10) / 24 * Math.PI) * 0.5 + 0.5;
      return Math.round(base * (total / 24) * 1.6);
    });
    const dayIso = d.fullDate ? d.fullDate.slice(0, 10) : undefined;
    setSlice({
      eyebrow: d.date,
      title: bias === 'negativo' ? 'Día negativo' : bias === 'positivo' ? 'Día positivo' : 'Día neutro',
      accent,
      sentiment: { pos: d.positivo || 0, neu: d.neutral || 0, neg: d.negativo || 0 },
      histogram: { label: 'Volumen por hora', values: hours, xLabels: Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2,'0')}:00`) },
      mentions: [],
      _filter: { day: dayIso },
    });
  }

  function openGroupSlice(row, sentimentType) {
    const accent = sentimentType === 'positivo' ? 'var(--pos)' : sentimentType === 'negativo' ? 'var(--neg)' : 'var(--text-3)';
    const label = row.label;
    const filter = { sentiment: sentimentType };
    if (groupBy === 'source') {
      filter.source = {
        'Facebook': 'facebook', 'Twitter': 'twitter', 'X / Twitter': 'twitter',
        'Noticias': 'news', 'Instagram': 'instagram', 'YouTube': 'youtube', 'Blogs': 'blog',
      }[label] || String(label || '').toLowerCase();
    } else if (groupBy === 'topic') {
      filter.topic = row.slug || row.topic || label;
    } else if (groupBy === 'subtopic') {
      filter.subtopic = label;
    } else if (groupBy === 'region') {
      filter.region = label;
    }
    const eyebrowLabel = { source: 'Fuente', topic: 'Tópico', subtopic: 'Subtópico', region: 'Región' }[groupBy] || 'Grupo';
    setSlice({
      eyebrow: `${eyebrowLabel} · ${label}`,
      title: `Sentimiento ${sentimentType}`,
      accent,
      mentions: [],
      _filter: filter,
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Narrative hero */}
      <div className="card" style={{ padding: 20, display: 'grid', gridTemplateColumns: '1fr auto', gap: 24, alignItems: 'center' }}>
        <div>
          <div className="section-eyebrow">NSS (Net Sentiment Score)</div>
          <button onClick={openNssInsight}
            className="row-hover"
            title="Ver insight del NSS para el periodo"
            style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginTop: 8, padding: '4px 8px', marginInline: -8, borderRadius: 6, background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
            <div className="num" style={{ fontSize: 56, fontWeight: 500, color: 'var(--accent)', lineHeight: 1, fontFamily: 'var(--ff-display)' }}>{m.nss > 0 ? '+' : ''}{m.nss}</div>
            <div style={{ fontSize: 13, color: 'var(--text-2)' }}>NSS</div>
            <Icons.ArrowRight size={14} color="var(--text-3)" />
            <div style={{ marginLeft: 8, fontSize: 12, color: 'var(--neg)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
              <Icons.ArrowDown size={12} /> 3.2 vs período anterior
            </div>
          </button>
          <div style={{ fontSize: 14, color: 'var(--text-2)', marginTop: 12, maxWidth: 640, lineHeight: 1.55 }}>
            Sentimiento neto dentro de rango positivo, pero deterioro acelerado por discurso sobre infraestructura vial. Emociones dominantes de las últimas 24 horas: <strong>frustración</strong> y <strong>enojo</strong>.
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <div>
            <Donut data={D.SENTIMENT_BREAKDOWN} size={110} thickness={14} colors={['var(--pos)', 'var(--text-3)', 'var(--neg)']} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
            {D.SENTIMENT_BREAKDOWN.map((s) => {
              // El % debe normalizarse sobre la suma del propio breakdown (no
              // sobre m.totalMentions): SENTIMENT_BREAKDOWN y totalMentions son
              // campos independientes y divergen, lo que hacía que pos+neu+neg
              // sumara ≠100% (p. ej. 112%).
              const sbTotal = D.SENTIMENT_BREAKDOWN.reduce((acc, x) => acc + (x.value || 0), 0) || 1;
              const pct = Math.round((s.value / sbTotal) * 100);
              const c = s.name === 'positivo' ? 'var(--pos)' : s.name === 'negativo' ? 'var(--neg)' : 'var(--text-3)';
              return (
                <button key={s.name} onClick={() => openSentimentSlice(s.name)}
                  className="row-hover"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, background: 'transparent',
                    border: 'none', padding: '4px 6px', marginInline: -6, borderRadius: 6,
                    cursor: 'pointer', textAlign: 'left', minWidth: 160,
                  }}>
                  <span className="dot" style={{ background: c }} />
                  <span style={{ color: 'var(--text-2)' }}>{s.label}</span>
                  <span className="num" style={{ fontWeight: 600, marginLeft: 'auto' }}>{pct}%</span>
                  <Icons.ArrowRight size={11} color="var(--text-3)" />
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Charts */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 12 }}>
        <div className="card">
          <div className="card-hd">
            <div><div className="card-hd-title">Sentimiento en el tiempo</div><div className="card-hd-sub">Volumen apilado · click un día para ver menciones</div></div>
          </div>
          <div className="card-bd">
            <StackedAreaChart data={D.TIMELINE} keys={['positivo', 'neutral', 'negativo']}
              labels={{ positivo: 'Positivo', neutral: 'Neutral', negativo: 'Negativo' }}
              colors={['var(--pos)', 'var(--text-3)', 'var(--neg)']} height={260} onPointClick={openTimelineDaySlice} />
            <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 8, fontSize: 12 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span className="dot" style={{ background: 'var(--pos)' }} /> Positivo</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span className="dot" style={{ background: 'var(--text-3)' }} /> Neutral</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span className="dot" style={{ background: 'var(--neg)' }} /> Negativo</span>
            </div>
          </div>
        </div>

        <EmotionsCard emotions={D.EMOTIONS} onEmotionClick={openEmotionSlice} />
      </div>

      <div className="card">
        <div className="card-hd" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <div>
            <div className="card-hd-title">Sentimiento por {activeGroup.l.toLowerCase()}</div>
            <div className="card-hd-sub">Distribución normalizada · click un segmento para ver menciones</div>
          </div>
          {/* Toggle de dimensión: fuente / tópico / subtópico / región.
              Mismo patrón visual que GeographyScreen (Volumen/Sentimiento). */}
          <div style={{ display: 'flex', gap: 4, background: 'var(--canvas-2)', borderRadius: 999, padding: 3, border: '1px solid var(--hairline)' }}>
            {GROUP_BY_OPTIONS.map((o) => (
              <button key={o.k}
                onClick={() => setGroupBy(o.k)}
                style={{
                  padding: '4px 10px', fontSize: 11, fontWeight: 600,
                  borderRadius: 999, border: 'none', cursor: 'pointer',
                  background: groupBy === o.k ? 'var(--canvas)' : 'transparent',
                  color: groupBy === o.k ? 'var(--text)' : 'var(--text-3)',
                  boxShadow: groupBy === o.k ? '0 1px 2px rgba(0,0,0,0.04)' : 'none',
                }}>{o.l}</button>
            ))}
          </div>
        </div>
        <div className="card-bd" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 18 }}>
          {groupRows.length === 0 && (
            <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: 'var(--text-3)', fontSize: 12, padding: '20px 0' }}>
              Sin datos para esta dimensión en el periodo.
            </div>
          )}
          {groupRows.map((s, idx) => {
            const total = (s.positivo || 0) + (s.neutral || 0) + (s.negativo || 0);
            const pos = total > 0 ? Math.round((s.positivo/total)*100) : 0;
            const neu = total > 0 ? Math.round((s.neutral/total)*100) : 0;
            const neg = Math.max(0, 100 - pos - neu);
            return (
              <div key={`${groupBy}-${s.label}-${idx}`}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                  <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 'calc(100% - 60px)' }}>{s.label}</span>
                  <span className="num" style={{ color: 'var(--text-3)' }}>{fmt(total)}</span>
                </div>
                <div style={{ display: 'flex', height: 12, borderRadius: 4, overflow: 'hidden', background: 'var(--canvas-2)' }}>
                  <button onClick={() => openGroupSlice(s, 'positivo')} title={`${pos}% positivo — click para ver menciones`}
                    style={{ width: `${pos}%`, background: 'var(--pos)', border: 'none', cursor: 'pointer', padding: 0 }} />
                  <button onClick={() => openGroupSlice(s, 'neutral')} title={`${neu}% neutral — click para ver menciones`}
                    style={{ width: `${neu}%`, background: 'var(--text-3)', border: 'none', cursor: 'pointer', padding: 0 }} />
                  <button onClick={() => openGroupSlice(s, 'negativo')} title={`${neg}% negativo — click para ver menciones`}
                    style={{ width: `${neg}%`, background: 'var(--neg)', border: 'none', cursor: 'pointer', padding: 0 }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-3)', marginTop: 4 }}>
                  <span style={{ color: 'var(--pos)' }}>{pos}% pos</span>
                  <span>{neu}% neu</span>
                  <span style={{ color: 'var(--neg)' }}>{neg}% neg</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {slice && <MentionsSliceModal slice={slice} onClose={() => setSlice(null)} onMentionClick={onMentionClick} />}
    </div>
  );
}

// --- Emotions card — redesigned (v2) ---
//
// Bug previo: el backend mapeaba emociones como "alivio/gratitud/sarcasmo/
// indiferencia" a `color: 'neu'`, pero `--neu` no existe como CSS var, así
// que `background: var(--neu)` resolvía vacío y la barra quedaba invisible.
//
// Fix: paleta auto-contenida en frontend, mapeada por NOMBRE de emoción (no
// confía en `e.color` del backend). Cada emoción del set definido por el
// prompt del processor tiene un color distinto y semántico:
//   - enojo / frustración  → rojo (var(--neg))
//   - preocupación         → ámbar (var(--warn))
//   - sarcasmo             → púrpura (#8C5BA8)
//   - indiferencia         → gris cálido (#7B8794)
//   - gratitud / esperanza / alegría / aprobación → verde (var(--pos))
//   - alivio               → teal (#5FA98A)
//   - confusión            → gris (#7B8794)
//   - fallback             → gris (#7B8794)
function emotionColor(emotion) {
  const e = (emotion || '').toLowerCase();
  if (e === 'enojo' || e === 'frustración' || e === 'frustracion') return 'var(--neg)';
  if (e === 'preocupación' || e === 'preocupacion') return 'var(--warn)';
  if (e === 'sarcasmo') return '#8C5BA8';
  if (e === 'indiferencia' || e === 'confusión' || e === 'confusion') return '#7B8794';
  if (e === 'gratitud' || e === 'esperanza' || e === 'alegría' || e === 'alegria' || e === 'aprobación' || e === 'aprobacion') return 'var(--pos)';
  if (e === 'alivio') return '#5FA98A';
  return '#7B8794';
}

function EmotionsCard({ emotions, onEmotionClick }) {
  const sorted = [...(emotions || [])].sort((a, b) => b.count - a.count);
  const total = sorted.reduce((s, e) => s + e.count, 0);
  const top = sorted[0];

  if (!top) {
    return (
      <div className="card">
        <div className="card-hd">
          <div>
            <div className="card-hd-title">Emociones detectadas</div>
            <div className="card-hd-sub">Perfil del período</div>
          </div>
          <Icons.Heart size={14} color="var(--text-3)" />
        </div>
        <div className="card-bd">
          <div style={{ textAlign: 'center', color: 'var(--text-3)', fontSize: 12, padding: '20px 0' }}>
            Sin emociones clasificadas en el periodo.
          </div>
        </div>
      </div>
    );
  }

  const topColor = emotionColor(top.emotion);

  return (
    <div className="card">
      <div className="card-hd">
        <div>
          <div className="card-hd-title">Emociones detectadas</div>
          <div className="card-hd-sub">Perfil del período · {fmt(total)} menciones clasificadas</div>
        </div>
        <Icons.Heart size={14} color="var(--text-3)" />
      </div>
      <div className="card-bd" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Emoción dominante (hero) */}
        <button onClick={() => onEmotionClick(top)}
          className="row-hover"
          style={{
            display: 'flex', alignItems: 'center', gap: 14,
            padding: '12px 14px', borderRadius: 8,
            background: `color-mix(in oklab, ${topColor} 8%, var(--canvas))`,
            border: `1px solid color-mix(in oklab, ${topColor} 25%, var(--hairline))`,
            cursor: 'pointer', textAlign: 'left', width: '100%',
          }}>
          <div style={{
            width: 48, height: 48, borderRadius: '50%',
            background: `color-mix(in oklab, ${topColor} 18%, transparent)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <div style={{ width: 22, height: 22, borderRadius: '50%', background: topColor }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: topColor }}>Emoción dominante</div>
            <div style={{ fontSize: 18, fontWeight: 600, fontFamily: 'var(--ff-display)', color: 'var(--text)', marginTop: 2 }}>{top.emotion}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="num" style={{ fontSize: 22, fontWeight: 600, color: 'var(--text)', lineHeight: 1 }}>{fmt(top.count)}</div>
            <div className="num" style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 4 }}>{Math.round((top.count / total) * 100)}% del total</div>
          </div>
          <Icons.ArrowRight size={14} color="var(--text-3)" />
        </button>

        {/* Ranking de emociones — todas pintadas por nombre (no por e.color del
            backend que podía ser 'neu' sin var CSS). Bar 8px, ancho mínimo 2%
            para que las menores no desaparezcan visualmente. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {sorted.map((e, i) => {
            const pct = total > 0 ? (e.count / total) * 100 : 0;
            const color = emotionColor(e.emotion);
            const widthPct = pct > 0 ? Math.max(2, pct) : 0; // 2% piso visual cuando hay datos
            return (
              <button key={e.emotion} onClick={() => onEmotionClick(e)}
                className="row-hover"
                style={{
                  display: 'grid', gridTemplateColumns: '22px 120px 1fr 64px 12px',
                  gap: 12, alignItems: 'center',
                  padding: '8px 10px', marginInline: -10, borderRadius: 6,
                  background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left',
                  fontSize: 12,
                }}>
                <span className="mono" style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 600 }}>{String(i + 1).padStart(2, '0')}</span>
                <span style={{ color: 'var(--text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.emotion}</span>
                <div style={{ height: 8, borderRadius: 4, background: 'var(--canvas-2)', overflow: 'hidden', position: 'relative' }}>
                  <div style={{
                    height: '100%',
                    width: `${widthPct}%`,
                    background: color,
                    borderRadius: 'inherit',
                    transition: 'width 0.3s var(--ease)',
                  }} />
                </div>
                <span style={{ textAlign: 'right' }}>
                  <span className="num" style={{ display: 'block', color: 'var(--text-2)', fontWeight: 600, fontSize: 12, lineHeight: 1.1 }}>{fmt(e.count)}</span>
                  <span className="num" style={{ display: 'block', color: 'var(--text-3)', fontSize: 9, marginTop: 1 }}>{pct.toFixed(1)}%</span>
                </span>
                <Icons.ArrowRight size={11} color="var(--text-3)" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// =============== TOPICS ===============
function TopicsScreen({ onMentionClick }) {
  // The open topic lives in the URL (/topics/<slug>) so the browser Back button
  // returns to the topic list (not the previous screen) and a topic is
  // deep-linkable / shareable. `selected` mirrors the URL slug.
  const topicSlugFromUrl = () => {
    const m = location.pathname.match(/^\/topics\/(.+)$/);
    return m ? decodeURIComponent(m[1]) : null;
  };
  const [selected, setSelectedRaw] = useState(topicSlugFromUrl); // null = overview, else slug for drill-in
  const [view, setView] = useState('treemap'); // treemap | bubbles | list
  const [dayModal, setDayModal] = useState(null); // { date, fullDate, topicSlug, topicName, volume, sentiment }

  const openTopic = React.useCallback((slug) => {
    if (!slug) return;
    history.pushState({ eco: 'topics', topic: slug, fromList: true }, '', '/topics/' + encodeURIComponent(slug));
    setSelectedRaw(slug);
  }, []);
  const closeTopic = React.useCallback(() => {
    // Drilled in from the list this session → go Back so the pushed entry is
    // consumed and Back/forward stay consistent. On a cold deep-link there is no
    // list entry to return to, so rewrite the URL in place instead.
    if (history.state && history.state.fromList) history.back();
    else { history.replaceState({ eco: 'topics' }, '', '/topics'); setSelectedRaw(null); }
  }, []);
  // Sync on browser Back/forward (popstate) and on sidebar re-clicks that reset
  // the section (eco:locationchange, fired by App.setActive).
  React.useEffect(() => {
    const sync = () => setSelectedRaw(topicSlugFromUrl());
    window.addEventListener('popstate', sync);
    window.addEventListener('eco:locationchange', sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener('eco:locationchange', sync);
    };
  }, []);

  const sel = selected ? D.TOPICS.find(t => t.slug === selected) : null;
  const subs = sel ? (D.SUBTOPICS[sel.slug] || []) : [];

  // URL points at a topic absent from the current dataset (stale link, or
  // filtered out by the active period) → drop the drill-in and clean the URL.
  React.useEffect(() => {
    if (selected && !sel) {
      history.replaceState({ eco: 'topics' }, '', '/topics');
      setSelectedRaw(null);
    }
  }, [selected, sel]);

  // Real "topic of the day" data viene del endpoint (TOPIC_CALENDAR), que
  // agrupa mention_topics por (published_at AT TZ AST)::date y se queda con
  // el top-1 tópico por día. El backend ya respeta el periodo seleccionado
  // (35d para periodos cortos, hasta 365d para "1A"/"Max"), así que aquí
  // pasamos toda la lista — el render por semanas se encarga.
  const calendarData = React.useMemo(() => {
    return (D.TOPIC_CALENDAR || []).map((d) => {
      return {
        date: d.date,
        fullDate: d.fullDate,
        volume: d.volume,
        topicSlug: d.topicSlug,
        topicName: d.topicName,
        sentiment: d.sentiment,
      };
    });
  }, []);

  // Drill-in view
  if (sel) return <TopicDetail topic={sel} subs={subs} onBack={closeTopic} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Panorámica con view toggle */}
      <div className="card">
        <div className="card-hd">
          <div><div className="card-hd-title">Tópicos · vista panorámica</div><div className="card-hd-sub">Haz clic en un tópico para ver sus subtópicos</div></div>
          <div style={{ display: 'flex', gap: 6 }}>
            {[
              { k: 'treemap', l: 'Treemap', icon: 'Grid' },
              { k: 'bubbles', l: 'Burbujas', icon: 'Circle' },
              { k: 'list',    l: 'Lista',    icon: 'List' },
            ].map(o => {
              const IC = Icons[o.icon];
              return (
                <button key={o.k} onClick={() => setView(o.k)} className={`chip ${view === o.k ? 'active' : ''}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <IC size={11} /> {o.l}
                </button>
              );
            })}
          </div>
        </div>
        <div className="card-bd">
          {view === 'treemap' && <TopicTreemap topics={D.TOPICS} onSelect={openTopic} />}
          {view === 'bubbles' && <TopicBubbles topics={D.TOPICS} onSelect={openTopic} />}
          {view === 'list' &&    <TopicList topics={D.TOPICS} onSelect={openTopic} />}
        </div>
      </div>

      {/* Calendario de tópico principal por día */}
      <TopicCalendar data={calendarData} onSelect={openTopic} onDayClick={setDayModal} />

      {dayModal && (() => {
        const palette = ['#E1767B', '#4A7FB5', '#6B9E7F', '#C08457', '#8B6BB0', '#D4A73E', '#5A9FA8', '#A3624D'];
        const slugIdx = {};
        D.TOPICS.forEach((t, i) => { slugIdx[t.slug] = i; });
        const accent = palette[slugIdx[dayModal.topicSlug] % palette.length] || 'var(--accent)';
        const senti = splitSentiment(dayModal.volume, dayModal.sentiment);
        const hours = Array.from({ length: 24 }, (_, h) => {
          const base = Math.sin((h - 10) / 24 * Math.PI) * 0.5 + 0.5;
          const jitter = ((h * 37) % 11) / 11 * 0.4;
          return Math.round((base + jitter) * (dayModal.volume / 24) * 1.6);
        });
        const xLabels = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2,'0')}:00`);
        const dateStr = dayModal.dt.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        const dayIso = dayModal.dt.toISOString().slice(0, 10);
        return (
          <MentionsSliceModal
            slice={{
              eyebrow: dateStr,
              title: dayModal.topicName,
              accent,
              histogram: { label: 'Volumen por hora', values: hours, xLabels },
              mentions: [],
              _filter: { topic: dayModal.topicSlug, day: dayIso },
              ctaLabel: `Ver tópico · ${dayModal.topicName}`,
              ctaIcon: 'Hash',
              onCta: () => { setDayModal(null); openTopic(dayModal.topicSlug); },
            }}
            onClose={() => setDayModal(null)}
            onMentionClick={onMentionClick}
          />
        );
      })()}

      {/* Nota explicativa: la pestaña Tópicos usa el MISMO conteo que el correo
          y el Overview (top-confidence). Si una mención toca varios tópicos,
          cuenta una vez en su tópico principal — el "+N también lo tocan"
          señala las menciones donde ese tópico es secundario. */}
      <div style={{ padding: '12px 16px', fontSize: 11, color: 'var(--text-3)', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <Icons.Info size={12} color="var(--text-3)" style={{ flexShrink: 0, marginTop: 1 }} />
        <span>
          Cada mención cuenta una vez bajo su tópico de mayor confianza (mismo
          criterio del correo y del Overview). El "+N también lo tocan"
          indica menciones donde el tópico aparece como tema secundario. Al
          hacer clic en un tópico verás las primarias por defecto, con un
          toggle para incluir las secundarias.
        </span>
      </div>
    </div>
  );
}

// --- Treemap variant (existing style, with click drill-in) ---
function TopicTreemap({ topics, onSelect }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gridAutoRows: '76px', gap: 4 }}>
      {topics.map((t, i) => {
        const color = t.dominantSentiment === 'positivo' ? 'var(--pos)' : t.dominantSentiment === 'negativo' ? 'var(--neg)' : t.dominantSentiment === 'mixed' ? 'var(--warn)' : 'var(--text-3)';
        const bg = t.dominantSentiment === 'positivo' ? 'var(--pos-bg)' : t.dominantSentiment === 'negativo' ? 'var(--neg-bg)' : 'var(--canvas-2)';
        const span = i < 2 ? 2 : 1;
        const rowSpan = i < 2 ? 2 : 1;
        return (
          <button key={t.slug} onClick={() => onSelect(t.slug)}
            style={{
              gridColumn: `span ${span}`, gridRow: `span ${rowSpan}`,
              padding: 14, textAlign: 'left',
              background: bg, borderRadius: 8,
              border: '1.5px solid transparent',
              display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
              cursor: 'pointer', transition: 'all 0.2s var(--ease)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = color; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'transparent'; }}
          >
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t.name}</div>
              <div className="num" style={{ fontSize: i < 2 ? 30 : 18, fontWeight: 600, color: 'var(--text)', marginTop: 4, fontFamily: 'var(--ff-display)' }}>{fmt(t.count)}</div>
              {t.secondaryCount > 0 && (
                <div style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 500, marginTop: 2 }}>+{t.secondaryCount} también lo tocan</div>
              )}
            </div>
            {/* Barra de distribución de sentimiento: ahora ocupa todo el ancho
                disponible (flex: 1) y usa flex-grow proporcional al porcentaje
                — esto elimina el bug donde la barra quedaba diminuta (60px
                fijos) en tiles grandes. La altura aumentó a 6px para que
                las tres bandas sean visibles. */}
            <SentimentBar t={t} />
          </button>
        );
      })}
    </div>
  );
}

// Componente común para la fila inferior de un tile/list-row: barra de
// distribución pos/neu/neg + delta. Manejo de delta=null ("—") para distinguir
// "sin base de comparación" de "delta=0".
function SentimentBar({ t }) {
  const deltaStr = t.delta == null
    ? '—'
    : `${t.delta > 0 ? '↑' : t.delta < 0 ? '↓' : '↔'} ${Math.abs(t.delta)}%`;
  const deltaColor = t.delta == null
    ? 'var(--text-3)'
    : t.delta > 0 ? 'var(--neg)' : t.delta < 0 ? 'var(--pos)' : 'var(--text-3)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
      <div style={{ display: 'flex', flex: 1, height: 6, borderRadius: 3, overflow: 'hidden', background: 'var(--canvas-2)', minWidth: 40 }}>
        <div style={{ flexGrow: Math.max(0, t.positivePct || 0), background: 'var(--pos)' }} />
        <div style={{ flexGrow: Math.max(0, t.neutralPct || 0),  background: 'var(--text-3)' }} />
        <div style={{ flexGrow: Math.max(0, t.negativePct || 0), background: 'var(--neg)' }} />
      </div>
      <span style={{ fontSize: 10, fontWeight: 700, color: deltaColor, whiteSpace: 'nowrap', minWidth: 40, textAlign: 'right' }}>
        {deltaStr}
      </span>
    </div>
  );
}

// --- Bubbles variant ---
function TopicBubbles({ topics, onSelect }) {
  const max = Math.max(...topics.map(t => t.count));
  // Lay out bubbles with deterministic pseudo-random positions within an SVG viewport
  const W = 960, H = 360;
  const positioned = React.useMemo(() => {
    const out = [];
    const rng = (i) => {
      // cheap deterministic jitter
      const s = Math.sin(i * 9973) * 10000;
      return s - Math.floor(s);
    };
    topics.forEach((t, i) => {
      const r = 30 + (t.count / max) * 70;
      let x = 60 + rng(i) * (W - 120);
      let y = 60 + rng(i + 7) * (H - 120);
      // Push away from prior bubbles
      for (let k = 0; k < out.length; k++) {
        const dx = x - out[k].x, dy = y - out[k].y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        const minD = r + out[k].r + 6;
        if (dist < minD && dist > 0) {
          x += (dx / dist) * (minD - dist);
          y += (dy / dist) * (minD - dist);
        }
      }
      x = Math.max(r + 8, Math.min(W - r - 8, x));
      y = Math.max(r + 8, Math.min(H - r - 8, y));
      out.push({ ...t, x, y, r });
    });
    return out;
  }, [topics]);

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 360, display: 'block' }}>
        {positioned.map((t) => {
          const color = t.dominantSentiment === 'positivo' ? 'var(--pos)' : t.dominantSentiment === 'negativo' ? 'var(--neg)' : t.dominantSentiment === 'mixed' ? 'var(--warn)' : 'var(--text-3)';
          return (
            <g key={t.slug} style={{ cursor: 'pointer' }} onClick={() => onSelect(t.slug)}>
              <circle cx={t.x} cy={t.y} r={t.r} fill={color} fillOpacity="0.18" stroke={color} strokeWidth="1.5" />
              <text x={t.x} y={t.y - 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--text)" style={{ pointerEvents: 'none' }}>
                {t.name.length > 18 ? t.name.slice(0, 17) + '…' : t.name}
              </text>
              <text x={t.x} y={t.y + 12} textAnchor="middle" fontSize="14" fontWeight="700" fill="var(--text)" style={{ fontFamily: 'var(--ff-display)', pointerEvents: 'none' }}>
                {fmt(t.count)}
              </text>
              <text x={t.x} y={t.y + 26} textAnchor="middle" fontSize="9"
                fill={t.delta == null ? 'var(--text-3)' : t.delta > 0 ? 'var(--neg)' : t.delta < 0 ? 'var(--pos)' : 'var(--text-3)'}
                fontWeight="700" style={{ pointerEvents: 'none' }}>
                {t.delta == null ? '—' : `${t.delta > 0 ? '↑' : t.delta < 0 ? '↓' : '↔'} ${Math.abs(t.delta)}%`}
              </text>
            </g>
          );
        })}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 16, fontSize: 11, color: 'var(--text-3)', marginTop: 6 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span className="dot" style={{ background: 'var(--pos)' }} /> Positivo dominante</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span className="dot" style={{ background: 'var(--neg)' }} /> Negativo dominante</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span className="dot" style={{ background: 'var(--warn)' }} /> Mixto</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span className="dot" style={{ background: 'var(--text-3)' }} /> Neutral</span>
      </div>
    </div>
  );
}

// --- List variant ---
function TopicList({ topics, onSelect }) {
  const sorted = [...topics].sort((a, b) => b.count - a.count);
  const max = Math.max(...sorted.map(t => t.count));
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '24px 2fr 80px 110px 1.2fr 70px 24px', gap: 12, padding: '8px 12px', fontSize: 10, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        <span>#</span><span>Tópico</span><span style={{ textAlign: 'right' }}>Menciones</span><span>Sentimiento</span><span>Distribución</span><span style={{ textAlign: 'right' }}>Δ</span><span />
      </div>
      {sorted.map((t, i) => (
        <button key={t.slug} onClick={() => onSelect(t.slug)} className="row-hover"
          style={{
            display: 'grid', gridTemplateColumns: '24px 2fr 80px 110px 1.2fr 70px 24px', gap: 12, alignItems: 'center',
            padding: '10px 12px', fontSize: 12, textAlign: 'left', cursor: 'pointer',
            borderTop: i > 0 ? '1px solid var(--hairline)' : '1px solid var(--hairline)',
            width: '100%',
          }}>
          <span className="mono" style={{ color: 'var(--text-3)', fontSize: 11 }}>{String(i+1).padStart(2,'0')}</span>
          <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <span style={{ fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
            {t.secondaryCount > 0 && (
              <span style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 500 }}>+{t.secondaryCount} también lo tocan</span>
            )}
          </span>
          <span className="num" style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(t.count)}</span>
          <span className={`pill ${t.dominantSentiment === 'positivo' ? 'pill-pos' : t.dominantSentiment === 'negativo' ? 'pill-neg' : 'pill-warn'}`} style={{ justifySelf: 'start' }}>{t.dominantSentiment}</span>
          <div style={{ position: 'relative', height: 14 }}>
            <div style={{ position: 'absolute', inset: '3px 0', background: 'var(--canvas-2)', borderRadius: 3 }} />
            <div style={{ position: 'absolute', inset: '3px 0', width: `${(t.count/max)*100}%`, borderRadius: 3, display: 'flex', overflow: 'hidden' }}>
              <div style={{ width: `${t.positivePct}%`, background: 'var(--pos)' }} />
              <div style={{ width: `${t.neutralPct}%`, background: 'var(--text-3)' }} />
              <div style={{ width: `${t.negativePct}%`, background: 'var(--neg)' }} />
            </div>
          </div>
          <span style={{ textAlign: 'right', fontSize: 11, fontWeight: 600,
            color: t.delta == null ? 'var(--text-3)' : t.delta > 0 ? 'var(--neg)' : t.delta < 0 ? 'var(--pos)' : 'var(--text-3)' }}>
            {t.delta == null ? '—' : `${t.delta > 0 ? '+' : ''}${t.delta}%`}
          </span>
          <Icons.ChevronRight size={14} color="var(--text-3)" />
        </button>
      ))}
    </div>
  );
}

// --- Drill-in: topic detail with subtopics + back ---
function TopicDetail({ topic, subs, onBack }) {
  const sentPill = topic.dominantSentiment === 'positivo' ? 'pill-pos' : topic.dominantSentiment === 'negativo' ? 'pill-neg' : 'pill-warn';
  const subMax = Math.max(1, ...subs.map(s => s.count));

  // --- (5) Descripción IA cacheada por periodo ----------------------
  // En vez de leer `topic.description` (que era un único string por tópico,
  // sobrescrito en cada corrida del cron y sin tracking de fechas), pedimos al
  // endpoint /api/eco-topic-description la descripción correspondiente al
  // periodo activo. Si está en caché → ready inmediato. Si no, el endpoint
  // invoca Bedrock síncronamente (~3-10s) y persiste; al volver, ya queda
  // guardada para futuras peticiones.
  const [desc, setDesc] = React.useState({ status: 'loading', text: null, generatedAt: null });
  React.useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    const agency = localStorage.getItem('eco.agency');
    const period = localStorage.getItem('eco.period') || '1M';
    const customFrom = localStorage.getItem('eco.from');
    const customTo = localStorage.getItem('eco.to');
    if (agency) params.set('agency', agency);
    if (period === 'custom' && customFrom && customTo) {
      params.set('from', customFrom);
      params.set('to', customTo);
    } else {
      params.set('period', period);
    }
    params.set('topic', topic.slug);
    setDesc({ status: 'loading', text: null, generatedAt: null });
    fetch('/api/eco-topic-description?' + params.toString(), { cache: 'no-store' })
      .then(r => r.json())
      .then(d => {
        if (cancelled) return;
        if (d.status === 'ready') setDesc({ status: 'ready', text: d.description, generatedAt: d.generatedAt });
        else if (d.status === 'empty') setDesc({ status: 'empty', text: null, generatedAt: null });
        else setDesc({ status: 'error', text: null, generatedAt: null });
      })
      .catch(() => { if (!cancelled) setDesc({ status: 'error', text: null, generatedAt: null }); });
    return () => { cancelled = true; };
  }, [topic.slug]);

  // --- (3) Tabla de menciones del tópico ----------------------------
  const [mentionsState, setMentionsState] = React.useState({ loading: true, mentions: [], total: 0 });
  const [page, setPage] = React.useState(1);
  const pageSize = 20;
  React.useEffect(() => {
    let cancelled = false;
    setMentionsState((s) => ({ ...s, loading: true }));
    fetchSliceMentions({ topic: topic.slug, limit: pageSize, offset: (page - 1) * pageSize })
      .then((r) => {
        if (cancelled) return;
        setMentionsState({ loading: false, mentions: r.mentions || [], total: r.total || 0 });
      })
      .catch(() => { if (!cancelled) setMentionsState({ loading: false, mentions: [], total: 0 }); });
    return () => { cancelled = true; };
  }, [topic.slug, page]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Breadcrumb + back */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button className="btn" onClick={onBack}>
          <Icons.ArrowLeft size={13} /> Volver a todos los tópicos
        </button>
        <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
          Tópicos / <span style={{ color: 'var(--text)', fontWeight: 600 }}>{topic.name}</span>
        </div>
      </div>

      {/* Hero stats */}
      <div className="card" style={{ padding: 20, display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 20, alignItems: 'center' }}>
        <div>
          <div className="section-eyebrow" style={{ marginBottom: 8 }}>Tópico</div>
          <div style={{ fontSize: 28, fontWeight: 700, fontFamily: 'var(--ff-display)', letterSpacing: 'var(--letter-display)', color: 'var(--text)' }}>{topic.name}</div>
          <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className={`pill ${sentPill}`}>{topic.dominantSentiment}</span>
            <span style={{ fontSize: 12, fontWeight: 600,
              color: topic.delta == null ? 'var(--text-3)' : topic.delta > 0 ? 'var(--neg)' : topic.delta < 0 ? 'var(--pos)' : 'var(--text-3)' }}>
              {topic.delta == null
                ? 'Sin base de comparación'
                : `${topic.delta > 0 ? '↑' : topic.delta < 0 ? '↓' : '↔'} ${Math.abs(topic.delta)}% vs. período anterior`}
            </span>
          </div>
        </div>
        <StatBox label="Menciones" value={fmt(topic.count)} />
        <StatBox label="Positivas" value={`${topic.positivePct}%`} tone="pos" />
        <StatBox label="Negativas" value={`${topic.negativePct}%`} tone="neg" />
      </div>

      {/* Descripción IA: cargada del endpoint cacheado por (topic_id,
          period_start, period_end). loading → muestra placeholder; ready →
          texto; empty → mensaje neutral; error → bloque oculto. */}
      <div className="card" style={{ padding: 18 }}>
        <div className="section-eyebrow" style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icons.Sparkles size={11} color="var(--accent)" /> Descripción IA · período seleccionado
        </div>
        {desc.status === 'loading' && (
          <div style={{ fontSize: 13, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 8, animation: 'pulse 1.4s ease-in-out infinite' }}>
            Generando descripción para este periodo…
          </div>
        )}
        {desc.status === 'ready' && (
          <div style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--text)' }}>{desc.text}</div>
        )}
        {desc.status === 'empty' && (
          <div style={{ fontSize: 13, color: 'var(--text-3)' }}>
            No hay menciones de este tópico en el periodo seleccionado, así que no se puede describir.
          </div>
        )}
        {desc.status === 'error' && (
          <div style={{ fontSize: 13, color: 'var(--text-3)' }}>
            No fue posible generar la descripción. Intenta más tarde.
          </div>
        )}
      </div>

      {/* Subtopics — ahora con descripción del cluster (qué cubre el subtopic)
          y pill de sentimiento dominante, para que el usuario entienda de qué
          va cada subtopic sin tener que abrir las menciones. */}
      <div className="card">
        <div className="card-hd">
          <div><div className="card-hd-title">Subtópicos detectados</div><div className="card-hd-sub">{subs.length} subtópicos · cluster del periodo seleccionado</div></div>
        </div>
        <div>
          {subs.length === 0 && <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>Sin subtópicos detectados en este periodo</div>}
          {subs.map((s, i) => {
            const subSentPill = s.dominantSentiment === 'positivo' ? 'pill-pos' : s.dominantSentiment === 'negativo' ? 'pill-neg' : 'pill-warn';
            return (
              <div key={s.slug || s.name} className="row-hover" style={{
                display: 'grid', gridTemplateColumns: '28px 2fr 110px 110px 1.4fr', gap: 12, alignItems: 'center',
                padding: '14px 18px', borderTop: '1px solid var(--hairline)', fontSize: 13,
              }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-3)' }} className="mono">{String(i+1).padStart(2,'0')}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: 'var(--text)' }}>{s.name}</div>
                  {s.description && (
                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4, lineHeight: 1.4 }}>{s.description}</div>
                  )}
                </div>
                <div className="num" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--text)' }}>{fmt(s.count)}</div>
                <span className={`pill ${subSentPill}`} style={{ justifySelf: 'start' }}>{s.dominantSentiment || 'mixed'}</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', background: 'var(--canvas-2)' }}>
                    <div style={{ flexGrow: Math.max(0, s.positivePct || 0), background: 'var(--pos)' }} />
                    <div style={{ flexGrow: Math.max(0, s.neutralPct  || 0), background: 'var(--text-3)' }} />
                    <div style={{ flexGrow: Math.max(0, s.negativePct || 0), background: 'var(--neg)' }} />
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--text-3)', display: 'flex', justifyContent: 'space-between' }}>
                    <span>{s.positivePct || 0}% pos</span>
                    <span>{s.negativePct || 0}% neg</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Evolution — datos reales por tópico (mention_topics × día AST). */}
      <div className="card">
        <div className="card-hd"><div><div className="card-hd-title">Evolución del tópico</div><div className="card-hd-sub">Menciones reales (zona AST)</div></div></div>
        <div className="card-bd">
          {(topic.evolution && topic.evolution.length > 0) ? (
            <AreaLineChart data={topic.evolution} accessor={(d) => d.count} height={200} color="var(--accent)" />
          ) : (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
              Sin menciones registradas para este tópico en este periodo.
            </div>
          )}
        </div>
      </div>

      {/* (3) Menciones del tópico — tabla paginada del periodo activo. */}
      <div className="card">
        <div className="card-hd">
          <div>
            <div className="card-hd-title">Menciones del tópico</div>
            <div className="card-hd-sub">
              {mentionsState.loading
                ? 'Cargando…'
                : `${fmt(mentionsState.total)} menciones · página ${page} de ${Math.max(1, Math.ceil(mentionsState.total / pageSize))}`}
            </div>
          </div>
        </div>
        <div>
          {mentionsState.loading && (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>Cargando menciones…</div>
          )}
          {!mentionsState.loading && mentionsState.mentions.length === 0 && (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
              Sin menciones para este tópico en el periodo seleccionado.
            </div>
          )}
          {!mentionsState.loading && mentionsState.mentions.length > 0 && (
            <MentionsTable mentions={mentionsState.mentions} onMentionClick={() => {}} />
          )}
        </div>
        {!mentionsState.loading && mentionsState.total > pageSize && (
          <div style={{ padding: 12, borderTop: '1px solid var(--hairline)', display: 'flex', justifyContent: 'center' }}>
            <Pagination
              page={page}
              totalPages={Math.max(1, Math.ceil(mentionsState.total / pageSize))}
              onChange={setPage}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function StatBox({ label, value, tone }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</div>
      <div className="num" style={{ fontSize: 30, fontWeight: 600, color: tone ? `var(--${tone})` : 'var(--text)', marginTop: 4, fontFamily: 'var(--ff-display)' }}>{value}</div>
    </div>
  );
}

// --- Calendar of "main topic of the day" ---
function TopicCalendar({ data, onSelect, onDayClick }) {
  // Color per topic slug — consistent hues
  const palette = ['#E1767B', '#4A7FB5', '#6B9E7F', '#C08457', '#8B6BB0', '#D4A73E', '#5A9FA8', '#A3624D'];
  const slugIdx = {};
  D.TOPICS.forEach((t, i) => { slugIdx[t.slug] = i; });
  const colorFor = (slug) => palette[slugIdx[slug] % palette.length];

  if (!data || data.length === 0) {
    return (
      <div className="card">
        <div className="card-hd"><div><div className="card-hd-title">Calendario de tópicos</div><div className="card-hd-sub">Tópico principal y volumen del día · período seleccionado</div></div></div>
        <div className="card-bd" style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
          Sin actividad de tópicos en este periodo.
        </div>
      </div>
    );
  }

  // Build a 7-col week grid starting on the first day's weekday (Monday-first)
  const parsed = data.map(d => {
    const dt = new Date(d.fullDate);
    return { ...d, dt };
  });
  const first = parsed[0].dt;
  const last = parsed[parsed.length - 1].dt;
  const firstDow = (first.getDay() + 6) % 7; // Monday-first: 0..6
  const cells = Array(firstDow).fill(null).concat(parsed);

  // Agrupar en filas de 7 días (semanas). En cada salto de fila, si el día
  // que comienza la fila (o cualquier día en ella) pertenece a un mes distinto
  // del último mes etiquetado, insertamos un header con el nuevo mes — así el
  // calendario sigue legible cuando el periodo cubre varios meses.
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }

  // Volume scale
  const maxV = Math.max(...parsed.map(d => d.volume));

  // Legend = unique topics present in calendar
  const uniqueTopics = [...new Set(parsed.map(d => d.topicSlug))].map(s => D.TOPICS.find(t => t.slug === s)).filter(Boolean);

  const sameMonth = first.getFullYear() === last.getFullYear() && first.getMonth() === last.getMonth();
  const headerLabel = sameMonth
    ? first.toLocaleDateString('es', { month: 'long', year: 'numeric' })
    : `${first.toLocaleDateString('es', { month: 'short', year: 'numeric' })} – ${last.toLocaleDateString('es', { month: 'short', year: 'numeric' })}`;

  let lastMonthLabel = null;
  return (
    <div className="card">
      <div className="card-hd">
        <div>
          <div className="card-hd-title">Calendario de tópicos</div>
          <div className="card-hd-sub">Tópico principal y volumen del día · período seleccionado</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icons.CalendarDays size={14} color="var(--text-3)" />
          <span style={{ fontSize: 12, color: 'var(--text-2)', textTransform: 'capitalize' }}>{headerLabel}</span>
        </div>
      </div>
      <div className="card-bd" style={{ display: 'grid', gridTemplateColumns: '1fr 200px', gap: 20 }}>
        {/* Grid */}
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 4 }}>
            {['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].map(d => (
              <div key={d} style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em', textAlign: 'center', paddingBottom: 4 }}>{d}</div>
            ))}
          </div>
          {weeks.map((week, wIdx) => {
            // Etiqueta de mes para esta fila: si alguno de los días pertenece
            // a un mes nuevo que aún no etiquetamos, lo mostramos arriba de
            // la fila. Esto marca claramente el cambio mes-a-mes en periodos
            // largos como 1A/Max.
            const firstReal = week.find(d => d);
            const monthKey = firstReal ? `${firstReal.dt.getFullYear()}-${firstReal.dt.getMonth()}` : null;
            const showHeader = monthKey && monthKey !== lastMonthLabel;
            if (showHeader) lastMonthLabel = monthKey;
            const monthName = firstReal ? firstReal.dt.toLocaleDateString('es', { month: 'long', year: 'numeric' }) : '';

            return (
              <React.Fragment key={`w${wIdx}`}>
                {showHeader && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    marginTop: wIdx === 0 ? 0 : 10, marginBottom: 4,
                    fontSize: 10, fontWeight: 700, color: 'var(--text-2)',
                    textTransform: 'uppercase', letterSpacing: '0.08em',
                  }}>
                    <span style={{ flex: '0 0 auto' }}>{monthName}</span>
                    <span style={{ flex: 1, height: 1, background: 'var(--hairline)' }} />
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 4 }}>
                  {week.map((c, i) => {
                    if (!c) return <div key={`e${wIdx}-${i}`} />;
                    const color = colorFor(c.topicSlug);
                    const intensity = 0.3 + (c.volume / maxV) * 0.7;
                    const dayNum = c.dt.getDate();
                    const isFirstOfMonth = dayNum === 1;
                    return (
                      <button key={c.date} onClick={() => onDayClick(c)}
                        title={`${c.dt.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'short' })} · ${c.topicName} · ${fmt(c.volume)} menciones`}
                        style={{
                          position: 'relative',
                          aspectRatio: '1 / 1', minHeight: 62,
                          padding: 6,
                          borderRadius: 6,
                          background: `${color}${Math.round(intensity * 255).toString(16).padStart(2, '0')}`,
                          // Borde más marcado en el primer día del mes para
                          // reforzar el cambio cuando ocurre mid-week.
                          border: isFirstOfMonth ? '1.5px solid var(--text-2)' : '1px solid var(--hairline)',
                          display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
                          textAlign: 'left', cursor: 'pointer',
                          overflow: 'hidden',
                        }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                          <span className="mono" style={{ fontSize: 10, fontWeight: 700, color: intensity > 0.65 ? '#fff' : 'var(--text)' }}>{dayNum}</span>
                          {c.sentiment === 'negativo' && <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--neg)' }} />}
                          {c.sentiment === 'positivo' && <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--pos)' }} />}
                        </div>
                        <div style={{ fontSize: 9, fontWeight: 700, color: intensity > 0.65 ? '#fff' : 'var(--text)', lineHeight: 1.1, textTransform: 'uppercase', letterSpacing: '0.02em', wordBreak: 'break-word' }}>
                          {c.topicName.length > 14 ? c.topicName.slice(0, 13) + '…' : c.topicName}
                        </div>
                        <div className="num" style={{ fontSize: 10, fontWeight: 600, color: intensity > 0.65 ? 'rgba(255,255,255,0.9)' : 'var(--text-2)' }}>{fmt(c.volume)}</div>
                      </button>
                    );
                  })}
                </div>
              </React.Fragment>
            );
          })}
        </div>

        {/* Legend */}
        <div style={{ borderLeft: '1px solid var(--hairline)', paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="section-eyebrow" style={{ margin: 0 }}>Leyenda</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {uniqueTopics.map(t => (
              <button key={t.slug} onClick={() => onSelect(t.slug)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', borderRadius: 6, textAlign: 'left', cursor: 'pointer' }} className="row-hover">
                <span style={{ width: 10, height: 10, borderRadius: 3, background: colorFor(t.slug) }} />
                <span style={{ fontSize: 11, color: 'var(--text)', flex: 1 }}>{t.name}</span>
              </button>
            ))}
          </div>
          <div style={{ borderTop: '1px solid var(--hairline)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 10, color: 'var(--text-3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ display: 'flex', gap: 2 }}>
                <span style={{ width: 8, height: 8, background: '#4A7FB54D' }} />
                <span style={{ width: 8, height: 8, background: '#4A7FB599' }} />
                <span style={{ width: 8, height: 8, background: '#4A7FB5FF' }} />
              </span>
              Opacidad = volumen
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--neg)' }} />
              Día con sentimiento negativo dominante
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, border: '1.5px solid var(--text-2)', borderRadius: 2 }} />
              Primer día del mes
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Slice builder: generate a plausible mentions slice from aggregate info ---
// Local filter over the cached MENTIONS list. Used only as the initial
// optimistic slice while the async fetch from /api/eco-mentions is in flight.
// No "extras" padding — irrelevant mentions must never appear.
function buildSliceMentions(predicate, max = 8) {
  return (D.MENTIONS || []).filter(predicate).slice(0, max);
}

// Fetch a real slice of mentions from the backend using the structured filter.
// The slice object must carry a `_filter` hash of query params.
function fetchSliceMentions(filter) {
  const params = new URLSearchParams();
  const agency = localStorage.getItem('eco.agency');
  const period = localStorage.getItem('eco.period') || '1M';
  if (agency) params.set('agency', agency);
  params.set('period', period);
  params.set('limit', '20');
  for (const [k, v] of Object.entries(filter || {})) {
    if (v == null || v === '') continue;
    params.set(k, String(v));
  }
  return fetch('/api/eco-mentions?' + params.toString(), { cache: 'no-store' })
    .then((r) => r.ok ? r.json() : { mentions: [], total: 0, sentiment: { pos: 0, neu: 0, neg: 0 } })
    .catch(() => ({ mentions: [], total: 0, sentiment: { pos: 0, neu: 0, neg: 0 } }));
}

function splitSentiment(total, bias = 'neutral') {
  const biases = {
    positivo: [0.55, 0.25, 0.20],
    negativo: [0.22, 0.28, 0.50],
    neutral:  [0.38, 0.40, 0.22],
  };
  const [p, n, ng] = biases[bias] || biases.neutral;
  const pos = Math.round(total * p);
  const neg = Math.round(total * ng);
  const neu = Math.max(0, total - pos - neg);
  return { pos, neu, neg };
}

// =============== GEOGRAPHY ===============
function GeographyScreen({ onMentionClick }) {
  const [metric, setMetric] = useState('count');
  const [slice, setSlice] = useState(null);
  // Filtros de contenido: fuente / tópico / subtópico. El mapa se re-consulta a
  // /api/eco-geo cuando cambian; D.MUNICIPALITIES (boot) es solo el estado inicial.
  const [filters, setFilters] = useState({ source: 'all', topic: '', subtopic: '' });
  const [munis, setMunis] = useState(D.MUNICIPALITIES || []);
  const [loadingGeo, setLoadingGeo] = useState(false);

  // Filtros activos (sin defaults), para fusionar en cada _filter de drill-in y
  // en la query de /api/eco-geo. Subtópico va por NOMBRE (contrato eco-mentions).
  const contentFilter = React.useMemo(() => {
    const f = {};
    if (filters.source && filters.source !== 'all') f.source = filters.source;
    if (filters.topic) f.topic = filters.topic;
    if (filters.subtopic) f.subtopic = filters.subtopic;
    return f;
  }, [filters]);
  const hasFilters = !!(contentFilter.source || contentFilter.topic || contentFilter.subtopic);

  // Re-consulta la agregación por municipio cuando cambian los filtros.
  React.useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    const agency = localStorage.getItem('eco.agency');
    const period = localStorage.getItem('eco.period') || '1M';
    if (agency) params.set('agency', agency);
    if (period === 'custom') {
      const from = localStorage.getItem('eco.from');
      const to = localStorage.getItem('eco.to');
      if (from) params.set('from', from);
      if (to) params.set('to', to);
    } else {
      params.set('period', period);
    }
    for (const [k, v] of Object.entries(contentFilter)) params.set(k, String(v));
    setLoadingGeo(true);
    fetch('/api/eco-geo?' + params.toString(), { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { municipalities: null }))
      .then((d) => { if (!cancelled && Array.isArray(d.municipalities)) setMunis(d.municipalities); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingGeo(false); });
    return () => { cancelled = true; };
  }, [contentFilter]);

  function openMuniSlice(m) {
    const senti = splitSentiment(m.count, m.nss > 2 ? 'positivo' : m.nss < -2 ? 'negativo' : 'neutral');
    const accent = m.nss > 2 ? 'var(--pos)' : m.nss < -2 ? 'var(--neg)' : 'var(--warn)';
    setSlice({
      eyebrow: `${m.region} · ${m.name}`,
      title: `NSS ${m.nss > 0 ? '+' : ''}${m.nss.toFixed(1)}`,
      accent,
      volume: m.count,
      sentiment: senti,
      mentions: [],
      _filter: { municipality: m.slug, ...contentFilter },
    });
  }

  // If the user came here from a MentionDrawer "Ver en mapa" action, auto-open
  // the slice modal for the requested municipality. The focus is only honored
  // if set within the last 30 seconds, so a stale focus never re-triggers.
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem('eco.map.focus');
      if (!raw) return;
      const focus = JSON.parse(raw);
      localStorage.removeItem('eco.map.focus');
      if (!focus || !focus.slug || (Date.now() - (focus.ts || 0)) > 30_000) return;
      const muni = (D.MUNICIPALITIES || []).find((m) => m.slug === focus.slug
        || (m.name || '').toLowerCase() === (focus.name || '').toLowerCase());
      if (muni) openMuniSlice(muni);
      else {
        setSlice({
          eyebrow: 'Región',
          title: focus.name || focus.slug,
          accent: 'var(--accent)',
          mentions: [],
          _filter: { municipality: focus.slug },
        });
      }
    } catch (_) {}
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card">
        <div className="card-hd">
          <div><div className="card-hd-title">Distribución geográfica · Puerto Rico</div><div className="card-hd-sub">78 municipios monitoreados · click un municipio para ver menciones</div></div>
          <div style={{ display: 'flex', gap: 6 }}>
            {[{ k: 'count', l: 'Volumen' }, { k: 'nss', l: 'Sentimiento' }].map((o) => (
              <button key={o.k} onClick={() => setMetric(o.k)} className={`chip ${metric === o.k ? 'active' : ''}`}>{o.l}</button>
            ))}
          </div>
        </div>
        <div className="card-bd" style={{ padding: 24 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
            <SourceSelect value={filters.source} onChange={(e) => setFilters((f) => ({ ...f, source: e.target.value }))} style={{ minWidth: 150 }} />
            <select className="input" value={filters.topic} style={{ minWidth: 160 }}
              onChange={(e) => setFilters((f) => ({ ...f, topic: e.target.value, subtopic: '' }))}>
              <option value="">Todos los tópicos</option>
              {(D.TOPICS || []).filter((t) => t && t.slug).map((t) => <option key={t.slug} value={t.slug}>{t.name}</option>)}
            </select>
            <select className="input" value={filters.subtopic} disabled={!filters.topic}
              style={{ minWidth: 170, opacity: filters.topic ? 1 : 0.5 }}
              onChange={(e) => setFilters((f) => ({ ...f, subtopic: e.target.value }))}>
              <option value="">{filters.topic ? 'Todos los subtópicos' : 'Subtópico (elige tópico)'}</option>
              {filters.topic && (((D.SUBTOPICS || {})[filters.topic]) || []).map((st) => <option key={st.slug || st.name} value={st.name}>{st.name}</option>)}
            </select>
            {hasFilters && <button className="chip" onClick={() => setFilters({ source: 'all', topic: '', subtopic: '' })}>Limpiar</button>}
            {loadingGeo && <span style={{ fontSize: 11, color: 'var(--text-3)' }}>Actualizando…</span>}
          </div>
          <PRMap
            municipalities={munis}
            accessor={(m) => metric === 'count' ? m.count : Math.abs(m.nss)}
            colorFn={(m) => metric === 'nss' ? (m.nss > 2 ? 'var(--pos)' : m.nss < -2 ? 'var(--neg)' : 'var(--warn)') : 'var(--accent)'}
            onMunicipalityClick={openMuniSlice}
          />
          <div style={{ display: 'flex', justifyContent: 'center', gap: 20, fontSize: 11, color: 'var(--text-2)', marginTop: 16 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span className="dot" style={{ background: metric === 'nss' ? 'var(--pos)' : 'var(--accent)' }} /> {metric === 'nss' ? 'Positivo (>+2)' : 'Volumen'}</span>
            {metric === 'nss' && <>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span className="dot" style={{ background: 'var(--warn)' }} /> Neutral</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span className="dot" style={{ background: 'var(--neg)' }} /> Negativo (&lt;-2)</span>
            </>}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="card">
          <div className="card-hd"><div><div className="card-hd-title">Top municipios</div><div className="card-hd-sub">Por volumen de menciones</div></div></div>
          <div className="card-bd">
            <HBarList
              items={[...munis].sort((a,b)=>b.count-a.count).slice(0,8).map(m => ({ label: m.name, value: m.count, nss: m.nss, _muni: m }))}
              colorFn={() => 'var(--accent)'}
              onItemClick={(it) => openMuniSlice(it._muni)}
            />
          </div>
        </div>

        <div className="card">
          <div className="card-hd"><div><div className="card-hd-title">Sentimiento por región</div><div className="card-hd-sub">NSS agregado</div></div></div>
          <div className="card-bd" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[...new Set((munis || []).map((m) => m.region).filter(Boolean))].map((r, i) => {
              const regionMunis = munis.filter(m => m.region === r);
              if (regionMunis.length === 0) return null;
              const avgNss = regionMunis.reduce((s,m) => s+m.nss, 0) / regionMunis.length;
              const total = regionMunis.reduce((s,m) => s+m.count, 0);
              const pct = Math.max(-1, Math.min(1, avgNss / 10));
              return (
                <button key={r}
                  onClick={() => {
                    setSlice({
                      eyebrow: `Región · ${r}`,
                      title: `Sentimiento en ${r}`,
                      accent: avgNss > 0 ? 'var(--pos)' : 'var(--neg)',
                      mentions: [],
                      _filter: { region: r, ...contentFilter },
                    });
                  }}
                  className="row-hover"
                  style={{ padding: '10px 12px', background: 'var(--canvas-2)', borderRadius: 8, border: 'none', width: '100%', textAlign: 'left', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>{r}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-3)' }}>{regionMunis.length} municipios · {fmt(total)} menciones</div>
                    </div>
                    <div className="num" style={{ fontSize: 16, fontWeight: 600, color: avgNss > 0 ? 'var(--pos)' : 'var(--neg)' }}>
                      {avgNss > 0 ? '+' : ''}{avgNss.toFixed(1)}
                    </div>
                  </div>
                  <div style={{ position: 'relative', height: 4, background: 'var(--hairline)' }}>
                    <div style={{ position: 'absolute', left: '50%', top: -2, bottom: -2, width: 1, background: 'var(--text-3)' }} />
                    <div style={{ position: 'absolute', left: pct > 0 ? '50%' : `${50 + pct*50}%`, width: `${Math.abs(pct)*50}%`, height: '100%', background: pct > 0 ? 'var(--pos)' : 'var(--neg)' }} />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {slice && <MentionsSliceModal slice={slice} onClose={() => setSlice(null)} onMentionClick={onMentionClick} />}
    </div>
  );
}

// =============== CRISIS ALERTS TAB (embed de /settings/alerts) ===============
// Configurador de la regla `crisis_threshold`: umbrales, cooldown y destinatarios.
// El backend es metrics-calculator (cron c/10 min). Aquí solo se persiste la regla
// en alert_rules; la próxima evaluación la lee automáticamente.
function CrisisAlertsTab() {
  const [config, setConfig] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const iframeRef = useRef(null);

  const reloadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [cfg, hist] = await Promise.all([
        fetch('/api/alerts/crisis-config?agencySlug=ddecpr').then((r) => r.ok ? r.json() : Promise.reject(r.statusText)),
        fetch('/api/alerts/history?agencySlug=ddecpr&limit=10').then((r) => r.ok ? r.json() : { history: [] }).catch(() => ({ history: [] })),
      ]);
      setConfig(cfg.config ?? null);
      setHistory(hist.history ?? []);
    } catch (err) {
      console.error('crisis tab load failed', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reloadAll(); }, [reloadAll]);

  const isActive = config?.isActive ?? false;
  const crisisMin = config?.crisisMin ?? 0.40;
  const cooldownHours = config?.cooldownHours ?? 12;
  const recipientsCount = config?.notifyEmails?.length ?? 0;
  const lastFire = history[0] || null;
  const lastFireLabel = lastFire ? new Date(lastFire.triggeredAt).toLocaleString('es-PR', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* KPIs operativos */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <KpiCard
          label="Estado del disparador"
          value={loading ? '…' : (isActive ? 'Activo' : 'Inactivo')}
          sub={isActive ? 'evalúa cada 10 min' : 'no se enviarán alertas'}
          icon="Bell"
          accent={isActive ? 'var(--pos)' : 'var(--text-3)'}
        />
        <KpiCard
          label="Umbral de disparo"
          value={loading ? '…' : crisisMin.toFixed(2)}
          sub="Crisis Score (0–1)"
          icon="Shield"
          accent="var(--neg)"
        />
        <KpiCard
          label="Cooldown"
          value={loading ? '…' : `${cooldownHours}h`}
          sub="entre alertas"
          icon="Calendar"
          accent="var(--text-2)"
        />
        <KpiCard
          label="Destinatarios"
          value={loading ? '…' : String(recipientsCount)}
          sub={lastFire ? `último: ${lastFireLabel.split(',')[0]}` : 'sin envíos aún'}
          icon="Mail"
          accent="var(--text-2)"
        />
      </div>

      {/* Form embebido */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="card-hd">
          <div>
            <div className="card-hd-title">Configuración de la alerta de crisis</div>
            <div className="card-hd-sub">Edita umbrales, cooldown y destinatarios. Los cambios aplican desde el siguiente ciclo (≤ 10 min).</div>
          </div>
          <button className="chip" onClick={() => { reloadAll(); if (iframeRef.current) iframeRef.current.src = iframeRef.current.src; }}>
            Recargar
          </button>
        </div>
        <iframe
          ref={iframeRef}
          src="/settings/alerts?embed=1"
          title="Configuración de alertas de crisis"
          style={{
            width: '100%',
            height: 1100,
            border: 'none',
            background: 'transparent',
            display: 'block',
          }}
        />
      </div>
    </div>
  );
}

// =============== REPORTS TAB (embed de /settings/reports) ===============
// Esta pestaña vive dentro de Alertas y embebe la página real de configuración
// de reportes (Next.js) vía iframe. Muestra KPIs operativos arriba (próximo
// envío, destinatarios activos, último envío) y luego el form embebido.
function ReportsTab() {
  const [config, setConfig] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const iframeRef = useRef(null);

  // Reload el iframe cuando guardamos config en otro lado, así los KPIs y el
  // form se mantienen sincronizados. La carga inicial es cuando entras al tab.
  const reloadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [cfg, hist] = await Promise.all([
        fetch('/api/reports/config?agencySlug=ddecpr').then((r) => r.ok ? r.json() : Promise.reject(r.statusText)),
        fetch('/api/reports/history?agencySlug=ddecpr&limit=14').then((r) => r.ok ? r.json() : { history: [] }),
      ]);
      setConfig(cfg.config ?? null);
      setHistory(hist.history ?? []);
    } catch (err) {
      console.error('reports tab load failed', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reloadAll(); }, [reloadAll]);

  // Próximo envío estimado: hoy o mañana a sendHourLocal en el timezone local.
  const nextSendLabel = useMemo(() => {
    if (!config || !config.isActive) return '—';
    const tz = config.timezone || 'America/Puerto_Rico';
    const hour = config.sendHourLocal ?? 6;
    const now = new Date();
    // Hora actual en el TZ destino
    const localHour = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, hour: '2-digit' }).format(now), 10);
    const localMins = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, minute: '2-digit' }).format(now), 10);
    let target = new Date(now);
    target.setMinutes(0, 0, 0);
    const isToday = localHour < hour;
    target.setHours(target.getHours() + (isToday ? (hour - localHour) : (24 - localHour + hour)));
    target.setMinutes(target.getMinutes() - localMins);
    const diffMs = target - now;
    const hrs = Math.floor(diffMs / 3600000);
    const mins = Math.floor((diffMs % 3600000) / 60000);
    const fmtTime = `${String(hour).padStart(2, '0')}:00`;
    const dayLabel = isToday ? 'hoy' : 'mañana';
    return `${dayLabel} ${fmtTime} · en ${hrs}h ${mins}m`;
  }, [config]);

  const lastSend = history[0] || null;
  const lastSendLabel = lastSend ? new Date(lastSend.sentAt).toLocaleString('es-PR', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
  const lastSendStatus = lastSend ? lastSend.status : null;
  const recipientsCount = config?.recipients?.length ?? 0;
  const tzLabel = config?.timezone === 'America/Puerto_Rico' ? 'San Juan (AST)' : (config?.timezone ?? '—');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* KPI strip propio del tab */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <KpiCard
          label="Estado del envío"
          value={loading ? '…' : (config?.isActive ? 'Activo' : 'Pausado')}
          icon={config?.isActive ? 'Check' : 'Pause'}
          accent={config?.isActive ? 'var(--pos)' : 'var(--text-3)'}
          sub={tzLabel}
        />
        <KpiCard
          label="Próximo envío"
          value={loading ? '…' : nextSendLabel.split(' · ')[0]}
          sub={loading ? '' : (nextSendLabel.split(' · ')[1] || '')}
          icon="Calendar"
          accent="var(--accent)"
        />
        <KpiCard
          label="Destinatarios"
          value={loading ? '…' : String(recipientsCount)}
          icon="Mail"
          accent="var(--text-2)"
          sub="agencia DDEC"
        />
        <KpiCard
          label="Último envío"
          value={lastSend ? lastSendLabel.split(',')[0] : '—'}
          sub={lastSendStatus ? `estado: ${lastSendStatus}` : 'sin envíos aún'}
          icon="Eye"
          accent={lastSendStatus === 'sent' ? 'var(--pos)' : (lastSendStatus === 'failed' ? 'var(--neg)' : 'var(--text-3)')}
        />
      </div>

      {/* Form embebido vía iframe */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="card-hd">
          <div>
            <div className="card-hd-title">Configuración del correo semanal</div>
            <div className="card-hd-sub">Edita destinatarios, hora de envío, zona horaria y plantilla. Los cambios se guardan vía “Guardar cambios”.</div>
          </div>
          <button className="chip" onClick={() => { reloadAll(); if (iframeRef.current) iframeRef.current.src = iframeRef.current.src; }}>
            Recargar
          </button>
        </div>
        <iframe
          ref={iframeRef}
          src="/settings/reports?embed=1"
          title="Configuración de reportes por correo"
          style={{
            width: '100%',
            height: 1200,
            border: 'none',
            background: 'transparent',
            display: 'block',
          }}
        />
      </div>
    </div>
  );
}

// =============== ALERTS ===============
function AlertsScreen({ onMentionClick }) {
  const [tab, setTab] = useState('feed');
  const [slice, setSlice] = useState(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [toast, setToast] = useState(null); // { kind, text }
  // Local overrides for feed event state (attended / muted) — since these are
  // user acknowledgements that don't persist yet to the backend.
  const [attended, setAttended] = useState(() => new Set());
  const [muted, setMuted] = useState(() => new Map()); // ruleName -> expiresAt
  // Local overrides for rule active toggle (same reason).
  const [ruleActive, setRuleActive] = useState(() => {
    const m = {};
    (D.ALERTS || []).forEach((a) => { m[a.id] = a.active; });
    return m;
  });

  function fireToast(kind, text) {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 3600);
  }

  function openAlertSlice(a) {
    const accent = a.severity === 'alta' ? 'var(--neg)' : 'var(--warn)';
    // Alert rules don't have a deterministic mention filter today. Best
    // approximation: show high-severity recent negatives / lower-severity
    // all mentions. A future task will persist each alert firing with the
    // actual matched mention IDs.
    const filter = a.severity === 'alta' ? { sentiment: 'negativo' } : {};
    setSlice({
      eyebrow: `Alerta · ${a.time} · severidad ${a.severity}`,
      title: a.rule,
      accent,
      mentions: [],
      _filter: filter,
      ctaLabel: 'Marcar atendida',
      ctaIcon: 'Check',
      onCta: () => setSlice(null),
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <KpiCard label="Alertas activas" value="6" icon="Bell" accent="var(--accent)" />
        <KpiCard label="Disparadas · 24h" value="4" delta={50} sub="vs ayer" icon="Zap" accent="var(--neg)" invertDelta />
        <KpiCard label="Reglas configuradas" value="7" icon="Shield" accent="var(--text-2)" />
        <KpiCard label="Tiempo mediano respuesta" value="8m" delta={-2} sub="min" icon="Activity" accent="var(--pos)" invertDelta />
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={() => setTab('feed')} className={`chip ${tab === 'feed' ? 'active' : ''}`}>Feed en vivo</button>
        <button onClick={() => setTab('rules')} className={`chip ${tab === 'rules' ? 'active' : ''}`}>Reglas</button>
        <button onClick={() => setTab('crisis')} className={`chip ${tab === 'crisis' ? 'active' : ''}`}>Alertas de crisis</button>
        <button onClick={() => setTab('history')} className={`chip ${tab === 'history' ? 'active' : ''}`}>Historial</button>
        <button onClick={() => setTab('reports')} className={`chip ${tab === 'reports' ? 'active' : ''}`}>Reportes por correo</button>
        <div style={{ flex: 1 }} />
        {tab !== 'reports' && tab !== 'crisis' && (
          <button className="btn btn-primary" onClick={() => setEditorOpen(true)}><Icons.Plus size={13} /> Nueva regla</button>
        )}
      </div>

      {tab === 'feed' && (
        <div className="card">
          <div className="card-hd"><div><div className="card-hd-title">Feed cronológico</div><div className="card-hd-sub">Eventos de las últimas 24 horas</div></div></div>
          <div>
            {D.ALERT_FEED.map((a, i) => (
              <div key={a.id} style={{ display: 'flex', gap: 14, padding: '14px 18px', borderTop: i > 0 ? '1px solid var(--hairline)' : 'none' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
                  <span className={a.severity === 'alta' ? 'ring-pulse' : ''} style={{ width: 10, height: 10, borderRadius: '50%', background: a.severity === 'alta' ? 'var(--neg)' : 'var(--warn)' }} />
                  {i < D.ALERT_FEED.length - 1 && <div style={{ flex: 1, width: 1, background: 'var(--hairline)', marginTop: 4 }} />}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span className={`pill ${a.severity === 'alta' ? 'pill-neg' : 'pill-warn'}`}>{a.severity}</span>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{a.rule}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-3)' }}>{a.time}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-2)' }}>{a.detail}</div>
                  <div style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center' }}>
                    <button className="chip" onClick={() => openAlertSlice(a)}>Ver menciones</button>
                    <button className={`chip ${attended.has(a.id) ? 'active' : ''}`}
                      onClick={() => setAttended((s) => new Set(s).add(a.id))}
                      disabled={attended.has(a.id)}>
                      {attended.has(a.id) ? '✓ Atendida' : 'Marcar atendida'}
                    </button>
                    <button className={`chip ${muted.has(a.rule) ? 'active' : ''}`}
                      onClick={() => setMuted((m) => { const n = new Map(m); n.set(a.rule, Date.now() + 3600000); return n; })}
                      disabled={muted.has(a.rule)}>
                      {muted.has(a.rule) ? '🔕 Silenciada 1h' : 'Silenciar regla 1h'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'rules' && (
        <div className="card">
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 80px 80px 80px 120px 120px 30px', gap: 12, padding: '10px 16px', fontSize: 10, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', borderBottom: '1px solid var(--hairline)' }}>
            <span>Regla</span><span>Prioridad</span><span style={{ textAlign: 'right' }}>Disparos 30d</span><span>Estado</span><span>Canales</span><span>Último</span><span />
          </div>
          {D.ALERTS.map((a) => (
            <div key={a.id} style={{ display: 'grid', gridTemplateColumns: '2fr 80px 80px 80px 120px 120px 30px', gap: 12, alignItems: 'center', padding: '14px 16px', borderTop: '1px solid var(--hairline)', fontSize: 12 }}>
              <span style={{ fontWeight: 500 }}>{a.name}</span>
              <span className={`pill ${a.priority === 'alta' ? 'pill-neg' : a.priority === 'media' ? 'pill-warn' : 'pill-neu'}`} style={{ justifySelf: 'start' }}>{a.priority}</span>
              <span className="num" style={{ textAlign: 'right', fontWeight: 600 }}>{a.triggered}</span>
              <label
                onClick={() => setRuleActive((s) => ({ ...s, [a.id]: !s[a.id] }))}
                style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, cursor: 'pointer' }}>
                <div style={{ width: 28, height: 16, borderRadius: 10, background: ruleActive[a.id] ? 'var(--pos)' : 'var(--hairline-strong)', position: 'relative', transition: 'all 0.2s' }}>
                  <div style={{ position: 'absolute', top: 2, left: ruleActive[a.id] ? 14 : 2, width: 12, height: 12, borderRadius: '50%', background: '#fff', transition: 'all 0.2s' }} />
                </div>
                <span style={{ color: ruleActive[a.id] ? 'var(--pos)' : 'var(--text-3)' }}>{ruleActive[a.id] ? 'Activa' : 'Inactiva'}</span>
              </label>
              <div style={{ display: 'flex', gap: 4 }}>
                {a.channels.map((c) => {
                  const IconC = { email: Icons.Mail, slack: Icons.Slack, sms: Icons.Phone }[c];
                  return <span key={c} title={c} style={{ width: 24, height: 24, borderRadius: 4, background: 'var(--canvas-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><IconC size={11} color="var(--text-2)" /></span>;
                })}
              </div>
              <span style={{ color: 'var(--text-3)', fontSize: 11 }}>{a.lastFired}</span>
              <Icons.More size={14} color="var(--text-3)" />
            </div>
          ))}
        </div>
      )}

      {tab === 'history' && <AlertsHistory onMentionClick={onMentionClick} />}

      {tab === 'crisis' && <CrisisAlertsTab />}

      {tab === 'reports' && <ReportsTab />}

      {slice && <MentionsSliceModal slice={slice} onClose={() => setSlice(null)} onMentionClick={onMentionClick} />}
      {editorOpen && (
        <AlertRuleEditor
          topics={D.TOPICS || []}
          onClose={() => setEditorOpen(false)}
          onSaved={() => { setEditorOpen(false); fireToast('ok', 'Regla creada.'); setTab('rules'); }}
          onError={(m) => fireToast('err', m || 'No se pudo guardar la regla')}
        />
      )}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 2200,
          background: toast.kind === 'err' ? 'var(--neg-bg)' : 'var(--pos-bg)',
          color: toast.kind === 'err' ? 'var(--neg)' : 'var(--pos)',
          padding: '10px 16px', borderRadius: 8, border: '1px solid var(--hairline)',
          boxShadow: '0 10px 30px rgba(0,0,0,0.25)', fontSize: 12, fontWeight: 600,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span className="dot" style={{ background: 'currentColor' }} />
          {toast.text}
        </div>
      )}
    </div>
  );
}

// --- AlertRuleEditor ---
function AlertRuleEditor({ topics, onClose, onSaved, onError }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [topic, setTopic] = useState('');
  const [sentiment, setSentiment] = useState('any');
  const [pertinence, setPertinence] = useState('any');
  const [minVolume, setMinVolume] = useState(5);
  const [windowMinutes, setWindowMinutes] = useState(60);
  const [emailsText, setEmailsText] = useState('');
  const [saving, setSaving] = useState(false);

  // Cerrar con Escape (mismo patrón que CommandPalette).
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function save() {
    if (!name.trim()) { onError && onError('El nombre es obligatorio'); return; }
    setSaving(true);
    const emails = emailsText.split(/[\s,]+/).map(s => s.trim()).filter(s => /.+@.+\..+/.test(s));
    try {
      const res = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          config: {
            topic: topic || null,
            sentiment: sentiment === 'any' ? null : sentiment,
            pertinence: pertinence === 'any' ? null : pertinence,
            threshold: { minMentions: Number(minVolume), windowMinutes: Number(windowMinutes) },
          },
          notifyEmails: emails,
        }),
      });
      if (res.ok) { onSaved && onSaved(); }
      else {
        const body = await res.json().catch(() => ({}));
        onError && onError(body.error || `HTTP ${res.status}`);
      }
    } catch (e) {
      onError && onError(e.message || 'Error de red');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div role="dialog" aria-modal="true" style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: 'min(560px, 94vw)', maxHeight: '88vh', overflow: 'auto',
        background: 'var(--canvas)', border: '1px solid var(--hairline-strong)',
        borderRadius: 12, boxShadow: '0 24px 60px rgba(0,0,0,0.28)',
        zIndex: 2001, display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--hairline)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div className="section-eyebrow">Nueva regla</div>
            <div style={{ fontSize: 18, fontWeight: 600, fontFamily: 'var(--ff-display)', marginTop: 4 }}>Configurar condiciones y notificación</div>
          </div>
          <button className="btn" onClick={onClose}><Icons.Close size={14} /></button>
        </div>
        <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>Nombre</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Pico de negativos en infraestructura" />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>Descripción (opcional)</span>
            <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Contexto o razón de la regla" />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>Tópico</span>
              <select className="input" value={topic} onChange={(e) => setTopic(e.target.value)}>
                <option value="">Cualquiera</option>
                {(topics || []).map((t) => <option key={t.slug} value={t.slug}>{t.name}</option>)}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>Sentimiento</span>
              <select className="input" value={sentiment} onChange={(e) => setSentiment(e.target.value)}>
                <option value="any">Cualquiera</option>
                <option value="negativo">Negativo</option>
                <option value="neutral">Neutral</option>
                <option value="positivo">Positivo</option>
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>Pertinencia mínima</span>
              <select className="input" value={pertinence} onChange={(e) => setPertinence(e.target.value)}>
                <option value="any">Cualquiera</option>
                <option value="alta">Alta</option>
                <option value="media">Media</option>
                <option value="baja">Baja</option>
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>Umbral · menciones</span>
              <input className="input" type="number" min="1" value={minVolume} onChange={(e) => setMinVolume(e.target.value)} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, gridColumn: '1 / -1' }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>Ventana de evaluación · minutos</span>
              <input className="input" type="number" min="5" step="5" value={windowMinutes} onChange={(e) => setWindowMinutes(e.target.value)} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, gridColumn: '1 / -1' }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)' }}>Correos a notificar (separados por coma)</span>
              <input className="input" value={emailsText} onChange={(e) => setEmailsText(e.target.value)} placeholder="equipo@agencia.pr.gov" />
            </label>
          </div>
        </div>
        <div style={{ padding: '14px 22px', borderTop: '1px solid var(--hairline)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Guardando…' : 'Crear regla'}
          </button>
        </div>
      </div>
    </>
  );
}

function AlertsHistory({ onMentionClick }) {
  const [rows, setRows] = React.useState(null); // null = loading
  React.useEffect(() => {
    const agency = localStorage.getItem('eco.agency') || '';
    const period = localStorage.getItem('eco.period') || '1M';
    fetch('/api/alerts/history?' + new URLSearchParams({ agency, period }).toString(), { credentials: 'same-origin' })
      .then((r) => r.ok ? r.json() : { history: [] })
      .then((j) => setRows(j.history || []))
      .catch(() => setRows([]));
  }, []);
  if (rows === null) {
    return <div className="card card-bd" style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>Cargando historial…</div>;
  }
  if (rows.length === 0) {
    return <div className="card card-bd" style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>Sin alertas disparadas en el período.</div>;
  }
  // Aggregate by day for a mini bar chart
  const byDay = {};
  rows.forEach((r) => {
    const day = (r.triggeredAt || '').slice(0, 10);
    if (!day) return;
    byDay[day] = (byDay[day] || 0) + 1;
  });
  const days = Object.keys(byDay).sort();
  const max = Math.max(1, ...Object.values(byDay));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="card">
        <div className="card-hd"><div><div className="card-hd-title">Disparos por día</div><div className="card-hd-sub">{rows.length} eventos en el período</div></div></div>
        <div className="card-bd">
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${days.length}, 1fr)`, gap: 2, height: 110, alignItems: 'end' }}>
            {days.map((d) => (
              <div key={d} title={`${d} · ${byDay[d]} eventos`} style={{ display: 'flex', alignItems: 'flex-end', height: '100%' }}>
                <div style={{ width: '100%', height: `${(byDay[d] / max) * 100}%`, background: 'var(--accent)', opacity: 0.85, borderRadius: '2px 2px 0 0', minHeight: 2 }} />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 9, color: 'var(--text-3)' }}>
            <span>{days[0]}</span><span>{days[days.length - 1]}</span>
          </div>
        </div>
      </div>
      <div className="card">
        <div className="card-hd"><div><div className="card-hd-title">Historial detallado</div></div></div>
        <div>
          {rows.slice(0, 40).map((r, i) => (
            <div key={r.id || i} style={{ display: 'grid', gridTemplateColumns: '120px 140px 1fr 90px', gap: 12, padding: '10px 16px', borderTop: i > 0 ? '1px solid var(--hairline)' : 'none', fontSize: 12, alignItems: 'center' }}>
              <span className="mono" style={{ color: 'var(--text-3)' }}>{r.triggeredAt ? new Date(r.triggeredAt).toLocaleString('es-PR', { timeZone: 'America/Puerto_Rico' }) : '—'}</span>
              <span className={`pill ${r.severity === 'alta' ? 'pill-neg' : r.severity === 'media' ? 'pill-warn' : 'pill-neu'}`}>{r.severity || 'media'}</span>
              <span style={{ color: 'var(--text)' }}>{r.ruleName || r.rule || 'Regla'}</span>
              <span className="num" style={{ textAlign: 'right', fontWeight: 600 }}>{r.mentionIds?.length || 0}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// =============== SETTINGS ===============
function SettingsScreen() {
  const [section, setSection] = useState('usuarios');
  const sections = [
    { k: 'usuarios', l: 'Usuarios y roles', icon: 'Users' },
    { k: 'alertas', l: 'Preferencias de alertas', icon: 'Bell' },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 20 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {sections.map((s) => {
          const IconC = Icons[s.icon];
          return (
            <button key={s.k} onClick={() => setSection(s.k)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 12px', borderRadius: 8,
                fontSize: 13, fontWeight: section === s.k ? 600 : 500,
                background: section === s.k ? 'var(--accent-fill)' : 'transparent',
                color: section === s.k ? 'var(--accent)' : 'var(--text-2)',
                textAlign: 'left',
              }}>
              <IconC size={14} /> {s.l}
            </button>
          );
        })}
      </div>
      <div>{section === 'usuarios' ? <UsersAdmin /> : <AlertsPrefs />}</div>
    </div>
  );
}

// --- Users admin module ---
const SEED_USERS = [
  { id: 'u1', name: 'María Santos', email: 'maria.santos@dtop.pr.gov', role: 'admin',   agency: 'DTOP', status: 'activo',   lastSeen: 'hace 5 min',  avatar: '#E1767B' },
  { id: 'u2', name: 'Carlos Vega',  email: 'carlos.vega@dtop.pr.gov',  role: 'analista', agency: 'DTOP', status: 'activo',   lastSeen: 'hace 1 h',    avatar: '#4A7FB5' },
  { id: 'u3', name: 'Lucía Rivera', email: 'lucia.rivera@daco.pr.gov', role: 'analista', agency: 'DACo', status: 'activo',   lastSeen: 'hace 3 h',    avatar: '#6B9E7F' },
  { id: 'u4', name: 'Pedro Morales',email: 'pedro.morales@salud.pr.gov',role: 'viewer',  agency: 'Salud',status: 'invitado', lastSeen: '—',           avatar: '#C08457' },
  { id: 'u5', name: 'Ana Figueroa', email: 'ana.f@ama.pr.gov',          role: 'editor',  agency: 'AMA',  status: 'suspendido',lastSeen: 'hace 12 d',  avatar: '#8B6BB0' },
  { id: 'u6', name: 'Rafael Ortiz', email: 'rafael.ortiz@dtop.pr.gov', role: 'analista', agency: 'DTOP', status: 'activo',   lastSeen: 'hace 30 min', avatar: '#4A7FB5' },
];

const ROLES = [
  { k: 'admin',    l: 'Administrador', desc: 'Control total · gestiona usuarios, reglas y configuración', perms: ['read','write','admin','billing'], count: 2 },
  { k: 'editor',   l: 'Editor',        desc: 'Crea reglas de alerta, tags, responde menciones',           perms: ['read','write'],                   count: 4 },
  { k: 'analista', l: 'Analista',      desc: 'Ve todos los dashboards, exporta reportes, comenta',        perms: ['read','export'],                  count: 12 },
  { k: 'viewer',   l: 'Solo lectura',  desc: 'Vista de dashboards sin exportar ni comentar',              perms: ['read'],                           count: 8 },
];

function UsersAdmin() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [drawer, setDrawer] = useState(null); // { mode: 'create' | 'edit', user }
  const [error, setError] = useState(null);

  const [agencyOptions, setAgencyOptions] = useState([]);
  React.useEffect(() => {
    fetch('/api/agencies', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => setAgencyOptions(Array.isArray(list) ? list.map((a) => ({ slug: a.slug, name: a.name })) : []))
      .catch(() => {});
  }, []);

  // Map API row -> UI shape so existing render logic keeps working.
  const fromApi = (u) => ({
    id: u.id,
    name: u.name || u.email.split('@')[0],
    email: u.email,
    role: u.role, // 'admin' | 'analyst' | 'viewer'
    allAgencies: !!u.allAgencies,
    agencySlugs: Array.isArray(u.agencies) ? u.agencies : [],
    // Display label for the Agencia column.
    agency: u.allAgencies ? 'Todas' : (Array.isArray(u.agencies) && u.agencies.length ? u.agencies.join(', ') : '—'),
    status: u.isActive ? (u.lastLogin ? 'activo' : 'invitado') : 'suspendido',
    lastSeen: u.lastLogin ? new Date(u.lastLogin).toLocaleString('es-PR') : '—',
    avatar: '#4A7FB5',
  });

  // Normalize the prototype's richer role vocabulary to the backend's enum.
  const roleToApi = (r) => (r === 'admin' ? 'admin' : r === 'editor' || r === 'analista' || r === 'analyst' ? 'analyst' : 'viewer');

  const refresh = React.useCallback(() => {
    setLoading(true);
    fetch('/api/users', { credentials: 'same-origin' })
      .then((r) => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))
      .then((j) => { setUsers((j.users || []).map(fromApi)); setError(null); })
      .catch((e) => setError(e.message || 'Error cargando usuarios'))
      .finally(() => setLoading(false));
  }, []);
  React.useEffect(() => { refresh(); }, [refresh]);

  const filtered = users.filter(u => {
    if (roleFilter !== 'all' && u.role !== roleFilter) return false;
    if (statusFilter !== 'all' && u.status !== statusFilter) return false;
    if (query && !u.name.toLowerCase().includes(query.toLowerCase()) && !u.email.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  const stats = {
    total: users.length,
    activos: users.filter(u => u.status === 'activo').length,
    invitados: users.filter(u => u.status === 'invitado').length,
    suspendidos: users.filter(u => u.status === 'suspendido').length,
  };

  const saveUser = async (u) => {
    try {
      if (u.id && users.find((x) => x.id === u.id)) {
        // Edit: PATCH
        await fetch('/api/users/' + encodeURIComponent(u.id), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            name: u.name,
            role: roleToApi(u.role),
            isActive: u.status !== 'suspendido',
            allAgencies: !!u.allAgencies,
            agencySlugs: u.agencySlugs || [],
          }),
        });
      } else {
        // Create: POST
        await fetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            email: u.email,
            name: u.name,
            role: roleToApi(u.role),
            allAgencies: !!u.allAgencies,
            agencySlugs: u.agencySlugs || [],
          }),
        });
      }
      setDrawer(null);
      refresh();
      (window.ecoToast || (() => {}))('ok', 'Usuario guardado');
    } catch (e) {
      (window.ecoToast || (() => {}))('err', 'No se pudo guardar: ' + (e.message || e));
    }
  };

  const deleteUser = async (id) => {
    const confirmed = window.ecoConfirm
      ? await window.ecoConfirm('¿Suspender este usuario? Podrás reactivarlo después.')
      : confirm('¿Suspender este usuario? Podrás reactivarlo después.');
    if (!confirmed) return;
    try {
      await fetch('/api/users/' + encodeURIComponent(id), {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      setDrawer(null);
      refresh();
      (window.ecoToast || (() => {}))('ok', 'Usuario suspendido');
    } catch (e) {
      (window.ecoToast || (() => {}))('err', 'No se pudo eliminar: ' + (e.message || e));
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Header */}
      <div className="card">
        <div style={{ padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 240px', minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--ff-display)', letterSpacing: 'var(--letter-display)' }}>
              Usuarios y roles
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
              {stats.total} usuarios · {stats.activos} activos · {stats.invitados} invitación pendiente · {stats.suspendidos} suspendidos
            </div>
          </div>
          <button className="btn btn-primary" onClick={() => setDrawer({ mode: 'create', user: { name: '', email: '', role: 'analista', allAgencies: false, agencySlugs: [], status: 'invitado', notify: true } })}>
            <Icons.Plus size={13} /> Invitar usuario
          </button>
        </div>
        <div style={{ borderTop: '1px solid var(--hairline)', padding: '12px 18px', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', border: '1px solid var(--hairline)', borderRadius: 8, flex: '1 1 260px', background: 'var(--canvas)' }}>
            <Icons.Search size={14} color="var(--text-3)" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nombre o correo…"
              style={{ border: 'none', outline: 'none', background: 'none', flex: 1, fontSize: 13, color: 'var(--text)' }} />
          </div>
          <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}
            style={{ padding: '7px 10px', fontSize: 12, border: '1px solid var(--hairline)', borderRadius: 8, background: 'var(--canvas)' }}>
            <option value="all">Todos los roles</option>
            {ROLES.map(r => <option key={r.k} value={r.k}>{r.l}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            style={{ padding: '7px 10px', fontSize: 12, border: '1px solid var(--hairline)', borderRadius: 8, background: 'var(--canvas)' }}>
            <option value="all">Todos los estados</option>
            <option value="activo">Activo</option>
            <option value="invitado">Invitado</option>
            <option value="suspendido">Suspendido</option>
          </select>
        </div>
      </div>

      {/* Roles at a glance */}
      <div className="card">
        <div className="card-hd"><div><div className="card-hd-title">Roles disponibles</div><div className="card-hd-sub">Permisos configurados a nivel de plataforma</div></div></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0, borderTop: '1px solid var(--hairline)' }}>
          {ROLES.map((r, i) => (
            <div key={r.k} style={{ padding: 16, borderRight: i < ROLES.length - 1 ? '1px solid var(--hairline)' : 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{r.l}</div>
                <div className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>{r.count}</div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.45 }}>{r.desc}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                {r.perms.map(p => (
                  <span key={p} className="pill" style={{ fontSize: 9, background: 'var(--canvas-2)', border: '1px solid var(--hairline)', color: 'var(--text-2)' }}>{p}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Users table */}
      <div className="card">
        <div className="card-hd"><div><div className="card-hd-title">Usuarios</div><div className="card-hd-sub">{filtered.length} resultados</div></div></div>
        <div>
          <div style={{
            display: 'grid', gridTemplateColumns: '1.6fr 1.2fr 110px 110px 110px 40px', gap: 12,
            padding: '10px 18px', borderTop: '1px solid var(--hairline)',
            fontSize: 10, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em',
            background: 'var(--canvas-2)',
          }}>
            <div>Usuario</div><div>Agencia</div><div>Rol</div><div>Estado</div><div>Última actividad</div><div></div>
          </div>
          {filtered.map((u, idx) => {
            const roleMeta = ROLES.find(r => r.k === u.role);
            const stTone = u.status === 'activo' ? 'pos' : u.status === 'invitado' ? 'warn' : 'neg';
            return (
              <div key={u.id}
                onClick={() => setDrawer({ mode: 'edit', user: u })}
                className="row-hover"
                style={{
                  display: 'grid', gridTemplateColumns: '1.6fr 1.2fr 110px 110px 110px 40px', gap: 12,
                  padding: '12px 18px', alignItems: 'center', cursor: 'pointer',
                  borderTop: '1px solid var(--hairline)',
                }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <div style={{ width: 30, height: 30, borderRadius: '50%', background: u.avatar, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                    {u.name.split(' ').map(p => p[0]).slice(0,2).join('')}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</div>
                  </div>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-2)' }}>{u.agency}</div>
                <div>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', padding: '3px 8px', background: 'var(--canvas-2)', border: '1px solid var(--hairline)', borderRadius: 999 }}>
                    {roleMeta?.l || u.role}
                  </span>
                </div>
                <div><span className={`pill pill-${stTone}`} style={{ textTransform: 'capitalize' }}>{u.status}</span></div>
                <div className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>{u.lastSeen}</div>
                <Icons.ChevronRight size={14} color="var(--text-3)" />
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)', fontSize: 13, borderTop: '1px solid var(--hairline)' }}>
              Sin resultados · ajusta los filtros o <button onClick={() => { setQuery(''); setRoleFilter('all'); setStatusFilter('all'); }} style={{ color: 'var(--accent)', fontWeight: 600 }}>limpiar filtros</button>
            </div>
          )}
        </div>
      </div>

      {drawer && <UserDrawer drawer={drawer} agencyOptions={agencyOptions} onSave={saveUser} onDelete={deleteUser} onClose={() => setDrawer(null)} />}
    </div>
  );
}

function UserDrawer({ drawer, agencyOptions = [], onSave, onDelete, onClose }) {
  const [form, setForm] = useState(drawer.user);

  // Cerrar con Escape (mismo patrón que CommandPalette).
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const isCreate = drawer.mode === 'create';
  const setField = (k, v) => setForm(prev => ({ ...prev, [k]: v }));
  const valid = form.name.trim() && /@/.test(form.email);

  const submit = () => {
    if (!valid) return;
    onSave(form);
  };

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer">
        <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--hairline)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div className="section-eyebrow" style={{ margin: 0 }}>{isCreate ? 'Invitar usuario' : 'Editar usuario'}</div>
            <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--ff-display)', letterSpacing: 'var(--letter-display)', marginTop: 2 }}>
              {isCreate ? 'Nuevo miembro del equipo' : form.name}
            </div>
          </div>
          <button className="btn" onClick={onClose}><Icons.Close size={14} /></button>
        </div>

        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Identity */}
          <div>
            <div className="section-eyebrow" style={{ marginBottom: 10 }}>Identidad</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field label="Nombre completo" required>
                <input value={form.name} onChange={(e) => setField('name', e.target.value)}
                  placeholder="María Santos"
                  style={inputStyle} />
              </Field>
              <Field label="Correo institucional" required>
                <input value={form.email} onChange={(e) => setField('email', e.target.value)}
                  placeholder="nombre@agencia.pr.gov"
                  style={inputStyle} />
              </Field>
              <Field label="Estado">
                <select value={form.status} onChange={(e) => setField('status', e.target.value)} style={inputStyle}>
                  <option value="activo">Activo</option>
                  <option value="invitado">Invitado (pendiente)</option>
                  <option value="suspendido">Suspendido</option>
                </select>
              </Field>
            </div>
          </div>

          {/* Agencies the user can switch between */}
          <div>
            <div className="section-eyebrow" style={{ marginBottom: 10 }}>Agencias visibles</div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, cursor: 'pointer' }}>
              <input type="checkbox" checked={!!form.allAgencies}
                onChange={(e) => setField('allAgencies', e.target.checked)} />
              <span style={{ fontSize: 13, color: 'var(--text)' }}>Todas las agencias <span style={{ color: 'var(--text-3)' }}>(staff Populicom)</span></span>
            </label>
            {!form.allAgencies && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 2 }}>
                {agencyOptions.length === 0 && (
                  <div style={{ fontSize: 12, color: 'var(--text-3)' }}>No hay agencias disponibles para asignar.</div>
                )}
                {agencyOptions.map((a) => {
                  const checked = (form.agencySlugs || []).includes(a.slug);
                  return (
                    <label key={a.slug} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                      <input type="checkbox" checked={checked}
                        onChange={(e) => {
                          const cur = new Set(form.agencySlugs || []);
                          if (e.target.checked) cur.add(a.slug); else cur.delete(a.slug);
                          setField('agencySlugs', [...cur]);
                        }} />
                      <span style={{ fontSize: 13, color: 'var(--text)' }}>{a.name} <span style={{ color: 'var(--text-3)', fontSize: 11 }}>({a.slug})</span></span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* Role picker */}
          <div>
            <div className="section-eyebrow" style={{ marginBottom: 10 }}>Rol y permisos</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {ROLES.map(r => {
                const selected = form.role === r.k;
                return (
                  <label key={r.k} style={{
                    display: 'flex', alignItems: 'flex-start', gap: 12,
                    padding: 12, borderRadius: 10,
                    border: `1px solid ${selected ? 'var(--accent)' : 'var(--hairline)'}`,
                    background: selected ? 'var(--accent-fill)' : 'var(--canvas)',
                    cursor: 'pointer',
                  }}>
                    <input type="radio" name="role" checked={selected} onChange={() => setField('role', r.k)} style={{ marginTop: 3 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{r.l}</div>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {r.perms.map(p => <span key={p} className="pill" style={{ fontSize: 9, background: 'var(--canvas-2)', border: '1px solid var(--hairline)', color: 'var(--text-2)' }}>{p}</span>)}
                        </div>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 4, lineHeight: 1.5 }}>{r.desc}</div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Scope — which agencies this user can see */}
          <div>
            <div className="section-eyebrow" style={{ marginBottom: 10 }}>Alcance de datos</div>
            <div style={{ padding: 12, border: '1px solid var(--hairline)', borderRadius: 10, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
              {['DTOP','DACo','Salud','AMA','Familia','Educación'].map((a, i) => (
                <label key={a} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text)' }}>
                  <input type="checkbox" defaultChecked={i === 0 || a === form.agency} />
                  {a}
                </label>
              ))}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6 }}>Controla de qué agencias puede ver menciones, tópicos y reportes.</div>
          </div>

          {/* Notifications */}
          <div>
            <div className="section-eyebrow" style={{ marginBottom: 10 }}>Notificaciones</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[
                { k: 'alertas_criticas', l: 'Alertas críticas (email + SMS)', d: true },
                { k: 'resumen_diario',  l: 'Resumen diario por correo', d: true },
                { k: 'invitacion',      l: 'Invitación de bienvenida', d: isCreate },
              ].map(n => (
                <label key={n.k} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: '1px solid var(--hairline)', borderRadius: 8 }}>
                  <input type="checkbox" defaultChecked={n.d} />
                  <span style={{ fontSize: 12 }}>{n.l}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Activity — only on edit */}
          {!isCreate && (
            <div>
              <div className="section-eyebrow" style={{ marginBottom: 10 }}>Actividad reciente</div>
              <div style={{ border: '1px solid var(--hairline)', borderRadius: 10, overflow: 'hidden' }}>
                {[
                  { ts: 'hace 5 min',  a: 'Inició sesión',             ip: '10.24.1.18' },
                  { ts: 'hace 1 h',    a: 'Exportó reporte semanal',   ip: '10.24.1.18' },
                  { ts: 'hace 4 h',    a: 'Editó regla de alerta #R-12', ip: '10.24.1.18' },
                  { ts: 'hace 1 d',    a: 'Cambió rol a analista',     ip: '—' },
                ].map((a, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '100px 1fr 120px', gap: 8, padding: '10px 12px', borderTop: i > 0 ? '1px solid var(--hairline)' : 'none', fontSize: 12 }}>
                    <div className="mono" style={{ color: 'var(--text-3)' }}>{a.ts}</div>
                    <div style={{ color: 'var(--text)' }}>{a.a}</div>
                    <div className="mono" style={{ color: 'var(--text-3)', textAlign: 'right' }}>{a.ip}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, paddingTop: 8, borderTop: '1px solid var(--hairline)' }}>
            <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} onClick={submit} disabled={!valid}>
              <Icons.Check size={13} /> {isCreate ? 'Enviar invitación' : 'Guardar cambios'}
            </button>
            {!isCreate && (
              <button className="btn" style={{ color: 'var(--neg)' }} onClick={() => onDelete(form.id)}>
                <Icons.Trash size={13} /> Eliminar
              </button>
            )}
            <button className="btn" onClick={onClose}>Cancelar</button>
          </div>
        </div>
      </div>
    </>
  );
}

const inputStyle = {
  width: '100%', padding: '8px 10px', fontSize: 13,
  border: '1px solid var(--hairline)', borderRadius: 8,
  background: 'var(--canvas)', color: 'var(--text)',
  outline: 'none', fontFamily: 'inherit',
};

function Field({ label, required, children }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 5 }}>
        {label} {required && <span style={{ color: 'var(--neg)' }}>*</span>}
      </div>
      {children}
    </div>
  );
}

function AlertsPrefs() {
  // Persist toggles + destinations in localStorage so the settings survive
  // reload. When a user-preferences API lands we can swap the storage layer
  // without changing the UI.
  const DEFAULTS = {
    email: { on: true,  dest: '' },
    sms:   { on: false, dest: '' },
    slack: { on: false, dest: '' },
    teams: { on: false, dest: '' },
  };
  const [prefs, setPrefs] = useState(() => {
    try {
      const raw = localStorage.getItem('eco.prefs.alertChannels');
      if (!raw) return DEFAULTS;
      return { ...DEFAULTS, ...JSON.parse(raw) };
    } catch { return DEFAULTS; }
  });
  const [saved, setSaved] = useState(false);

  function update(k, patch) {
    setPrefs((p) => {
      const next = { ...p, [k]: { ...p[k], ...patch } };
      try { localStorage.setItem('eco.prefs.alertChannels', JSON.stringify(next)); } catch {}
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      return next;
    });
  }

  const channels = [
    { k: 'email', l: 'Correo electrónico', placeholder: 'tu@agencia.pr.gov' },
    { k: 'sms',   l: 'SMS',                placeholder: '+1 787 000 0000' },
    { k: 'slack', l: 'Slack',              placeholder: '#canal-monitoreo' },
    { k: 'teams', l: 'Microsoft Teams',    placeholder: 'Webhook URL' },
  ];

  return (
    <div className="card">
      <div className="card-hd">
        <div>
          <div className="card-hd-title">Preferencias de alertas</div>
          <div className="card-hd-sub">Canales por defecto · se aplican a las reglas que crees desde ahora</div>
        </div>
        {saved && <span className="pill pill-pos">Guardado</span>}
      </div>
      <div className="card-bd" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {channels.map((c) => {
          const val = prefs[c.k] || { on: false, dest: '' };
          return (
            <div key={c.k}
              style={{
                display: 'grid', gridTemplateColumns: '1fr auto 40px',
                alignItems: 'center', gap: 12,
                padding: '12px 14px', border: '1px solid var(--hairline)', borderRadius: 10,
              }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{c.l}</div>
                <input
                  className="input"
                  style={{ marginTop: 4, fontSize: 11 }}
                  placeholder={c.placeholder}
                  value={val.dest}
                  onChange={(e) => update(c.k, { dest: e.target.value })}
                  disabled={!val.on}
                />
              </div>
              <span style={{ fontSize: 10, color: val.on ? 'var(--pos)' : 'var(--text-3)', fontWeight: 700, textTransform: 'uppercase' }}>
                {val.on ? 'Activo' : 'Inactivo'}
              </span>
              <button
                onClick={() => update(c.k, { on: !val.on })}
                aria-label={`Toggle ${c.l}`}
                style={{
                  width: 36, height: 20, borderRadius: 999, border: 'none',
                  background: val.on ? 'var(--pos)' : 'var(--hairline-strong)',
                  position: 'relative', cursor: 'pointer', padding: 0,
                }}>
                <span style={{
                  display: 'block', width: 16, height: 16, borderRadius: '50%', background: '#fff',
                  position: 'absolute', top: 2, left: val.on ? 18 : 2, transition: 'left 0.2s',
                }} />
              </button>
            </div>
          );
        })}
        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6 }}>
          Estas preferencias se guardan localmente. Cuando una regla incluya estos canales, se usarán automáticamente.
        </div>
      </div>
    </div>
  );
}

// =============== OVERVIEW ===============
// Espejo del correo diario (eco-weekly-report) sin LLM. Consume /api/overview
// que internamente usa el mismo @eco/shared/buildSentimentReport que el
// lambda — totales, deltas, daily series y la tabla de tópicos coinciden
// byte-por-byte con el correo de las 6 AM cuando period=7D.
//
// Layout (top a bottom):
//   1. Hero — período + total
//   2. Termómetro — 3 KPIs neg/neu/pos con Δ vs ventana previa
//   3. Highlights — NSS+Riesgo · Volúmenes · Brand Health
//   4. Tendencia — multi-line chart con neg/neu/pos
//   5. Tópico principal — top-7 + Otros + Sin clasificar
//
// Las filas de tópico son clickeables: abren el slice modal con topicMode=primary
// (top-confidence) por defecto, con un toggle "+ Incluir secundarias" para ver
// el conteo multi-clasificación.
function OverviewScreen({ period, agency, onMentionClick }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [slice, setSlice] = useState(null);

  useEffect(() => {
    setData(null); setError(null);
    const params = new URLSearchParams({ period: period || '7D' });
    if (agency) params.set('agency', agency);
    // Rango personalizado: cuando period === 'custom', el FilterBar habrá
    // guardado eco.from/eco.to en localStorage; los pasamos al API para que
    // sobrescriba la ventana derivada del period.
    if (period === 'custom') {
      const from = (typeof localStorage !== 'undefined' && localStorage.getItem('eco.from')) || '';
      const to = (typeof localStorage !== 'undefined' && localStorage.getItem('eco.to')) || '';
      if (from && to) { params.set('from', from); params.set('to', to); }
    }
    const ctrl = new AbortController();
    fetch('/api/overview?' + params.toString(), { credentials: 'same-origin', cache: 'no-store', signal: ctrl.signal })
      .then((r) => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then(setData)
      .catch((e) => { if (e?.name !== 'AbortError') setError(String(e?.message || e)); });
    return () => ctrl.abort();
  }, [period, agency]);

  if (error) {
    return (
      <div className="card" style={{ padding: 24, textAlign: 'center' }}>
        <div className="section-eyebrow" style={{ color: 'var(--neg)', marginBottom: 6 }}>Error</div>
        <div style={{ fontSize: 13, color: 'var(--text-2)' }}>No se pudo cargar el Overview: {error}</div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)' }}>
        Cargando…
      </div>
    );
  }

  function openSentimentSlice(name, count) {
    const map = { negativo: 'Negativo', neutral: 'Neutral', positivo: 'Positivo' };
    const accent = name === 'positivo' ? 'var(--pos)' : name === 'negativo' ? 'var(--neg)' : 'var(--text-3)';
    setSlice({
      eyebrow: 'Sentimiento',
      title: `Menciones ${map[name].toLowerCase()}`,
      accent,
      volume: count,
      sentiment: {
        pos: name === 'positivo' ? count : 0,
        neu: name === 'neutral' ? count : 0,
        neg: name === 'negativo' ? count : 0,
      },
      mentions: [],
      _filter: { sentiment: name },
    });
  }

  // openDaySlice — click en un día del gráfico de tendencias. Abre el modal
  // con las menciones de ESE día específico, leyendo los conteos del propio
  // datapoint. El _filter.day se interpreta como YYYY-MM-DD en TZ Puerto Rico
  // por el endpoint /api/eco-mentions.
  function openDaySlice(d) {
    if (!d || !d.fullDate) return;
    const total = (d.negative || 0) + (d.neutral || 0) + (d.positive || 0);
    const bias = (d.negative || 0) > (d.positive || 0) ? 'negativo'
      : (d.positive || 0) > (d.negative || 0) ? 'positivo' : 'neutral';
    const accent = bias === 'negativo' ? 'var(--neg)' : bias === 'positivo' ? 'var(--pos)' : 'var(--accent)';
    setSlice({
      eyebrow: d.date || d.fullDate,
      title: `Conversación del día`,
      accent,
      volume: total,
      sentiment: { pos: d.positive || 0, neu: d.neutral || 0, neg: d.negative || 0 },
      mentions: [],
      _filter: { day: d.fullDate },
    });
  }

  // openMetricInsight — abre MetricInsightModal vía helper compartido.
  function openMetricInsight(metric, value, accent) {
    const labels = {
      crisis: 'Riesgo de crisis',
      polarization: 'Polarización',
      nss: 'Net Sentiment Score',
      bhi: 'Brand Health',
      volume: 'Volumen',
    };
    const filter = metric === 'crisis' ? { sentiment: 'negativo', pertinence: 'alta' } : {};
    openMetricInsightShared(setSlice, {
      metric,
      value,
      accent,
      label: labels[metric] || metric,
      periodLabel: data?.periodLabel,
      periodStart: data?.periodStart,
      periodEnd: data?.periodEnd,
      agency,
      subcomponents: [],
      filter,
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <OverviewHero data={data} />
      <OverviewTermometro totals={data.totals} deltas={data.deltaVsPrev} onSliceClick={openSentimentSlice} />
      <OverviewHighlights metrics={data.currentMetrics} onOpenInsight={openMetricInsight} />
      <OverviewTendencia dailySeries={data.dailySeries} onDayClick={openDaySlice} />
      <OverviewTopicos
        rows={data.topicsTable}
        totals={data.totals}
        onTopicClick={(row) => {
          // Buscar el slug del tópico en D.TOPICS (eco-data) para que el modal
          // pueda filtrar. La tabla del Overview viene de buildSentimentReport
          // (matchea correo) que solo expone el name; resolvemos el slug aquí.
          const topic = (D.TOPICS || []).find((t) => t.name === row.topic);
          if (!topic) return;
          const palette = ['#E1767B', '#4A7FB5', '#6B9E7F', '#C08457', '#8B6BB0', '#D4A73E', '#5A9FA8', '#A3624D'];
          const slugIdx = {};
          (D.TOPICS || []).forEach((tp, i) => { slugIdx[tp.slug] = i; });
          const accent = palette[(slugIdx[topic.slug] || 0) % palette.length] || 'var(--accent)';
          setSlice({
            eyebrow: 'Tópico',
            title: topic.name,
            accent,
            mentions: [],
            _filter: { topic: topic.slug },
          });
        }}
      />
      {/* Insights va al FINAL, después de Topicos (orden explícito del
          usuario: "necesito que salga de último después de los topicos"). */}
      <OverviewInsights periodStart={data.periodStart} periodEnd={data.periodEnd} agency={agency} />
      {slice && <MentionsSliceModal slice={slice} onClose={() => setSlice(null)} onMentionClick={onMentionClick} />}
    </div>
  );
}

function OverviewHero({ data }) {
  const total = data.totals.total || 0;
  return (
    <div style={{ padding: '4px 4px 0' }}>
      {/* Sin section-eyebrow: el periodo / fechas viven en el Header (chips +
          calendar icon) y la palabra "Overview" ya está en el header / sidebar.
          Repetirlas aquí era ruido (instrucción explícita del usuario). */}
      <h1 style={{
        fontFamily: 'var(--ff-display)', fontSize: 26, fontWeight: 600,
        lineHeight: 1.2, margin: '0 0 4px', letterSpacing: 'var(--letter-display)',
        color: 'var(--text)',
      }}>
        Conversación pública de los últimos {data.dailySeries.length} días
      </h1>
      <div style={{ color: 'var(--text-2)', fontSize: 13 }}>
        {total > 0
          ? <><span className="num" style={{ fontWeight: 600, color: 'var(--text)' }}>{total.toLocaleString('es-PR')}</span> menciones · {data.periodStart} → {data.periodEnd}</>
          : <>Sin menciones registradas en la ventana seleccionada.</>}
      </div>
    </div>
  );
}

function OverviewTermometro({ totals, deltas, onSliceClick }) {
  const t = totals.total || 1;
  const cards = [
    { name: 'Negativo', sentKey: 'negativo', value: totals.negative, delta: deltas.negative, accent: 'var(--neg)', invert: true },
    { name: 'Neutral',  sentKey: 'neutral',  value: totals.neutral,  delta: deltas.neutral,  accent: 'var(--text-3)', invert: false },
    { name: 'Positivo', sentKey: 'positivo', value: totals.positive, delta: deltas.positive, accent: 'var(--pos)', invert: false },
  ];
  return (
    <div>
      <div className="section-eyebrow" style={{ marginBottom: 8 }}>01 · Termómetro · vs ventana previa</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        {cards.map((c) => {
          const pct = totals.total > 0 ? Math.round((c.value / t) * 100) : 0;
          // Negativo: subir es malo (rojo); bajar es bueno (verde).
          // Positivo: subir es bueno (verde); bajar es malo (rojo).
          // Neutral: sin color especial.
          const dColor = c.name === 'Neutral'
            ? 'var(--text-3)'
            : c.invert
              ? (c.delta > 0 ? 'var(--neg)' : c.delta < 0 ? 'var(--pos)' : 'var(--text-3)')
              : (c.delta > 0 ? 'var(--pos)' : c.delta < 0 ? 'var(--neg)' : 'var(--text-3)');
          // Las cards del termómetro abren MentionsSliceModal con el sentimiento
          // correspondiente. Usar <button> para teclado/aria; padding/estilos
          // imitan el card. Sin underline o cursor pointer por defecto del btn.
          return (
            <button key={c.name}
              onClick={() => onSliceClick && onSliceClick(c.sentKey, c.value)}
              className="card row-hover"
              style={{
                padding: 16, textAlign: 'left',
                cursor: 'pointer', border: '1px solid var(--hairline)',
                background: 'var(--canvas)',
              }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: c.accent }} />
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  {c.name}
                </div>
                <Icons.ArrowRight size={11} color="var(--text-3)" style={{ marginLeft: 'auto' }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <div className="num" style={{ fontSize: 32, fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--ff-display)', lineHeight: 1 }}>
                  {fmt(c.value)}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 600 }}>{pct}%</div>
              </div>
              <div style={{ marginTop: 8, fontSize: 11, fontWeight: 600, color: dColor, display: 'flex', alignItems: 'center', gap: 4 }}>
                {c.delta > 0 ? '▲' : c.delta < 0 ? '▼' : '·'}
                {Math.abs(Math.round(c.delta))}% vs ventana previa
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// OverviewHighlights — reducido a un único termómetro de Crisis. Antes había
// 3 tarjetas (NSS · Riesgo, Volúmenes, Brand Health). Por petición explícita
// del usuario quitamos NSS / Volúmenes / Brand Health del Overview (esas
// métricas viven en el tab Scorecard); Crisis se queda como termómetro pero
// ya no está fusionada con NSS — vive aquí en su propia card slim.
//
// Clickable: abre MetricInsightModal con insight LLM + subcomponentes
// (severity/velocity/relevance/confidence del snapshot diario).
function OverviewHighlights({ metrics, onOpenInsight }) {
  const m = metrics || {};
  if (m.crisisRiskScore == null) return null;
  // Crisis Risk en escala 0–1 (backtest 482d, PR #37). Thresholds:
  // NORMAL <0.25, ELEVADO <0.40, ALERTA <0.60, CRISIS ≥0.60.
  const score = m.crisisRiskScore;
  const band = score >= 0.60 ? 'CRISIS'
    : score >= 0.40 ? 'ALERTA'
    : score >= 0.25 ? 'ELEVADO'
    : 'NORMAL';
  const bandColor = score >= 0.40 ? 'var(--neg)' : score >= 0.25 ? 'var(--warn)' : 'var(--pos)';
  return (
    <button
      onClick={() => onOpenInsight && onOpenInsight('crisis', score.toFixed(2), 'var(--neg)')}
      className="card row-hover"
      style={{
        padding: 16,
        display: 'grid', gridTemplateColumns: '160px 1fr', gap: 16, alignItems: 'center',
        cursor: 'pointer', border: '1px solid var(--hairline)', background: 'var(--canvas)',
        textAlign: 'left', width: '100%',
      }}
      title="Ver insight del riesgo de crisis para el periodo">
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <Icons.Shield size={14} color="var(--neg)" />
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Riesgo de crisis
          </div>
          <Icons.ArrowRight size={11} color="var(--text-3)" style={{ marginLeft: 'auto' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <div className="num" style={{ fontSize: 28, fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--ff-display)', lineHeight: 1 }}>
            {score.toFixed(2)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600 }}>/1</div>
          <span className={`pill pill-${score >= 0.40 ? 'neg' : score >= 0.25 ? 'warn' : 'pos'}`} style={{ marginLeft: 'auto', fontSize: 10 }}>{band}</span>
        </div>
      </div>
      <div style={{ paddingLeft: 16, borderLeft: '1px solid var(--hairline)' }}>
        <div style={{ height: 6, borderRadius: 3, background: 'linear-gradient(90deg, var(--pos) 0%, var(--pos) 25%, var(--warn) 25%, var(--warn) 40%, var(--neg) 40%, var(--neg) 60%, var(--neg) 100%)', position: 'relative' }}>
          <div style={{ position: 'absolute', left: `${Math.min(score * 100, 100)}%`, top: -3, width: 12, height: 12, borderRadius: '50%', background: 'var(--canvas)', border: `2px solid ${bandColor}`, transform: 'translateX(-50%)' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--text-3)', marginTop: 4, fontFamily: 'var(--ff-mono)', letterSpacing: '0.04em' }}>
          <span>NORMAL</span><span>ELEVADO</span><span>ALERTA</span><span>CRISIS</span>
        </div>
      </div>
    </button>
  );
}

function OverviewTendencia({ dailySeries, onDayClick }) {
  // Adapta dailySeries del API al shape que MultiLineChart espera (`date` + keys de las series).
  // Guardamos fullDate (YYYY-MM-DD) para que el onPointClick pueda filtrar
  // las menciones del día seleccionado en MentionsSliceModal (_filter.day).
  const chartData = (dailySeries || []).map((d) => ({
    date: d.dayLabel,
    fullDate: d.date,
    negative: d.negative,
    neutral: d.neutral,
    positive: d.positive,
    totalMentions: (d.negative || 0) + (d.neutral || 0) + (d.positive || 0),
  }));
  const series = [
    { key: 'negative', label: 'Negativo', color: 'var(--neg)' },
    { key: 'neutral',  label: 'Neutral',  color: 'var(--text-3)' },
    { key: 'positive', label: 'Positivo', color: 'var(--pos)' },
  ];
  if (chartData.length === 0) {
    return (
      <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
        Sin datos de tendencia en el periodo.
      </div>
    );
  }
  return (
    <div className="card">
      <div className="card-hd">
        <div>
          <div className="card-hd-title">02 · Tendencia · Día a día</div>
          <div className="card-hd-sub">Volumen por sentimiento, día a día (TZ Puerto Rico) · click un día para ver sus menciones</div>
        </div>
      </div>
      <div className="card-bd">
        {/* Per-series normalization (cada línea con su propio min/max) +
            smooth bezier — petición explícita del usuario: "me gustaba más
            como se veía antes... me gustaban las líneas suavizadas". Con
            shared-scale, los picos grandes (ej. neg=203) comprimían las
            variaciones diarias normales en una banda plana al fondo. */}
        <MultiLineChart data={chartData} series={series} height={240} onPointClick={onDayClick} smooth={true} />
      </div>
    </div>
  );
}

function OverviewTopicos({ rows, totals, onTopicClick }) {
  if (!rows || rows.length === 0) {
    return (
      <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
        Sin tópicos clasificados en el periodo.
      </div>
    );
  }
  const universe = totals.total || 1;

  function DistributionBar({ neg, neu, pos, t }) {
    const td = t || 1;
    const negPct = (neg / td) * 100;
    const neuPct = (neu / td) * 100;
    const posPct = Math.max(0, 100 - negPct - neuPct);
    return (
      <div style={{ display: 'flex', height: 8, borderRadius: 2, overflow: 'hidden', background: 'var(--canvas-2)' }}>
        <div title={`negativo · ${neg}`} style={{ width: `${negPct}%`, background: 'var(--neg)' }} />
        <div title={`neutral · ${neu}`}  style={{ width: `${neuPct}%`, background: 'var(--text-3)' }} />
        <div title={`positivo · ${pos}`} style={{ width: `${posPct}%`, background: 'var(--pos)' }} />
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-hd">
        <div>
          <div className="card-hd-title">03 · Tópico principal</div>
          <div className="card-hd-sub">Top 7 + agrupados · cada mención cuenta una vez bajo su tópico de mayor confianza</div>
        </div>
      </div>
      <div>
        {rows.map((row, idx) => {
          const pctOfTotal = universe > 0 ? Math.round((row.total / universe) * 100) : 0;
          const muted = !!(row.isOther || row.isUnclassified);
          // Solo las filas clasificadas (top-7) son clickeables. "Otros" y
          // "Sin clasificar" agregan tópicos heterogéneos / sin clasificar
          // y no tienen un slug único al cual filtrar.
          const clickable = !muted && !!onTopicClick;
          return (
            <div key={idx}
              onClick={clickable ? () => onTopicClick(row) : undefined}
              className={clickable ? 'row-hover' : undefined}
              style={{
                display: 'grid', gridTemplateColumns: '1.4fr 110px 1fr', gap: 16,
                padding: '14px 16px', alignItems: 'center',
                borderTop: idx > 0 ? '1px solid var(--hairline)' : 'none',
                opacity: muted ? 0.78 : 1,
                cursor: clickable ? 'pointer' : 'default',
              }}>
              <div style={{ minWidth: 0 }}>
                <div style={{
                  fontSize: 13.5, fontWeight: muted ? 500 : 600,
                  color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{row.topic}</div>
                {(row.subtopics || row.secondaryCount > 0) && (
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 3, fontStyle: row.isUnclassified ? 'italic' : 'normal' }}>
                    {row.subtopics}
                    {row.subtopics && row.secondaryCount > 0 ? ' · ' : ''}
                    {row.secondaryCount > 0 && (
                      <span>+{row.secondaryCount} también lo tocan</span>
                    )}
                  </div>
                )}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="num" style={{ fontSize: 14, fontWeight: muted ? 600 : 700, color: 'var(--text)' }}>
                  {fmt(row.total)}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 500, marginTop: 2 }}>{pctOfTotal}%</div>
              </div>
              <DistributionBar neg={row.negative} neu={row.neutral} pos={row.positive} t={row.total} />
            </div>
          );
        })}
        {/* Footer "Total del periodo" — debe cuadrar con el termómetro */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1.4fr 110px 1fr', gap: 16,
          padding: '14px 16px', alignItems: 'center',
          borderTop: '1px solid var(--hairline-strong)',
          background: 'var(--canvas-2)',
        }}>
          <div style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Total del periodo
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="num" style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>{fmt(totals.total)}</div>
          </div>
          <DistributionBar neg={totals.negative} neu={totals.neutral} pos={totals.positive} t={totals.total} />
        </div>
      </div>
      <div style={{ padding: '12px 16px', fontSize: 11, color: 'var(--text-3)', borderTop: '1px solid var(--hairline)', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <Icons.Info size={12} color="var(--text-3)" style={{ flexShrink: 0, marginTop: 1 }} />
        <span>
          Cada mención cuenta una vez bajo su tópico de mayor confianza (mismo
          criterio del correo diario). El "+N también lo tocan" indica
          menciones donde el tópico aparece como tema secundario — verás
          conteos más altos en la pestaña Tópicos por esa razón.
        </span>
      </div>
    </div>
  );
}

// OverviewInsights — 3 columnas (negativos / positivos / resumen general)
// generadas por LLM y cacheadas por (agency, periodStart, periodEnd).
// Patrón cache-or-202: si el endpoint devuelve 'ready' renderiza inmediato.
// Si devuelve 'computing' arranca polling cada 3s hasta cap 90s.
function OverviewInsights({ periodStart, periodEnd, agency }) {
  const [state, setState] = React.useState({ phase: 'loading', data: null, error: null });
  const pollRef = React.useRef(null);
  const startedAt = React.useRef(0);
  const MAX_POLL_MS = 90 * 1000;
  const POLL_INTERVAL_MS = 3 * 1000;

  React.useEffect(() => {
    if (!periodStart || !periodEnd) return;
    setState({ phase: 'loading', data: null, error: null });
    startedAt.current = Date.now();
    const ctrl = new AbortController();

    async function fetchOnce() {
      const params = new URLSearchParams({ from: periodStart, to: periodEnd });
      if (agency) params.set('agency', agency);
      try {
        const res = await fetch('/api/eco-insights?' + params.toString(), {
          credentials: 'same-origin',
          cache: 'no-store',
          signal: ctrl.signal,
        });
        if (res.status === 202) {
          setState((s) => ({ ...s, phase: 'computing' }));
          return 'computing';
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setState({ phase: 'error', data: null, error: body.error || `HTTP ${res.status}` });
          return 'error';
        }
        const json = await res.json();
        setState({ phase: 'ready', data: json, error: null });
        return 'ready';
      } catch (e) {
        if (e?.name === 'AbortError') return 'aborted';
        setState({ phase: 'error', data: null, error: String(e?.message || e) });
        return 'error';
      }
    }

    async function loop() {
      const status = await fetchOnce();
      if (status === 'computing') {
        if (Date.now() - startedAt.current > MAX_POLL_MS) {
          setState({ phase: 'error', data: null, error: 'Timeout esperando insights (>90s)' });
          return;
        }
        pollRef.current = setTimeout(loop, POLL_INTERVAL_MS);
      }
    }
    loop();

    return () => {
      ctrl.abort();
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [periodStart, periodEnd, agency]);

  const eyebrow = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
      <div className="section-eyebrow" style={{ marginBottom: 0 }}>02 · Insights · análisis IA del periodo</div>
      {state.phase === 'computing' && (
        <span style={{ fontSize: 9, color: 'var(--accent)', fontWeight: 700, letterSpacing: '0.06em', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span className="pulse" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)' }} />
          GENERANDO…
        </span>
      )}
      {state.phase === 'ready' && state.data?.stale && (
        <span className="pill pill-info" style={{ fontSize: 9 }} title="Datos cacheados; el lambda está recomputando en background">
          Actualizando…
        </span>
      )}
    </div>
  );

  if (state.phase === 'error') {
    return (
      <div>
        {eyebrow}
        <div className="card" style={{ padding: 16, textAlign: 'center', fontSize: 12, color: 'var(--text-3)' }}>
          No fue posible cargar los insights del periodo: {state.error}
        </div>
      </div>
    );
  }

  const cols = [
    { key: 'negative', title: 'Negativos', accent: 'var(--neg)', items: state.data?.insights?.negative ?? [] },
    { key: 'positive', title: 'Positivos', accent: 'var(--pos)', items: state.data?.insights?.positive ?? [] },
    { key: 'general',  title: 'Resumen del periodo', accent: 'var(--accent)', items: state.data?.dailySummary ? [state.data.dailySummary] : [] },
  ];
  const isLoading = state.phase !== 'ready';
  const allEmpty = !isLoading && cols.every((c) => c.items.length === 0);

  return (
    <div>
      {eyebrow}
      {allEmpty ? (
        <div className="card" style={{ padding: 16, textAlign: 'center', fontSize: 12, color: 'var(--text-3)' }}>
          Sin suficiente señal en el periodo seleccionado para generar insights.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {cols.map((col) => (
            <div key={col.key} className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, borderTop: `2px solid ${col.accent}` }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{col.title}</div>
              {isLoading ? (
                <>
                  <div className="skeleton" style={{ height: 14, marginBottom: 6 }} />
                  <div className="skeleton" style={{ height: 14, marginBottom: 6, width: '92%' }} />
                  <div className="skeleton" style={{ height: 14, width: '78%' }} />
                </>
              ) : col.items.length === 0 ? (
                <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                  Sin {col.key === 'general' ? 'resumen' : 'insights'} para este periodo.
                </div>
              ) : col.key === 'general' ? (
                <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.5 }}
                  dangerouslySetInnerHTML={{ __html: sanitizeBriefingHtml(col.items[0]) }} />
              ) : (
                <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {col.items.map((it, i) => (
                    <li key={i} style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.45, display: 'flex', gap: 8 }}>
                      <span style={{ flexShrink: 0, width: 6, height: 6, borderRadius: '50%', background: col.accent, marginTop: 6 }} />
                      <span>{it}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// NarrativeScreen — análisis de UNA narrativa en timeline (streamgraph)
// ============================================================
const NARRATIVE_STATUS_ORDER = ['peaking', 'active', 'emerging', 'revived', 'declining', 'dormant'];
const NARRATIVE_STATUS_COLORS = {
  peaking: '#FA8C16',
  active: '#52C41A',
  emerging: '#13C2C2',
  revived: '#EB2F96',
  declining: '#FAAD14',
  dormant: '#8C8C8C',
};
const NARRATIVE_STATUS_LABELS = {
  peaking: 'Pico',
  active: 'Activa',
  emerging: 'Emergente',
  revived: 'Revivida',
  declining: 'Decae',
  dormant: 'Dormida',
};

// Catmull-Rom → cubic bezier. Devuelve un string SVG path.
function smoothPath(points) {
  if (!points || points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = i === 0 ? points[0] : points[i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = i + 2 < points.length ? points[i + 2] : p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
}

function NarrativeSparkline({ data, color }) {
  if (!data || data.length === 0) return null;
  const w = 64;
  const h = 18;
  const max = Math.max(...data, 1);
  const stepX = w / Math.max(data.length - 1, 1);
  const points = data.map((v, i) => ({ x: i * stepX, y: h - (v / max) * (h - 2) - 1 }));
  return (
    <svg className="narrative-sparkline" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <path d={smoothPath(points)} fill="none" stroke={color} strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function NarrativeScreen({ agency }) {
  const [narratives, setNarratives] = React.useState([]);
  const [edges, setEdges] = React.useState([]);
  const [focusedId, setFocusedId] = React.useState(null);
  const [search, setSearch] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('all');
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [selectedDay, setSelectedDay] = React.useState(null);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setFocusedId(null);
    setSelectedDay(null);
    Promise.all([
      fetch(`/api/narrative?agency=${agency || ''}&limit=500`, { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : Promise.reject(`narrative ${r.status}`))),
      fetch(`/api/narrative/edges?agency=${agency || ''}&minStrength=0.15`, { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : { edges: [] })),
    ])
      .then(([nRes, eRes]) => {
        if (cancelled) return;
        const list = nRes.narratives || [];
        setNarratives(list);
        setEdges(eRes.edges || []);
        if (list.length > 0) {
          const RANK = { peaking: 0, active: 1, emerging: 2, revived: 3, declining: 4, dormant: 5 };
          const top = [...list].sort((a, b) => {
            const ra = RANK[a.status] ?? 9;
            const rb = RANK[b.status] ?? 9;
            if (ra !== rb) return ra - rb;
            return b.mentionCount - a.mentionCount;
          })[0];
          setFocusedId(top.id);
        }
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(String(e));
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [agency]);

  const statusCounts = React.useMemo(() => {
    const c = { all: narratives.length };
    for (const n of narratives) c[n.status] = (c[n.status] || 0) + 1;
    return c;
  }, [narratives]);

  const filteredNarratives = React.useMemo(() => {
    const RANK = { peaking: 0, active: 1, emerging: 2, revived: 3, declining: 4, dormant: 5 };
    let list = narratives.filter((n) => statusFilter === 'all' || n.status === statusFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (n) =>
          n.name.toLowerCase().includes(q) ||
          (n.summary || '').toLowerCase().includes(q) ||
          (n.keywords || []).some((k) => String(k).toLowerCase().includes(q))
      );
    }
    return list.sort((a, b) => {
      const ra = RANK[a.status] ?? 9;
      const rb = RANK[b.status] ?? 9;
      if (ra !== rb) return ra - rb;
      return b.mentionCount - a.mentionCount;
    });
  }, [narratives, search, statusFilter]);

  const focused = focusedId ? narratives.find((n) => n.id === focusedId) : null;

  return (
    <div className="narrative-screen">
      <aside className="narrative-menu">
        <input
          className="narrative-search"
          placeholder="Buscar narrativa, keyword…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="narrative-status-filters">
          <button
            className={`btn-chip ${statusFilter === 'all' ? 'active' : ''}`}
            onClick={() => setStatusFilter('all')}
          >
            Todas ({statusCounts.all || 0})
          </button>
          {NARRATIVE_STATUS_ORDER.map((s) => {
            const count = statusCounts[s] || 0;
            return (
              <button
                key={s}
                className={`btn-chip ${statusFilter === s ? 'active' : ''} ${count === 0 ? 'disabled' : ''}`}
                onClick={() => count > 0 && setStatusFilter(s)}
                disabled={count === 0}
                title={`${NARRATIVE_STATUS_LABELS[s]} (${count})`}
              >
                <span className="narrative-dot" style={{ background: NARRATIVE_STATUS_COLORS[s] }} />
                {NARRATIVE_STATUS_LABELS[s]} ({count})
              </button>
            );
          })}
        </div>
        <div className="narrative-menu-count">
          {filteredNarratives.length} de {narratives.length} narrativas
        </div>
        <ul className="narrative-list">
          {filteredNarratives.map((n) => (
            <li
              key={n.id}
              className={`narrative-item ${n.id === focusedId ? 'active' : ''}`}
              onClick={() => { setFocusedId(n.id); setSelectedDay(null); }}
            >
              <span className="narrative-dot" style={{ background: NARRATIVE_STATUS_COLORS[n.status] }} />
              <div className="narrative-item-body">
                <div className="narrative-item-name">{n.name}</div>
                <div className="narrative-item-meta">
                  <span>{n.mentionCount.toLocaleString('es')} menc</span>
                  <span>·</span>
                  <span>{NARRATIVE_STATUS_LABELS[n.status] || n.status}</span>
                </div>
              </div>
              {n.sparkline && (
                <NarrativeSparkline data={n.sparkline} color={NARRATIVE_STATUS_COLORS[n.status]} />
              )}
            </li>
          ))}
          {filteredNarratives.length === 0 && !loading && (
            <li className="narrative-empty-li">Sin resultados</li>
          )}
        </ul>
      </aside>

      <main className="narrative-canvas">
        {loading ? (
          <div className="narrative-empty">Cargando…</div>
        ) : error ? (
          <div className="narrative-empty narrative-empty-error">No se pudo cargar: {error}</div>
        ) : !focused ? (
          <div className="narrative-empty">Selecciona una narrativa del menú para ver su análisis.</div>
        ) : (
          <NarrativeAnalysis
            narrative={focused}
            edges={edges}
            allNarratives={narratives}
            agency={agency}
            selectedDay={selectedDay}
            onSelectDay={setSelectedDay}
            onSelectNarrative={(id) => { setFocusedId(id); setSelectedDay(null); }}
          />
        )}
      </main>

      {selectedDay && focused && (
        <NarrativeDayDrawer
          narrative={focused}
          day={selectedDay}
          agency={agency}
          onClose={() => setSelectedDay(null)}
        />
      )}
    </div>
  );
}

function NarrativeAnalysis({ narrative, edges, allNarratives, agency, selectedDay, onSelectDay, onSelectNarrative }) {
  const [detail, setDetail] = React.useState(null);
  const [detailLoading, setDetailLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    setDetailLoading(true);
    fetch(`/api/narrative/${narrative.id}?agency=${agency || ''}`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) { setDetail(d); setDetailLoading(false); } })
      .catch(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [narrative.id, agency]);

  const timeline = detail?.timeline || [];
  const topAuthors = detail?.topAuthors || [];
  const platforms = detail?.platforms || [];
  const recent = detail?.recentMentions || [];

  const related = React.useMemo(() => {
    return edges
      .filter((e) => e.source === narrative.id || e.target === narrative.id)
      .map((e) => {
        const otherId = e.source === narrative.id ? e.target : e.source;
        const other = allNarratives.find((n) => n.id === otherId);
        if (!other) return null;
        return { ...other, edgeType: e.type, strength: e.strength };
      })
      .filter(Boolean)
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 6);
  }, [edges, allNarratives, narrative.id]);

  const sentimentTotals = React.useMemo(() => {
    let p = 0, neu = 0, neg = 0;
    for (const d of timeline) {
      p += d.positive || 0;
      neu += d.neutral || 0;
      neg += d.negative || 0;
    }
    return { positive: p, neutral: neu, negative: neg, total: p + neu + neg };
  }, [timeline]);

  const peak = React.useMemo(() => {
    if (timeline.length === 0) return null;
    return timeline.reduce((acc, d) => (d.mentions > acc.mentions ? d : acc), timeline[0]);
  }, [timeline]);

  const init = narrative.initiatorFirst;
  const inf = narrative.initiatorInfluencer;

  return (
    <div className="narrative-analysis">
      <div className="narrative-header">
        <div className="narrative-header-main">
          <div className="narrative-header-row">
            <span className="narrative-status-pill" style={{ background: NARRATIVE_STATUS_COLORS[narrative.status] }}>
              {NARRATIVE_STATUS_LABELS[narrative.status] || narrative.status}
            </span>
            <h2 className="narrative-title">{narrative.name}</h2>
          </div>
          {narrative.summary && <div className="narrative-summary">{narrative.summary}</div>}
          {(narrative.keywords || []).length > 0 && (
            <div className="narrative-keywords">
              {narrative.keywords.map((k) => (
                <span key={k} className="narrative-tag">{k}</span>
              ))}
            </div>
          )}
        </div>
        <div className="narrative-header-metrics">
          <div className="narrative-metric">
            <div className="narrative-metric-label">Menciones</div>
            <div className="narrative-metric-value">{narrative.mentionCount.toLocaleString('es')}</div>
          </div>
          <div className="narrative-metric">
            <div className="narrative-metric-label">Vel. 24h</div>
            <div className="narrative-metric-value">{Number(narrative.velocity24h || 0).toFixed(1)}</div>
          </div>
          <div className="narrative-metric">
            <div className="narrative-metric-label">Engagement</div>
            <div className="narrative-metric-value">{Number(narrative.totalEngagement || 0).toLocaleString('es')}</div>
          </div>
        </div>
      </div>

      <NarrativeStreamgraph
        timeline={timeline}
        loading={detailLoading}
        selectedDay={selectedDay}
        onSelectDay={onSelectDay}
      />

      <div className="narrative-grid-3">
        <div className="narrative-panel">
          <div className="narrative-panel-label">Sentimiento</div>
          {sentimentTotals.total > 0 ? (
            <>
              <div className="narrative-sentiment-bar">
                <span style={{ flex: sentimentTotals.positive, background: 'var(--pos)' }} />
                <span style={{ flex: sentimentTotals.neutral, background: 'var(--text-3)' }} />
                <span style={{ flex: sentimentTotals.negative, background: 'var(--neg)' }} />
              </div>
              <div className="narrative-sentiment-row">
                <span><i style={{ background: 'var(--pos)' }} /> {Math.round((sentimentTotals.positive / sentimentTotals.total) * 100)}% positivo</span>
                <span><i style={{ background: 'var(--text-3)' }} /> {Math.round((sentimentTotals.neutral / sentimentTotals.total) * 100)}% neutral</span>
                <span><i style={{ background: 'var(--neg)' }} /> {Math.round((sentimentTotals.negative / sentimentTotals.total) * 100)}% negativo</span>
              </div>
              {peak && <div className="narrative-peak">✕ Pico: {peak.day} ({peak.mentions} menciones)</div>}
            </>
          ) : detailLoading ? (
            <div className="narrative-empty-small">Cargando…</div>
          ) : (
            <div className="narrative-empty-small">Sin datos</div>
          )}
        </div>

        <div className="narrative-panel">
          <div className="narrative-panel-label">Top voces</div>
          {topAuthors.length > 0 ? (
            <ul className="narrative-bar-list">
              {topAuthors.slice(0, 6).map((a) => (
                <li key={a.author}>
                  <span className="narrative-bar-name" title={a.author}>{a.author}</span>
                  <span className="narrative-bar-count">{a.mentions}</span>
                </li>
              ))}
            </ul>
          ) : detailLoading ? (
            <div className="narrative-empty-small">Cargando…</div>
          ) : (
            <div className="narrative-empty-small">Sin datos</div>
          )}
        </div>

        <div className="narrative-panel">
          <div className="narrative-panel-label">Plataformas</div>
          {platforms.length > 0 ? (
            <ul className="narrative-bar-list">
              {platforms.slice(0, 6).map((p) => {
                const max = platforms[0].mentions || 1;
                return (
                  <li key={p.platform}>
                    <span className="narrative-bar-name">{p.platform}</span>
                    <span className="narrative-bar-track">
                      <span className="narrative-bar-fill" style={{ width: `${(p.mentions / max) * 100}%` }} />
                    </span>
                    <span className="narrative-bar-count">{p.mentions}</span>
                  </li>
                );
              })}
            </ul>
          ) : detailLoading ? (
            <div className="narrative-empty-small">Cargando…</div>
          ) : (
            <div className="narrative-empty-small">Sin datos</div>
          )}
        </div>
      </div>

      <div className="narrative-grid-2">
        <div className="narrative-panel">
          <div className="narrative-panel-label">Primera mención (cronológica)</div>
          {init ? (
            <div>
              <div className="narrative-init-author">
                <strong>{init.author || '—'}</strong>
                {init.platform && <span className="narrative-tag-mini">{init.platform}</span>}
              </div>
              <div className="narrative-init-date">
                {new Date(init.publishedAt).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' })}
              </div>
              {init.snippet && <div className="narrative-init-snippet">{init.snippet}</div>}
              {init.url && (
                <a href={init.url} target="_blank" rel="noopener noreferrer" className="narrative-link">
                  Ver fuente →
                </a>
              )}
            </div>
          ) : (
            <div className="narrative-empty-small">Sin datos</div>
          )}
        </div>

        <div className="narrative-panel">
          <div className="narrative-panel-label">Voz más influyente (24h)</div>
          {inf ? (
            <div>
              <div className="narrative-init-author">
                <strong>{inf.author || '—'}</strong>
              </div>
              <div className="narrative-init-meta">
                Reach {(inf.reach || 0).toLocaleString('es')} · Eng {(inf.engagement || 0).toLocaleString('es')}
              </div>
              {inf.url && (
                <a href={inf.url} target="_blank" rel="noopener noreferrer" className="narrative-link">
                  Ver fuente →
                </a>
              )}
            </div>
          ) : (
            <div className="narrative-empty-small">Aún sin datos (requiere ≥24h)</div>
          )}
        </div>
      </div>

      {recent.length > 0 && (
        <div className="narrative-panel">
          <div className="narrative-panel-label">Menciones recientes</div>
          <div className="narrative-mentions-list">
            {recent.slice(0, 5).map((m) => (
              <div key={m.id} className="narrative-mention-row">
                <div className="narrative-mention-title">{m.title || '(sin título)'}</div>
                <div className="narrative-mention-meta">
                  {m.author && <span>{m.author}</span>}
                  {m.pageType && <span className="narrative-tag-mini">{m.pageType}</span>}
                  {m.sentiment && <span className={`narrative-sentiment-mini sent-${m.sentiment}`}>{m.sentiment}</span>}
                  <span>{new Date(m.publishedAt).toLocaleDateString('es')}</span>
                  {m.url && <a href={m.url} target="_blank" rel="noopener noreferrer">→</a>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {related.length > 0 && (
        <div className="narrative-panel">
          <div className="narrative-panel-label">Narrativas relacionadas</div>
          <ul className="narrative-related-list">
            {related.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className="narrative-related-btn"
                  onClick={() => onSelectNarrative(r.id)}
                  title={`${r.edgeType} (${(r.strength * 100).toFixed(0)}%)`}
                >
                  <span className="narrative-dot" style={{ background: NARRATIVE_STATUS_COLORS[r.status] }} />
                  <span className="narrative-related-name">{r.name}</span>
                  <span className="narrative-related-meta">{r.edgeType} · {(r.strength * 100).toFixed(0)}%</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function NarrativeStreamgraph({ timeline, loading, selectedDay, onSelectDay }) {
  const w = 1080;
  const h = 240;
  const margin = { top: 20, right: 24, bottom: 32, left: 24 };
  const innerW = w - margin.left - margin.right;
  const innerH = h - margin.top - margin.bottom;

  if (loading) return <div className="narrative-stream-wrap narrative-empty-small">Cargando timeline…</div>;
  if (!timeline || timeline.length === 0) {
    return <div className="narrative-stream-wrap narrative-empty-small">Sin datos temporales todavía.</div>;
  }

  const times = timeline.map((d) => new Date(d.day).getTime());
  const minT = Math.min(...times);
  const maxT = Math.max(...times);
  const span = Math.max(1, maxT - minT);
  const xScale = (t) => margin.left + ((new Date(t).getTime() - minT) / span) * innerW;

  const maxTotal = Math.max(...timeline.map((d) => (d.positive || 0) + (d.neutral || 0) + (d.negative || 0)), 1);
  const yCenter = margin.top + innerH / 2;
  const yScale = (v) => yCenter - (v / maxTotal) * (innerH / 2) * 0.92;

  const stackedPoints = timeline.map((d) => {
    const x = xScale(d.day);
    const total = (d.positive || 0) + (d.neutral || 0) + (d.negative || 0);
    const baseline = -total / 2;
    const negTop = baseline + (d.negative || 0);
    const neuTop = negTop + (d.neutral || 0);
    const posTop = neuTop + (d.positive || 0);
    return {
      x,
      day: d.day,
      mentions: d.mentions || 0,
      baseline_y: yScale(baseline),
      neg_y: yScale(negTop),
      neu_y: yScale(neuTop),
      pos_y: yScale(posTop),
    };
  });

  const buildLayerPath = (upperKey, lowerKey) => {
    const upper = stackedPoints.map((p) => ({ x: p.x, y: p[upperKey] }));
    const lower = stackedPoints.map((p) => ({ x: p.x, y: p[lowerKey] })).reverse();
    const upperD = smoothPath(upper);
    const lowerD = smoothPath(lower).replace(/^M/, 'L');
    return `${upperD} ${lowerD} Z`;
  };

  const layers = [
    { key: 'negative', d: buildLayerPath('neg_y', 'baseline_y'), color: 'var(--neg)' },
    { key: 'neutral', d: buildLayerPath('neu_y', 'neg_y'), color: 'var(--text-3)' },
    { key: 'positive', d: buildLayerPath('pos_y', 'neu_y'), color: 'var(--pos)' },
  ];

  const months = [];
  const cursor = new Date(minT);
  cursor.setDate(1);
  cursor.setHours(0, 0, 0, 0);
  while (cursor.getTime() <= maxT) {
    months.push(new Date(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  const monthEvery = months.length > 12 ? Math.ceil(months.length / 10) : 1;

  const peak = timeline.reduce((acc, d) => (d.mentions > acc.mentions ? d : acc), timeline[0]);
  const peakX = xScale(peak.day);

  return (
    <div className="narrative-stream-wrap">
      <div className="narrative-stream-legend">
        <span className="narrative-stream-key"><i style={{ background: 'var(--pos)' }} /> Positivo</span>
        <span className="narrative-stream-key"><i style={{ background: 'var(--text-3)' }} /> Neutral</span>
        <span className="narrative-stream-key"><i style={{ background: 'var(--neg)' }} /> Negativo</span>
        <span className="narrative-stream-hint">Click un día para ver sus menciones</span>
      </div>
      <svg className="narrative-stream-svg" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet">
        {layers.map((L) => (
          <path key={L.key} d={L.d} fill={L.color} opacity={0.78} />
        ))}
        <line x1={margin.left} y1={yCenter} x2={margin.left + innerW} y2={yCenter} stroke="var(--hairline)" strokeWidth="0.5" opacity={0.5} />

        {stackedPoints.map((p, i) => {
          const prev = stackedPoints[i - 1];
          const next = stackedPoints[i + 1];
          const x0 = prev ? (prev.x + p.x) / 2 : p.x - 2;
          const x1 = next ? (p.x + next.x) / 2 : p.x + 2;
          const isSelected = selectedDay === p.day;
          return (
            <g key={p.day} className="narrative-stream-day" style={{ cursor: 'pointer' }}>
              <rect
                x={x0}
                y={margin.top}
                width={Math.max(1, x1 - x0)}
                height={innerH}
                fill={isSelected ? 'rgba(63, 181, 216, 0.18)' : 'transparent'}
                onClick={() => onSelectDay(p.day)}
              />
              {isSelected && (
                <>
                  <line
                    x1={p.x}
                    y1={margin.top}
                    x2={p.x}
                    y2={margin.top + innerH}
                    stroke="var(--accent)"
                    strokeWidth="1"
                    strokeDasharray="3 3"
                    style={{ pointerEvents: 'none' }}
                  />
                  <circle cx={p.x} cy={yCenter} r="4" fill="var(--accent)" style={{ pointerEvents: 'none' }} />
                </>
              )}
              <title>{`${p.day} · ${p.mentions} menciones`}</title>
            </g>
          );
        })}

        {peak && (
          <g style={{ pointerEvents: 'none' }}>
            <line x1={peakX} y1={margin.top} x2={peakX} y2={margin.top + innerH} stroke="var(--accent)" strokeWidth="0.5" opacity={0.4} />
            <text x={peakX} y={margin.top + 12} textAnchor="middle" fill="var(--accent)" fontSize="10" fontWeight="600">
              ✕ pico
            </text>
          </g>
        )}

        {months.map((d, i) => {
          if (i % monthEvery !== 0) return null;
          const x = xScale(d);
          return (
            <g key={i} style={{ pointerEvents: 'none' }}>
              <line x1={x} y1={margin.top + innerH} x2={x} y2={margin.top + innerH + 4} stroke="var(--hairline-strong)" />
              <text x={x} y={margin.top + innerH + 18} textAnchor="middle" fill="var(--text-2)" fontSize="10">
                {d.toLocaleDateString('es', { month: 'short', year: '2-digit' })}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function NarrativeDayDrawer({ narrative, day, agency, onClose }) {
  const [data, setData] = React.useState(null);
  const [loading, setLoading] = React.useState(true);

  // Cerrar con Escape (mismo patrón que CommandPalette).
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/narrative/${narrative.id}/day?date=${day}&agency=${agency || ''}`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [narrative.id, day, agency]);

  const dateLabel = new Date(day).toLocaleDateString('es', { dateStyle: 'long' });

  return (
    <div className="narrative-day-drawer">
      <div className="narrative-day-overlay" onClick={onClose} />
      <div className="narrative-day-panel">
        <div className="narrative-day-header">
          <div>
            <div className="narrative-day-eyebrow">{narrative.name}</div>
            <div className="narrative-day-title">{dateLabel}</div>
            {data && <div className="narrative-day-count">{data.totalMentions} menciones</div>}
          </div>
          <button className="narrative-day-close" onClick={onClose} aria-label="Cerrar">×</button>
        </div>
        <div className="narrative-day-body">
          {loading ? (
            <div className="narrative-empty-small">Cargando…</div>
          ) : !data || data.totalMentions === 0 ? (
            <div className="narrative-empty-small">No hay menciones registradas en este día.</div>
          ) : (
            ['positivo', 'neutral', 'negativo', 'sin_clasificar'].map((kind) => {
              const items = (data.clusters && data.clusters[kind]) || [];
              if (items.length === 0) return null;
              const label = kind === 'sin_clasificar' ? 'Sin clasificar' : kind.charAt(0).toUpperCase() + kind.slice(1);
              const color = kind === 'positivo' ? 'var(--pos)' : kind === 'negativo' ? 'var(--neg)' : 'var(--text-3)';
              return (
                <div key={kind} className="narrative-day-cluster">
                  <div className="narrative-day-cluster-label">
                    <span className="narrative-dot" style={{ background: color }} />
                    {label} <em>({items.length})</em>
                  </div>
                  {items.map((m) => (
                    <div key={m.id} className="narrative-day-mention">
                      <div className="narrative-day-mention-title">{m.title || '(sin título)'}</div>
                      <div className="narrative-day-mention-meta">
                        {m.author && <strong>{m.author}</strong>}
                        {m.pageType && <span className="narrative-tag-mini">{m.pageType}</span>}
                        <span>· {new Date(m.publishedAt).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}</span>
                        {(m.engagement || 0) > 0 && <span>· {m.engagement} eng</span>}
                      </div>
                      {m.snippet && <div className="narrative-day-mention-snippet">{m.snippet}</div>}
                      {m.url && (
                        <a href={m.url} target="_blank" rel="noopener noreferrer" className="narrative-link">
                          Ver fuente →
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

window.ECO_SCREENS = { OverviewScreen, DashboardScreen, MentionsScreen, SearchScreen, SentimentScreen, TopicsScreen, GeographyScreen, AlertsScreen, SettingsScreen, NarrativeScreen };
