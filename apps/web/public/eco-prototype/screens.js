// Dashboard + screens
const { Sparkline, AreaLineChart, MultiLineChart, StackedAreaChart, Donut, HBarList, RadialGauge, Heatmap, PRMap } = window.ECO_CHARTS;
const { MentionDrawer, MentionsSliceModal } = window.ECO_SHELL;
const D = window.ECO_DATA;
const I2 = window.Icons;

function KpiCard({ label, value, delta, sub, icon, trendData, accent = 'var(--accent)', tone, highlight, invertDelta, children }) {
  const IconC = icon ? I2[icon] : null;
  const deltaColor = delta == null ? 'var(--text-3)' : (invertDelta ? (delta < 0 ? 'var(--pos)' : 'var(--neg)') : (delta > 0 ? 'var(--pos)' : delta < 0 ? 'var(--neg)' : 'var(--text-3)'));
  return (
    <div className="card" style={{ padding: 18, position: 'relative', overflow: 'hidden', borderTop: highlight ? `2px solid ${accent}` : undefined }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        {IconC && <div style={{ width: 26, height: 26, borderRadius: 6, background: 'var(--accent-fill)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: accent }}><IconC size={14} color={accent} /></div>}
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
        {tone && <span className={`pill pill-${tone}`} style={{ marginLeft: 'auto' }}>{tone === 'neg' ? 'Alerta' : tone === 'warn' ? 'Elevado' : 'Normal'}</span>}
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

// =============== DASHBOARD ===============
function DashboardScreen({ onMentionClick, period, setPeriod, setActive }) {
  const m = D.CURRENT_METRICS;
  const [activeMetrics, setActiveMetrics] = useState(['nss', 'totalMentions', 'crisisRiskScore']);
  const [focus, setFocus] = useState('signal'); // signal | narrative | crisis
  const [slice, setSlice] = useState(null);

  const seriesConfig = [
    { key: 'nss', label: 'NSS', color: 'var(--accent)' },
    { key: 'brandHealthIndex', label: 'Brand Health', color: 'var(--pos)' },
    { key: 'totalMentions', label: 'Menciones', color: 'var(--text-2)' },
    { key: 'crisisRiskScore', label: 'Crisis', color: 'var(--neg)' },
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
    // by the API briefing (falls back to the first topic by volume).
    const briefingTopicName = (D.BRIEFING && D.BRIEFING.dominantSignal || '').split(' · ')[0];
    const topic = (briefingTopicName && D.TOPICS.find(t => t.name === briefingTopicName)) || D.TOPICS[0];
    if (topic) openTopicSlice(topic);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ── Executive Briefing ── */}
      <div className="card" style={{ padding: 20, display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 24, alignItems: 'stretch' }}>
        <div>
          <div className="section-eyebrow">Resumen ejecutivo · {(D.BRIEFING && D.BRIEFING.eyebrow) || new Date().toLocaleDateString('es-PR', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
          <div style={{ fontFamily: 'var(--ff-display)', fontSize: 26, fontWeight: 600, lineHeight: 1.25, letterSpacing: 'var(--letter-display)', marginTop: 8, color: 'var(--text)' }}>
            {D.BRIEFING ? (
              <>
                {D.BRIEFING.narrative.pre}{' '}
                <span style={{ color: `var(--${D.BRIEFING.narrative.verbTone === 'pos' ? 'pos' : D.BRIEFING.narrative.verbTone === 'neg' ? 'neg' : 'warn'})` }}>
                  {D.BRIEFING.narrative.verb}
                </span>
                {D.BRIEFING.narrative.linkPre}
                <strong>{D.BRIEFING.narrative.emphasis}</strong>
                {D.BRIEFING.narrative.linkPost}
              </>
            ) : (
              <>Sin suficientes menciones en este período para generar un resumen.</>
            )}
          </div>
          <div style={{ display: 'flex', gap: 20, marginTop: 20, fontSize: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ color: 'var(--text-3)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>Señal dominante</div>
              <div style={{ color: 'var(--text)', fontWeight: 600, marginTop: 2 }}>{(D.BRIEFING && D.BRIEFING.dominantSignal) || '—'}</div>
            </div>
            <div>
              <div style={{ color: 'var(--text-3)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>Alcance del período</div>
              <div className="num" style={{ color: 'var(--text)', fontWeight: 600, marginTop: 2 }}>{(D.BRIEFING && D.BRIEFING.reachLabel) || (m?.totalReach ? fmt(m.totalReach) + ' impresiones' : '—')}</div>
            </div>
            <div>
              <div style={{ color: 'var(--text-3)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>Acción recomendada</div>
              <div style={{ color: 'var(--accent)', fontWeight: 600, marginTop: 2 }}>{(D.BRIEFING && D.BRIEFING.action) || 'Monitorear tópicos activos →'}</div>
            </div>
          </div>
          <div style={{ marginTop: 18, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn btn-primary" onClick={openBriefingSlice} style={{ fontSize: 12 }}>
              <Icons.Eye size={13} /> Ver menciones
            </button>
            <span style={{ width: 1, height: 16, background: 'var(--hairline)', margin: '0 4px' }} />
            <button className={`chip ${focus === 'signal' ? 'active' : ''}`} onClick={() => setFocus('signal')}>Señal del día</button>
            <button className={`chip ${focus === 'narrative' ? 'active' : ''}`} onClick={() => setFocus('narrative')}>Narrativas emergentes</button>
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

      {/* ── Hero KPIs: NSS + Crisis prominent ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1.3fr 1fr 1fr', gap: 12 }}>
        <KpiCard label="Net Sentiment Score" value={`${m.nss > 0 ? '+' : ''}${m.nss}`} delta={m.nssDelta} sub="vs 30d ant." icon="Activity" accent="var(--accent)" highlight trendData={D.TIMELINE.map(t => t.nss)}>
          <div style={{ display: 'flex', gap: 16, fontSize: 10, color: 'var(--text-3)', marginTop: -4 }}>
            <span>7d <strong className="num" style={{ color: 'var(--text-2)' }}>{m.nss7d > 0 ? '+' : ''}{m.nss7d}</strong></span>
            <span>30d <strong className="num" style={{ color: 'var(--text-2)' }}>{m.nss30d > 0 ? '+' : ''}{m.nss30d}</strong></span>
          </div>
        </KpiCard>
        <KpiCard label="Riesgo de crisis" value={m.crisisRiskScore.toFixed(1)} delta={m.crisisDelta} sub="vs ayer" icon="Shield" accent="var(--neg)" tone="neg" invertDelta highlight>
          <div style={{ marginTop: -2 }}>
            <div style={{ height: 6, borderRadius: 3, background: 'linear-gradient(90deg, var(--pos) 0%, var(--pos) 16%, var(--warn) 16%, var(--warn) 50%, var(--neg) 50%, var(--neg) 100%)', position: 'relative' }}>
              <div style={{ position: 'absolute', left: `${Math.min((m.crisisRiskScore/3)*100,100)}%`, top: -3, width: 12, height: 12, borderRadius: '50%', background: 'var(--canvas)', border: '2px solid var(--neg)', transform: 'translateX(-50%)' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--text-3)', marginTop: 4, fontFamily: 'var(--ff-mono)' }}>
              <span>NORMAL</span><span>ELEVADO</span><span>ALERTA</span><span>CRISIS</span>
            </div>
          </div>
        </KpiCard>
        <KpiCard label="Volumen · 30d" value={fmt(m.totalMentions)} delta={m.totalMentionsDelta} sub="%" icon="MessageSquare" accent="var(--text-2)" trendData={D.TIMELINE.map(t => t.totalMentions)} />
        <KpiCard label="Brand Health" value={m.brandHealthIndex.toFixed(2)} delta={m.brandHealthDelta} icon="Heart" accent="var(--pos)">
          <BrandHealthMini value={m.brandHealthIndex} />
        </KpiCard>
      </div>

      {/* ── Row 2: Timeline (8) + Topic composition (4) ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
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
            {/* Timeframe selector — drives the global period (same as header pills) */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 8, fontSize: 10, justifyContent: 'flex-end' }}>
              {['1D', '5D', '1M', '3M', '6M', '1A', 'Max'].map((tf) => (
                <button key={tf}
                  onClick={() => setPeriod && setPeriod(tf)}
                  className={`chip ${period === tf ? 'active' : ''}`}
                  style={{ padding: '2px 8px', fontSize: 10, fontFamily: 'var(--ff-numeric)', fontWeight: 600 }}>{tf}</button>
              ))}
            </div>
            <MultiLineChart data={D.TIMELINE} series={seriesConfig.filter(s => activeMetrics.includes(s.key))} height={240} onPointClick={openTimelineDaySlice} />
          </div>
        </div>

        <DashSentimentCard total={m.totalMentions} nss={m.nss} onSliceClick={(name) => {
          const row = D.SENTIMENT_BREAKDOWN.find(s => s.name === name);
          if (!row) return;
          const accent = name === 'positivo' ? 'var(--pos)' : name === 'negativo' ? 'var(--neg)' : 'var(--text-3)';
          const senti = { pos: 0, neu: 0, neg: 0 };
          senti[name === 'positivo' ? 'pos' : name === 'negativo' ? 'neg' : 'neu'] = row.value;
          setSlice({
            eyebrow: 'Sentimiento',
            title: `Menciones ${row.label.toLowerCase()}`,
            accent,
            mentions: [],
            _filter: { sentiment: name },
          });
        }} />
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

      {/* ── Recent mentions table (dense) ── */}
      <div className="card">
        <div className="card-hd">
          <div><div className="card-hd-title">Menciones destacadas</div><div className="card-hd-sub">Ordenadas por pertinencia × engagement</div></div>
          <a href="#mentions" className="link" style={{ fontSize: 12 }}>Ver todas ({fmt(m.totalMentions)}) →</a>
        </div>
        <div>
          {D.MENTIONS.slice(0, 7).map((mn, idx) => {
            const sourceIcon = { facebook: 'Facebook', twitter: 'Twitter', news: 'Newspaper', instagram: 'Instagram', youtube: 'Youtube' }[mn.source] || 'Globe';
            const SIcon = Icons[sourceIcon];
            const sc = mn.sentiment === 'positivo' ? 'pill-pos' : mn.sentiment === 'negativo' ? 'pill-neg' : 'pill-neu';
            return (
              <div key={mn.id} onClick={() => onMentionClick(mn)}
                className="row-hover"
                style={{
                  display: 'grid', gridTemplateColumns: '20px 2fr 130px 90px 80px 90px 80px', gap: 12,
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
                <span style={{ fontSize: 11, color: mn.pertinence === 'alta' ? 'var(--neg)' : 'var(--warn)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {mn.pertinence}
                </span>
                <span className="num" style={{ color: 'var(--text-2)', fontWeight: 600, textAlign: 'right' }}>{fmt(mn.engagement)}</span>
                <span style={{ color: 'var(--text-3)', fontSize: 11 }}>{mn.publishedAt}</span>
                <div style={{ width: 60 }}><Sparkline data={Array.from({ length: 8 }, (_, i) => Math.random() * 10)} width={60} height={18} color={mn.sentiment === 'negativo' ? 'var(--neg)' : 'var(--pos)'} fill={false} /></div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// --- BrandHealthMini: a more interesting KPI readout (segmented gauge) ---
function BrandHealthMini({ value }) {
  // value 0..1. Segments: Crítico (0-.4), Débil (.4-.6), Sano (.6-.8), Fuerte (.8-1)
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
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 9, color: 'var(--text-3)', fontWeight: 600, letterSpacing: '0.04em' }}>
        <span>CRÍT</span><span>DÉB</span><span>SANO</span><span>FUERTE</span>
      </div>
      <div style={{ fontSize: 10, color: bandColor, fontWeight: 700, marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{bandLabel}</div>
    </div>
  );
}

// --- DashSentimentCard: redesigned with donut + prominent legend rows (clickable) ---
function DashSentimentCard({ total, nss, onSliceClick }) {
  const safeTotal = (D.SENTIMENT_BREAKDOWN || []).reduce((s, x) => s + (x.value || 0), 0) || total || 0;
  const pctOf = (v) => safeTotal > 0 ? Math.round((v / safeTotal) * 100) : 0;
  return (
    <div className="card">
      <div className="card-hd">
        <div>
          <div className="card-hd-title">Sentimiento</div>
          <div className="card-hd-sub">Distribución · {fmt(safeTotal)} menciones</div>
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 600 }}>
          NSS <span className="num" style={{ color: 'var(--accent)', fontSize: 13, fontWeight: 700 }}>+{nss}</span>
        </div>
      </div>
      <div className="card-bd" style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <Donut data={D.SENTIMENT_BREAKDOWN} size={120} thickness={18} colors={['var(--pos)', 'var(--text-3)', 'var(--neg)']} />
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            <div className="num" style={{ fontSize: 22, fontWeight: 600, fontFamily: 'var(--ff-display)', color: 'var(--text)', lineHeight: 1 }}>
              {pctOf((D.SENTIMENT_BREAKDOWN.find(s => s.name === 'positivo') || {}).value || 0)}%
            </div>
            <div style={{ fontSize: 9, color: 'var(--text-3)', fontWeight: 600, letterSpacing: '0.06em', marginTop: 2 }}>POSITIVO</div>
          </div>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {D.SENTIMENT_BREAKDOWN.map((s) => {
            const pct = pctOf(s.value);
            const c = s.name === 'positivo' ? 'var(--pos)' : s.name === 'negativo' ? 'var(--neg)' : 'var(--text-3)';
            return (
              <button key={s.name} onClick={() => onSliceClick(s.name)}
                className="row-hover"
                style={{
                  display: 'grid', gridTemplateColumns: '8px 1fr auto auto 12px',
                  gap: 8, alignItems: 'center',
                  padding: '6px 8px', marginInline: -8, borderRadius: 6,
                  background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left',
                }}>
                <span className="dot" style={{ background: c, width: 8, height: 8 }} />
                <span style={{ fontSize: 12, color: 'var(--text)', fontWeight: 500 }}>{s.label}</span>
                <span className="num" style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600 }}>{fmt(s.value)}</span>
                <span className="num" style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', minWidth: 36, textAlign: 'right' }}>{pct}%</span>
                <Icons.ArrowRight size={11} color="var(--text-3)" />
              </button>
            );
          })}
        </div>
      </div>
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
          cellSize={11}
          onCellClick={onCellClick}
        />
      </div>
    </div>
  );
}

// =============== MENTIONS ===============
function MentionsScreen({ onMentionClick }) {
  const [sentiment, setSentiment] = useState('all');
  const [source, setSource] = useState('all');
  const [pertinence, setPertinence] = useState('all');
  const [query, setQuery] = useState('');
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('eco.viewMode') || 'list');
  const [moreOpen, setMoreOpen] = useState(false);
  const [sortBy, setSortBy] = useState({ key: 'recent', dir: 'desc' });
  const [showCount, setShowCount] = useState(20);

  React.useEffect(() => { localStorage.setItem('eco.viewMode', viewMode); }, [viewMode]);

  let filtered = D.MENTIONS;
  if (sentiment !== 'all') filtered = filtered.filter(m => m.sentiment === sentiment);
  if (source !== 'all') filtered = filtered.filter(m => m.source === source);
  if (pertinence !== 'all') filtered = filtered.filter(m => m.pertinence === pertinence);
  if (query) filtered = filtered.filter(m => m.title.toLowerCase().includes(query.toLowerCase()));

  // Sort
  filtered = [...filtered];
  const sortFns = {
    recent: (a, b) => 0, // API already returns newest first
    engagement: (a, b) => (a.engagement || 0) - (b.engagement || 0),
    pertinence: (a, b) => ({ alta: 3, media: 2, baja: 1 }[a.pertinence] || 0) - ({ alta: 3, media: 2, baja: 1 }[b.pertinence] || 0),
    sentiment: (a, b) => ({ positivo: 3, neutral: 2, negativo: 1 }[a.sentiment] || 0) - ({ positivo: 3, neutral: 2, negativo: 1 }[b.sentiment] || 0),
  };
  if (sortFns[sortBy.key]) filtered.sort((a, b) => (sortBy.dir === 'desc' ? -1 : 1) * sortFns[sortBy.key](a, b));

  const visible = filtered.slice(0, showCount);

  function exportCsv() {
    const header = ['Título', 'Sentimiento', 'Pertinencia', 'Engagement', 'Tópico', 'Subtópicos', 'Municipio', 'Fuente', 'Publicado', 'URL'];
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = filtered.map((m) => [m.title, m.sentiment, m.pertinence, m.engagement, m.topicName || m.topic, (m.subtopics || []).join('; '), m.municipality, m.source, m.publishedAt, m.url || ''].map(esc).join(','));
    const csv = [header.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `eco-menciones-${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Filter bar */}
      <div className="card" style={{ padding: 14, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 240 }}>
          <Icons.Search size={14} color="var(--text-3)" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
          <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar en menciones…" style={{ paddingLeft: 34 }} />
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {[{ k: 'all', l: 'Todas' }, { k: 'positivo', l: 'Positivo', tone: 'pos' }, { k: 'neutral', l: 'Neutral' }, { k: 'negativo', l: 'Negativo', tone: 'neg' }].map((x) => (
            <button key={x.k} onClick={() => setSentiment(x.k)} className={`chip ${sentiment === x.k ? 'active' : ''}`}>
              {x.tone && <span className="dot" style={{ background: `var(--${x.tone})` }} />}{x.l}
            </button>
          ))}
        </div>
        <div style={{ width: 1, height: 24, background: 'var(--hairline)' }} />
        <select className="input" value={source} onChange={(e) => setSource(e.target.value)} style={{ width: 160 }}>
          <option value="all">Todas las fuentes</option>
          <option value="facebook">Facebook</option>
          <option value="twitter">X / Twitter</option>
          <option value="news">Noticias</option>
          <option value="instagram">Instagram</option>
          <option value="youtube">YouTube</option>
        </select>
        <div style={{ position: 'relative' }}>
          <button className="btn" onClick={() => setMoreOpen((v) => !v)}>
            <Icons.Filter size={13} /> Más filtros {pertinence !== 'all' && <span style={{ color: 'var(--accent)', fontSize: 10 }}>·1</span>}
          </button>
          {moreOpen && (
            <div className="card" style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 80, padding: 12, minWidth: 220, boxShadow: '0 8px 24px -8px rgba(0,0,0,0.4)' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Pertinencia</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 10 }}>
                {['all', 'alta', 'media', 'baja'].map((p) => (
                  <button key={p} className={`chip ${pertinence === p ? 'active' : ''}`} onClick={() => setPertinence(p)}>
                    {p === 'all' ? 'Todas' : p}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Ordenar por</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {[{ k: 'recent', l: 'Reciente' }, { k: 'engagement', l: 'Engagement' }, { k: 'pertinence', l: 'Pertinencia' }, { k: 'sentiment', l: 'Sentimiento' }].map((o) => (
                  <button key={o.k} className={`chip ${sortBy.key === o.k ? 'active' : ''}`} onClick={() => setSortBy({ key: o.k, dir: 'desc' })}>
                    {o.l}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{filtered.length} de {D.MENTIONS.length}</span>
        <button className="btn" onClick={exportCsv} disabled={filtered.length === 0}>
          <Icons.Download size={13} /> CSV
        </button>
      </div>

      {/* Quick metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
        {[
          { l: 'Total', v: fmt(D.CURRENT_METRICS.totalMentions), t: null },
          { l: 'Alcance', v: fmt(D.CURRENT_METRICS.totalReach), t: null },
          { l: 'Alta pertinencia', v: fmt(D.CURRENT_METRICS.highPertinenceCount), t: 'warn' },
          { l: 'Engagement rate', v: D.CURRENT_METRICS.engagementRate + '%', t: null },
          { l: 'Virales (>5K)', v: '23', t: 'neg' },
        ].map((k, i) => (
          <div key={i} className="card" style={{ padding: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{k.l}</div>
            <div className="num" style={{ fontSize: 22, fontWeight: 600, color: k.t === 'neg' ? 'var(--neg)' : k.t === 'warn' ? 'var(--warn)' : 'var(--text)', marginTop: 6, fontFamily: 'var(--ff-display)' }}>{k.v}</div>
          </div>
        ))}
      </div>

      {/* Mentions table */}
      <div className="card">
        <div className="card-hd">
          <div><div className="card-hd-title">Menciones</div><div className="card-hd-sub">Ordenar: Más recientes</div></div>
          <div style={{ display: 'flex', gap: 6, fontSize: 11 }}>
            {[
              { k: 'list', l: 'Lista', icon: 'List' },
              { k: 'cards', l: 'Cards', icon: 'Grid' },
              { k: 'table', l: 'Tabla', icon: 'Table' },
            ].map(o => {
              const IC = Icons[o.icon] || Icons.List;
              return (
                <button key={o.k} onClick={() => setViewMode(o.k)} className={`chip ${viewMode === o.k ? 'active' : ''}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <IC size={11} /> {o.l}
                </button>
              );
            })}
          </div>
        </div>
        {viewMode === 'list' && <MentionsList mentions={visible} onMentionClick={onMentionClick} />}
        {viewMode === 'cards' && <MentionsCards mentions={visible} onMentionClick={onMentionClick} />}
        {viewMode === 'table' && <MentionsTable mentions={visible} onMentionClick={onMentionClick} sortBy={sortBy} setSortBy={setSortBy} />}
        {visible.length < filtered.length && (
          <div style={{ padding: 14, textAlign: 'center', borderTop: '1px solid var(--hairline)' }}>
            <button className="chip" onClick={() => setShowCount((n) => n + 20)}>
              Cargar más ({filtered.length - visible.length} restantes)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Mentions: List view (dense table-row) ---
function MentionsList({ mentions, onMentionClick }) {
  return (
    <>
      <div style={{ padding: '10px 16px 6px', display: 'grid', gridTemplateColumns: '20px 2fr 110px 80px 80px 90px 80px 80px 30px', gap: 12, fontSize: 10, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', borderBottom: '1px solid var(--hairline)' }}>
        <span /><span>Mención</span><span>Sentimiento</span><span>Pertinencia</span><span style={{ textAlign: 'right' }}>Engagement</span><span>Tópico</span><span>Hora</span><span>Tendencia</span><span />
      </div>
      {mentions.map((mn) => {
        const sourceIcon = { facebook: 'Facebook', twitter: 'Twitter', news: 'Newspaper', instagram: 'Instagram', youtube: 'Youtube' }[mn.source] || 'Globe';
        const SIcon = Icons[sourceIcon];
        const sc = mn.sentiment === 'positivo' ? 'pill-pos' : mn.sentiment === 'negativo' ? 'pill-neg' : 'pill-neu';
        return (
          <div key={mn.id} onClick={() => onMentionClick(mn)} className="row-hover"
            style={{ display: 'grid', gridTemplateColumns: '20px 2fr 110px 80px 80px 90px 80px 80px 30px', gap: 12, alignItems: 'center', padding: '12px 16px', borderTop: '1px solid var(--hairline)', fontSize: 12, cursor: 'pointer' }}>
            <SIcon size={14} color="var(--text-3)" />
            <div style={{ overflow: 'hidden' }}>
              <div style={{ color: 'var(--text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{mn.title}</div>
              <div style={{ color: 'var(--text-3)', fontSize: 10 }}>{mn.author} · {mn.domain}</div>
            </div>
            <span className={`pill ${sc}`} style={{ justifySelf: 'start' }}>{mn.sentiment}</span>
            <span style={{ fontSize: 11, color: mn.pertinence === 'alta' ? 'var(--neg)' : 'var(--warn)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{mn.pertinence}</span>
            <span className="num" style={{ color: 'var(--text-2)', fontWeight: 600, textAlign: 'right' }}>{fmt(mn.engagement)}</span>
            <span style={{ color: 'var(--text-2)', fontSize: 11, textTransform: 'capitalize' }}>{mn.topic}</span>
            <span style={{ color: 'var(--text-3)', fontSize: 11 }}>{mn.publishedAt}</span>
            <div style={{ width: 60 }}><Sparkline data={Array.from({length:8},()=>Math.random()*10)} width={60} height={18} color={mn.sentiment === 'negativo' ? 'var(--neg)' : 'var(--pos)'} fill={false} /></div>
            <Icons.ChevronRight size={14} color="var(--text-3)" />
          </div>
        );
      })}
    </>
  );
}

// --- Mentions: Cards view (rich tiles) ---
function MentionsCards({ mentions, onMentionClick }) {
  return (
    <div style={{ padding: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 12 }}>
      {mentions.map((mn) => {
        const sourceIcon = { facebook: 'Facebook', twitter: 'Twitter', news: 'Newspaper', instagram: 'Instagram', youtube: 'Youtube' }[mn.source] || 'Globe';
        const SIcon = Icons[sourceIcon];
        const sc = mn.sentiment === 'positivo' ? 'pill-pos' : mn.sentiment === 'negativo' ? 'pill-neg' : 'pill-neu';
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
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{mn.title}</div>
            {mn.excerpt && <div style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{mn.excerpt}</div>}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, color: 'var(--text-3)', paddingTop: 8, borderTop: '1px solid var(--hairline)' }}>
              <span style={{ fontWeight: 600, color: 'var(--text-2)' }}>{mn.author}</span>
              <span style={{ marginLeft: 'auto' }} className="num">{fmt(mn.engagement)} eng.</span>
              <span style={{ fontSize: 10, color: mn.pertinence === 'alta' ? 'var(--neg)' : 'var(--warn)', fontWeight: 600, textTransform: 'uppercase' }}>{mn.pertinence}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// --- Mentions: Table view (compact with more columns) ---
function MentionsTable({ mentions, onMentionClick, sortBy, setSortBy }) {
  const columns = [
    { key: null, l: '' },
    { key: null, l: 'ID' },
    { key: null, l: 'Título' },
    { key: null, l: 'Autor' },
    { key: null, l: 'Dominio' },
    { key: 'sentiment', l: 'Sentim.' },
    { key: 'pertinence', l: 'Pert.' },
    { key: 'engagement', l: 'Engage.' },
    { key: null, l: 'Alcance' },
    { key: null, l: 'Tópico' },
    { key: null, l: 'Municipio' },
    { key: 'recent', l: 'Fecha' },
  ];
  const toggle = (k) => {
    if (!k || !setSortBy) return;
    setSortBy((s) => s.key === k ? { key: k, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key: k, dir: 'desc' });
  };
  return (
    <div style={{ overflow: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--hairline-strong)', background: 'var(--canvas-2)' }}>
            {columns.map((c) => {
              const sortable = !!c.key;
              const active = sortBy && sortBy.key === c.key;
              return (
                <th key={c.l}
                  onClick={() => toggle(c.key)}
                  style={{ padding: '8px 10px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: active ? 'var(--accent)' : 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', whiteSpace: 'nowrap', cursor: sortable ? 'pointer' : 'default', userSelect: 'none' }}>
                  {c.l}{sortable && active ? (sortBy.dir === 'desc' ? ' ↓' : ' ↑') : ''}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {mentions.map(mn => {
            const sourceIcon = { facebook: 'Facebook', twitter: 'Twitter', news: 'Newspaper', instagram: 'Instagram', youtube: 'Youtube' }[mn.source] || 'Globe';
            const SIcon = Icons[sourceIcon];
            const sc = mn.sentiment === 'positivo' ? 'pill-pos' : mn.sentiment === 'negativo' ? 'pill-neg' : 'pill-neu';
            return (
              <tr key={mn.id} onClick={() => onMentionClick(mn)} className="row-hover" style={{ borderBottom: '1px solid var(--hairline)', cursor: 'pointer' }}>
                <td style={{ padding: '8px 10px' }}><SIcon size={12} color="var(--text-3)" /></td>
                <td className="num" style={{ padding: '8px 10px', color: 'var(--text-3)', fontSize: 10 }}>#{mn.id}</td>
                <td style={{ padding: '8px 10px', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>{mn.title}</td>
                <td style={{ padding: '8px 10px', color: 'var(--text-2)', whiteSpace: 'nowrap' }}>{mn.author}</td>
                <td style={{ padding: '8px 10px', color: 'var(--text-2)' }}>{mn.domain}</td>
                <td style={{ padding: '8px 10px' }}><span className={`pill ${sc}`}>{mn.sentiment}</span></td>
                <td style={{ padding: '8px 10px', fontWeight: 600, color: mn.pertinence === 'alta' ? 'var(--neg)' : 'var(--warn)', textTransform: 'uppercase', fontSize: 10 }}>{mn.pertinence}</td>
                <td className="num" style={{ padding: '8px 10px', textAlign: 'right' }}>{fmt(mn.engagement)}</td>
                <td className="num" style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--text-2)' }}>{fmt(mn.reach || mn.engagement * 15)}</td>
                <td style={{ padding: '8px 10px', color: 'var(--text-2)', textTransform: 'capitalize' }}>{mn.topic}</td>
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

// =============== SENTIMENT ===============
function SentimentScreen({ onMentionClick }) {
  const [slice, setSlice] = useState(null);
  const m = D.CURRENT_METRICS;

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

  function openSourceSlice(s, sentimentType) {
    const accent = sentimentType === 'positivo' ? 'var(--pos)' : sentimentType === 'negativo' ? 'var(--neg)' : 'var(--text-3)';
    const sourceKey = {
      'Facebook': 'facebook', 'Twitter': 'twitter', 'X / Twitter': 'twitter',
      'Noticias': 'news', 'Instagram': 'instagram', 'YouTube': 'youtube', 'Blogs': 'blog',
    }[s.source] || (s.source || '').toLowerCase();
    setSlice({
      eyebrow: `Fuente · ${s.source}`,
      title: `Sentimiento ${sentimentType}`,
      accent,
      mentions: [],
      _filter: { source: sourceKey, sentiment: sentimentType },
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Narrative hero */}
      <div className="card" style={{ padding: 20, display: 'grid', gridTemplateColumns: '1fr auto', gap: 24, alignItems: 'center' }}>
        <div>
          <div className="section-eyebrow">Balance de sentimiento · 30 días</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginTop: 8 }}>
            <div className="num" style={{ fontSize: 56, fontWeight: 500, color: 'var(--accent)', lineHeight: 1, fontFamily: 'var(--ff-display)' }}>+{m.nss}</div>
            <div style={{ fontSize: 13, color: 'var(--text-2)' }}>NSS</div>
            <div style={{ marginLeft: 24, fontSize: 12, color: 'var(--neg)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
              <Icons.ArrowDown size={12} /> 3.2 vs período anterior
            </div>
          </div>
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
              const pct = Math.round((s.value / m.totalMentions) * 100);
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
            <StackedAreaChart data={D.TIMELINE} keys={['positivo', 'neutral', 'negativo']} colors={['var(--pos)', 'var(--text-3)', 'var(--neg)']} height={260} onPointClick={openTimelineDaySlice} />
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
        <div className="card-hd"><div><div className="card-hd-title">Sentimiento por fuente</div><div className="card-hd-sub">Distribución normalizada · click un segmento para ver menciones</div></div></div>
        <div className="card-bd" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 18 }}>
          {D.SENTIMENT_BY_SOURCE.map((s) => {
            const total = s.positivo + s.neutral + s.negativo;
            const pos = Math.round((s.positivo/total)*100);
            const neu = Math.round((s.neutral/total)*100);
            const neg = 100 - pos - neu;
            return (
              <div key={s.source}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                  <span style={{ fontWeight: 500 }}>{s.source}</span>
                  <span className="num" style={{ color: 'var(--text-3)' }}>{fmt(total)}</span>
                </div>
                <div style={{ display: 'flex', height: 12, borderRadius: 4, overflow: 'hidden', background: 'var(--canvas-2)' }}>
                  <button onClick={() => openSourceSlice(s, 'positivo')} title={`${pos}% positivo — click para ver menciones`}
                    style={{ width: `${pos}%`, background: 'var(--pos)', border: 'none', cursor: 'pointer', padding: 0 }} />
                  <button onClick={() => openSourceSlice(s, 'neutral')} title={`${neu}% neutral — click para ver menciones`}
                    style={{ width: `${neu}%`, background: 'var(--text-3)', border: 'none', cursor: 'pointer', padding: 0 }} />
                  <button onClick={() => openSourceSlice(s, 'negativo')} title={`${neg}% negativo — click para ver menciones`}
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

// --- Emotions card — redesigned ---
function EmotionsCard({ emotions, onEmotionClick }) {
  const sorted = [...emotions].sort((a, b) => b.count - a.count);
  const total = sorted.reduce((s, e) => s + e.count, 0);
  const top = sorted[0];
  // Circumplex quadrants: pleasantness x activation
  // For now, grouping into 4 buckets by color tone
  const toneFamily = { neg: 'Desagradable', pos: 'Agradable', warn: 'Alerta', text: 'Neutral' };

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
        {/* Top emotion hero */}
        <button onClick={() => onEmotionClick(top)}
          className="row-hover"
          style={{
            display: 'flex', alignItems: 'center', gap: 14,
            padding: '12px 14px', borderRadius: 8,
            background: `color-mix(in oklab, var(--${top.color}) 8%, var(--canvas))`,
            border: `1px solid color-mix(in oklab, var(--${top.color}) 25%, var(--hairline))`,
            cursor: 'pointer', textAlign: 'left', width: '100%',
          }}>
          <div style={{
            width: 48, height: 48, borderRadius: '50%',
            background: `var(--${top.color})`, opacity: 0.15,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <div style={{ width: 22, height: 22, borderRadius: '50%', background: `var(--${top.color})` }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: `var(--${top.color})` }}>Emoción dominante</div>
            <div style={{ fontSize: 18, fontWeight: 600, fontFamily: 'var(--ff-display)', color: 'var(--text)', marginTop: 2 }}>{top.emotion}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="num" style={{ fontSize: 22, fontWeight: 600, color: 'var(--text)', lineHeight: 1 }}>{fmt(top.count)}</div>
            <div className="num" style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 4 }}>{Math.round((top.count / total) * 100)}% del total</div>
          </div>
          <Icons.ArrowRight size={14} color="var(--text-3)" />
        </button>

        {/* All emotions as a rank */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {sorted.map((e, i) => {
            const pct = (e.count / sorted[0].count) * 100;
            return (
              <button key={e.emotion} onClick={() => onEmotionClick(e)}
                className="row-hover"
                style={{
                  display: 'grid', gridTemplateColumns: '18px 1fr 1fr 50px 12px',
                  gap: 10, alignItems: 'center',
                  padding: '6px 8px', marginInline: -8, borderRadius: 6,
                  background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left',
                  fontSize: 12,
                }}>
                <span className="mono" style={{ fontSize: 9, color: 'var(--text-3)', fontWeight: 600 }}>{String(i + 1).padStart(2, '0')}</span>
                <span style={{ color: 'var(--text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.emotion}</span>
                <div className="bar-track" style={{ height: 4 }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: `var(--${e.color})`, borderRadius: 'inherit', transition: 'width 0.3s var(--ease)' }} />
                </div>
                <span className="num" style={{ textAlign: 'right', color: 'var(--text-2)', fontWeight: 600 }}>{fmt(e.count)}</span>
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
  const [selected, setSelected] = useState(null); // null = overview, else slug for drill-in
  const [view, setView] = useState('treemap'); // treemap | bubbles | list
  const [dayModal, setDayModal] = useState(null); // { date, fullDate, topicSlug, topicName, volume, sentiment }
  const sel = selected ? D.TOPICS.find(t => t.slug === selected) : null;
  const subs = sel ? (D.SUBTOPICS[sel.slug] || []) : [];

  // Build a "topic of the day" calendar for last ~35 days from TIMELINE + TOPICS
  const calendarData = React.useMemo(() => {
    const days = D.TIMELINE.slice(-35);
    return days.map((d, i) => {
      // Deterministic "main topic" rotation so the calendar reads stable
      const topic = D.TOPICS[(i * 7 + Math.floor(d.totalMentions / 400)) % D.TOPICS.length];
      const sentiment = (i + Math.floor(d.negativo / 80)) % 3 === 0 ? 'negativo' : (i % 4 === 0 ? 'positivo' : 'neutral');
      return {
        date: d.date,
        fullDate: d.fullDate,
        volume: d.totalMentions,
        topicSlug: topic.slug,
        topicName: topic.name,
        sentiment,
      };
    });
  }, []);

  // Drill-in view
  if (sel) return <TopicDetail topic={sel} subs={subs} onBack={() => setSelected(null)} />;

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
          {view === 'treemap' && <TopicTreemap topics={D.TOPICS} onSelect={setSelected} />}
          {view === 'bubbles' && <TopicBubbles topics={D.TOPICS} onSelect={setSelected} />}
          {view === 'list' &&    <TopicList topics={D.TOPICS} onSelect={setSelected} />}
        </div>
      </div>

      {/* Calendario de tópico principal por día */}
      <TopicCalendar data={calendarData} onSelect={setSelected} onDayClick={setDayModal} />

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
              onCta: () => { setDayModal(null); setSelected(dayModal.topicSlug); },
            }}
            onClose={() => setDayModal(null)}
            onMentionClick={onMentionClick}
          />
        );
      })()}
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
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', height: 3, width: 60, borderRadius: 2, overflow: 'hidden', background: 'rgba(0,0,0,0.08)' }}>
                <div style={{ width: `${t.positivePct}%`, background: 'var(--pos)' }} />
                <div style={{ width: `${t.neutralPct}%`, background: 'var(--text-3)' }} />
                <div style={{ width: `${t.negativePct}%`, background: 'var(--neg)' }} />
              </div>
              <span style={{ fontSize: 10, fontWeight: 700, color: t.delta > 0 ? 'var(--neg)' : 'var(--pos)' }}>
                {t.delta > 0 ? '↑' : '↓'} {Math.abs(t.delta)}%
              </span>
            </div>
          </button>
        );
      })}
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
              <text x={t.x} y={t.y + 26} textAnchor="middle" fontSize="9" fill={t.delta > 0 ? 'var(--neg)' : 'var(--pos)'} fontWeight="700" style={{ pointerEvents: 'none' }}>
                {t.delta > 0 ? '↑' : '↓'} {Math.abs(t.delta)}%
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
          <span style={{ fontWeight: 600, color: 'var(--text)' }}>{t.name}</span>
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
          <span style={{ textAlign: 'right', fontSize: 11, fontWeight: 600, color: t.delta > 0 ? 'var(--neg)' : 'var(--pos)' }}>{t.delta > 0 ? '+' : ''}{t.delta}%</span>
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
            <span style={{ fontSize: 12, color: topic.delta > 0 ? 'var(--neg)' : 'var(--pos)', fontWeight: 600 }}>
              {topic.delta > 0 ? '↑' : '↓'} {Math.abs(topic.delta)}% vs. período anterior
            </span>
          </div>
        </div>
        <StatBox label="Menciones" value={fmt(topic.count)} />
        <StatBox label="Positivas" value={`${topic.positivePct}%`} tone="pos" />
        <StatBox label="Negativas" value={`${topic.negativePct}%`} tone="neg" />
      </div>

      {/* Subtopics */}
      <div className="card">
        <div className="card-hd">
          <div><div className="card-hd-title">Subtópicos detectados</div><div className="card-hd-sub">{subs.length} subtópicos · haz clic para filtrar menciones</div></div>
          <button className="btn"><Icons.Filter size={12} /> Filtrar menciones por este tópico</button>
        </div>
        <div>
          {subs.length === 0 && <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>Sin subtópicos detectados</div>}
          {subs.map((s, i) => (
            <div key={s.name} className="row-hover" style={{
              display: 'grid', gridTemplateColumns: '28px 2fr 100px 1.4fr', gap: 12, alignItems: 'center',
              padding: '12px 18px', borderTop: '1px solid var(--hairline)', cursor: 'pointer', fontSize: 13,
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-3)' }} className="mono">{String(i+1).padStart(2,'0')}</div>
              <div style={{ fontWeight: 600, color: 'var(--text)' }}>{s.name}</div>
              <div className="num" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--text)' }}>{fmt(s.count)}</div>
              <div style={{ position: 'relative', height: 8 }}>
                <div style={{ position: 'absolute', inset: 0, background: 'var(--canvas-2)', borderRadius: 999 }} />
                <div style={{ position: 'absolute', top: 0, left: 0, height: '100%', width: `${(s.count/subMax)*100}%`, background: 'var(--accent)', borderRadius: 999 }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Evolution */}
      <div className="card">
        <div className="card-hd"><div><div className="card-hd-title">Evolución del tópico</div><div className="card-hd-sub">Menciones últimos 30 días</div></div></div>
        <div className="card-bd">
          <AreaLineChart data={D.TIMELINE} accessor={(d) => d.totalMentions * (topic.count / D.CURRENT_METRICS.totalMentions)} height={200} color="var(--accent)" />
        </div>
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

  // Build a 7-col week grid starting on the first day's weekday
  const parsed = data.map(d => {
    const dt = new Date(d.fullDate);
    return { ...d, dt };
  });
  const first = parsed[0].dt;
  const firstDow = (first.getDay() + 6) % 7; // Monday-first: 0..6
  const cells = Array(firstDow).fill(null).concat(parsed);

  // Volume scale
  const maxV = Math.max(...parsed.map(d => d.volume));

  // Legend = unique topics present in calendar
  const uniqueTopics = [...new Set(parsed.map(d => d.topicSlug))].map(s => D.TOPICS.find(t => t.slug === s)).filter(Boolean);

  const monthLabel = first.toLocaleDateString('es', { month: 'long', year: 'numeric' });

  return (
    <div className="card">
      <div className="card-hd">
        <div>
          <div className="card-hd-title">Calendario de tópicos</div>
          <div className="card-hd-sub">Tópico principal y volumen del día · período seleccionado</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icons.CalendarDays size={14} color="var(--text-3)" />
          <span style={{ fontSize: 12, color: 'var(--text-2)', textTransform: 'capitalize' }}>{monthLabel}</span>
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
            {cells.map((c, i) => {
              if (!c) return <div key={`e${i}`} />;
              const color = colorFor(c.topicSlug);
              const intensity = 0.3 + (c.volume / maxV) * 0.7; // 0.3 to 1.0
              const dayNum = c.dt.getDate();
              return (
                <button key={c.date} onClick={() => onDayClick(c)}
                  title={`${c.dt.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'short' })} · ${c.topicName} · ${fmt(c.volume)} menciones`}
                  style={{
                    position: 'relative',
                    aspectRatio: '1 / 1', minHeight: 62,
                    padding: 6,
                    borderRadius: 6,
                    background: `${color}${Math.round(intensity * 255).toString(16).padStart(2, '0')}`,
                    border: '1px solid var(--hairline)',
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
      _filter: { municipality: m.slug },
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
          <PRMap
            municipalities={D.MUNICIPALITIES}
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
              items={[...D.MUNICIPALITIES].sort((a,b)=>b.count-a.count).slice(0,8).map(m => ({ label: m.name, value: m.count, nss: m.nss, _muni: m }))}
              colorFn={() => 'var(--accent)'}
              onItemClick={(it) => openMuniSlice(it._muni)}
            />
          </div>
        </div>

        <div className="card">
          <div className="card-hd"><div><div className="card-hd-title">Sentimiento por región</div><div className="card-hd-sub">NSS agregado</div></div></div>
          <div className="card-bd" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {['Metro', 'Sur', 'Centro-oriental', 'Oeste', 'Norte', 'Este'].map((r, i) => {
              const regionMunis = D.MUNICIPALITIES.filter(m => m.region === r);
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
                      _filter: { region: r },
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
        <button onClick={() => setTab('history')} className={`chip ${tab === 'history' ? 'active' : ''}`}>Historial</button>
        <div style={{ flex: 1 }} />
        <button className="btn btn-primary" onClick={() => setEditorOpen(true)}><Icons.Plus size={13} /> Nueva regla</button>
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

  // Map API row -> UI shape so existing render logic keeps working.
  const fromApi = (u) => ({
    id: u.id,
    name: u.name || u.email.split('@')[0],
    email: u.email,
    role: u.role, // 'admin' | 'analyst' | 'viewer'
    agency: localStorage.getItem('eco.agency') || '',
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
          <button className="btn btn-primary" onClick={() => setDrawer({ mode: 'create', user: { name: '', email: '', role: 'analista', agency: 'DTOP', status: 'invitado', notify: true } })}>
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

      {drawer && <UserDrawer drawer={drawer} onSave={saveUser} onDelete={deleteUser} onClose={() => setDrawer(null)} />}
    </div>
  );
}

function UserDrawer({ drawer, onSave, onDelete, onClose }) {
  const [form, setForm] = useState(drawer.user);
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
              <Field label="Agencia">
                <select value={form.agency} onChange={(e) => setField('agency', e.target.value)} style={inputStyle}>
                  {['DTOP','DACo','Salud','AMA','Familia','Educación','Hacienda','Policía'].map(a => <option key={a} value={a}>{a}</option>)}
                </select>
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

window.ECO_SCREENS = { DashboardScreen, MentionsScreen, SentimentScreen, TopicsScreen, GeographyScreen, AlertsScreen, SettingsScreen };
