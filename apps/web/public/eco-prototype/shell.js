// Shell: sidebar, header, command palette, drawer, tweaks
const { Icons } = window;
const { useState, useEffect, useRef } = React;

// Badges are derived from real data at render time (window.ECO_DATA).
function getNav() {
  const D = window.ECO_DATA || {};
  const totalMentions = (D.CURRENT_METRICS && D.CURRENT_METRICS.totalMentions) || (D.MENTIONS && D.MENTIONS.length) || 0;
  const activeAlerts = (D.ALERTS || []).filter((a) => a.active).length;
  return [
    { key: 'dashboard', icon: 'Dashboard', label: 'Dashboard', shortcut: 'D' },
    { key: 'mentions', icon: 'Mentions', label: 'Menciones', shortcut: 'M', badge: totalMentions || null },
    { key: 'sentiment', icon: 'Activity', label: 'Sentimiento', shortcut: 'S' },
    { key: 'topics', icon: 'Hash', label: 'Tópicos', shortcut: 'T' },
    { key: 'geography', icon: 'MapPin', label: 'Geografía', shortcut: 'G' },
    { key: 'alerts', icon: 'Bell', label: 'Alertas', shortcut: 'A', badge: activeAlerts || null, urgent: activeAlerts > 0 },
  ];
}
const NAV = getNav();
const SYSTEM_NAV = [
  { key: 'settings', icon: 'Settings', label: 'Configuración' },
];

function Sidebar({ active, onNav, collapsed, setCollapsed, agency, onOpenCommand, theme, mode }) {
  const I = Icons;
  const NavItem = ({ item }) => {
    const IconC = I[item.icon];
    const isActive = active === item.key;
    return (
      <button onClick={() => onNav(item.key)}
        title={collapsed ? item.label : undefined}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          width: '100%',
          padding: collapsed ? '9px 0' : '9px 12px',
          justifyContent: collapsed ? 'center' : 'flex-start',
          borderRadius: theme === 'gaceta' ? 3 : 6,
          background: isActive ? 'var(--rail-active-bg)' : 'transparent',
          color: isActive ? 'var(--rail-fg-active)' : 'var(--rail-fg)',
          fontSize: 13, fontWeight: isActive ? 600 : 500,
          position: 'relative',
          transition: 'all 0.15s var(--ease)',
          borderLeft: isActive && !collapsed ? `2px solid var(--accent-2)` : '2px solid transparent',
          paddingLeft: collapsed ? 0 : 10,
        }}
        onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
        onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}>
        <IconC size={16} />
        {!collapsed && <>
          <span style={{ flex: 1, textAlign: 'left' }}>{item.label}</span>
          {item.badge != null && item.badge > 0 && (
            <span style={{
              fontSize: 10, fontWeight: 700,
              padding: '2px 6px', borderRadius: 10,
              background: item.urgent ? 'var(--neg)' : 'rgba(255,255,255,0.10)',
              color: item.urgent ? '#fff' : 'rgba(255,255,255,0.7)',
              fontFamily: 'var(--ff-numeric)',
            }}>{item.urgent ? item.badge : (item.badge > 999 ? (item.badge/1000).toFixed(1)+'K' : item.badge)}</span>
          )}
        </>}
      </button>
    );
  };

  return (
    <aside style={{
      background: 'var(--rail-bg)',
      color: 'var(--rail-fg)',
      borderRight: '1px solid var(--rail-border)',
      display: 'flex', flexDirection: 'column',
      height: '100vh', position: 'sticky', top: 0, overflow: 'hidden',
    }}>
      {/* Logo / brand */}
      <div style={{
        padding: collapsed ? '20px 0' : '20px 16px 18px',
        display: 'flex', alignItems: 'center', gap: 11,
        justifyContent: collapsed ? 'center' : 'flex-start',
        borderBottom: '1px solid var(--rail-border)',
      }}>
        {/* Mark — echo/signal wordmark */}
        <div style={{
          width: 36, height: 36, borderRadius: theme === 'gaceta' ? 4 : 8,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: theme === 'gaceta' ? 'var(--accent)' : 'linear-gradient(145deg, #1A2838 0%, #0B111A 100%)',
          border: theme === 'gaceta' ? 'none' : '1px solid rgba(125,183,172,0.18)',
          color: '#fff', flexShrink: 0, position: 'relative',
          boxShadow: theme === 'gaceta' ? 'none' : 'inset 0 1px 0 rgba(255,255,255,0.04), 0 2px 8px rgba(0,0,0,0.3)',
        }}>
          {theme === 'gaceta' ? (
            <span style={{ fontFamily: 'var(--ff-serif)', fontStyle: 'italic', fontSize: 20, fontWeight: 600, lineHeight: 1 }}>e</span>
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              {/* Echo arcs radiating from a point */}
              <path d="M 7 19 A 7 7 0 0 1 7 5" stroke="var(--accent-2)" strokeWidth="1.6" strokeLinecap="round" opacity="0.35" />
              <path d="M 10 17 A 5 5 0 0 1 10 7" stroke="var(--accent-2)" strokeWidth="1.6" strokeLinecap="round" opacity="0.6" />
              <path d="M 13 15 A 3 3 0 0 1 13 9" stroke="var(--accent-2)" strokeWidth="1.6" strokeLinecap="round" opacity="0.9" />
              <circle cx="16.5" cy="12" r="1.8" fill="var(--accent-2)" />
            </svg>
          )}
          {/* Live indicator dot */}
          <span style={{
            position: 'absolute', bottom: -1, right: -1,
            width: 10, height: 10, borderRadius: '50%',
            background: 'var(--pos)',
            border: '2px solid var(--rail-bg)',
            boxShadow: '0 0 6px rgba(107,158,127,0.6)',
          }} />
        </div>

        {!collapsed && (
          <div style={{ lineHeight: 1, minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <div style={{
                color: '#fff',
                fontSize: theme === 'gaceta' ? 20 : 16,
                fontWeight: theme === 'gaceta' ? 500 : 600,
                letterSpacing: theme === 'gaceta' ? 0 : '0.02em',
                fontFamily: theme === 'gaceta' ? 'var(--ff-serif)' : 'inherit',
                fontStyle: theme === 'gaceta' ? 'italic' : 'normal',
              }}>{theme === 'gaceta' ? 'La Gaceta' : 'Eco'}</div>
              {theme !== 'gaceta' && (
                <span style={{
                  fontSize: 9, fontWeight: 600, letterSpacing: '0.04em',
                  color: 'var(--accent-2)',
                  padding: '2px 5px',
                  borderRadius: 3,
                  background: 'rgba(125,183,172,0.12)',
                  border: '1px solid rgba(125,183,172,0.2)',
                  fontFamily: 'var(--ff-numeric)',
                }}>v2.3</span>
              )}
            </div>
            <div style={{
              fontSize: 10,
              fontWeight: 500,
              color: 'rgba(255,255,255,0.45)',
              marginTop: 5,
              display: 'flex', alignItems: 'center', gap: 6,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              <span>{theme === 'mando' ? 'Operations Console' : theme === 'gaceta' ? 'Monitoreo oficial' : 'Social Intelligence'}</span>
            </div>
          </div>
        )}
      </div>

      {/* Command search */}
      {!collapsed && (
        <div style={{ padding: '12px' }}>
          <button onClick={onOpenCommand} style={{
            width: '100%',
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '7px 10px',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: theme === 'gaceta' ? 3 : 6,
            color: 'rgba(255,255,255,0.45)',
            fontSize: 12,
          }}>
            <Icons.Search size={13} />
            <span style={{ flex: 1, textAlign: 'left' }}>Buscar, ir a…</span>
            <span className="kbd" style={{ background: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)' }}>⌘K</span>
          </button>
        </div>
      )}

      {!collapsed && (
        <div style={{ padding: '0 12px 6px', fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', color: 'rgba(255,255,255,0.28)', textTransform: 'uppercase' }}>
          Análisis
        </div>
      )}
      <nav style={{ padding: '4px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {NAV.map((n) => <NavItem key={n.key} item={n} />)}
      </nav>

      {!collapsed && (
        <div style={{ padding: '12px 12px 6px', fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', color: 'rgba(255,255,255,0.28)', textTransform: 'uppercase' }}>
          Sistema
        </div>
      )}
      <nav style={{ padding: '4px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {SYSTEM_NAV.map((n) => <NavItem key={n.key} item={n} />)}
      </nav>

      <div style={{ flex: 1 }} />

      {/* Status */}
      {!collapsed && (
        <div style={{ padding: '10px 14px', borderTop: '1px solid var(--rail-border)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>
          <span className="pulse" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--pos)' }} />
          <span>Ingesta en vivo</span>
          <span style={{ marginLeft: 'auto', fontFamily: 'var(--ff-mono)' }}>
            {(() => {
              const s = (window.ECO_DATA && window.ECO_DATA.INGESTION_STATUS) || null;
              if (s && s.lastIngestLabel) return s.lastIngestLabel;
              const firstMention = (window.ECO_DATA && window.ECO_DATA.MENTIONS && window.ECO_DATA.MENTIONS[0]);
              return firstMention && firstMention.publishedAt ? firstMention.publishedAt : '—';
            })()}
          </span>
        </div>
      )}

      {/* User */}
      <div style={{
        padding: collapsed ? '12px 8px' : '12px 14px',
        borderTop: '1px solid var(--rail-border)',
        display: 'flex', alignItems: 'center', gap: 10,
        justifyContent: collapsed ? 'center' : 'flex-start',
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: '50%',
          background: 'linear-gradient(135deg, var(--accent), var(--accent-2))',
          color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 10, fontWeight: 700,
        }}>AG</div>
        {!collapsed && (
          <div style={{ overflow: 'hidden', flex: 1 }}>
            <div style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap' }}>A. Gutiérrez</div>
            <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10 }}>Admin · {agency?.name || agency}</div>
          </div>
        )}
      </div>

      <button onClick={() => setCollapsed(!collapsed)} style={{
        padding: collapsed ? '10px 0' : '10px 14px',
        borderTop: '1px solid var(--rail-border)',
        color: 'rgba(255,255,255,0.4)', fontSize: 11,
        display: 'flex', alignItems: 'center', gap: 8,
        justifyContent: collapsed ? 'center' : 'flex-start',
        width: '100%',
      }}>
        {collapsed ? <Icons.ChevronRight size={14} /> : <><Icons.PanelLeft size={14} /> Colapsar</>}
      </button>
    </aside>
  );
}

function Header({ title, eyebrow, period, setPeriod, agency, setAgency, agencies, onOpenCommand, mode, setMode, onOpenTweaks, live = true }) {
  const PERIODS = ['1D', '5D', '1M', '3M', '6M', '1A', 'Max'];
  return (
    <header style={{
      position: 'sticky', top: 0, zIndex: 50,
      background: 'var(--canvas)',
      borderBottom: '1px solid var(--hairline)',
      padding: '14px 28px',
      display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
    }}>
      <div style={{ flex: '1 1 240px', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {eyebrow && <div className="section-eyebrow" style={{ marginBottom: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{eyebrow}</div>}
          {live && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'var(--text-3)', fontWeight: 500 }}>
              <span className="pulse" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--pos)' }} />
              <span className="mono" style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>En vivo</span>
            </div>
          )}
        </div>
        <h1 style={{
          margin: '2px 0 0', fontSize: 22, fontWeight: 700,
          letterSpacing: 'var(--letter-display)',
          fontFamily: 'var(--ff-display)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{title}</h1>
      </div>

      {/* Agency switcher */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 12px', borderRadius: 999,
        background: 'var(--canvas-2)', border: '1px solid var(--hairline)',
        fontSize: 12, color: 'var(--text)', fontWeight: 500,
      }}>
        <Icons.Building size={13} color="var(--accent)" />
        <select value={agency} onChange={(e) => setAgency(e.target.value)}
          style={{ background: 'none', border: 'none', fontSize: 12, fontWeight: 500, color: 'var(--text)', maxWidth: 140 }}>
          {agencies.map((a) => <option key={a.key} value={a.key}>{a.name}</option>)}
        </select>
      </div>

      {/* Period — estilo bolsa */}
      <div style={{ display: 'flex', background: 'var(--canvas-2)', borderRadius: 999, padding: 3, border: '1px solid var(--hairline)' }}>
        {PERIODS.map((p) => (
          <button key={p} onClick={() => setPeriod(p)} style={{
            padding: '4px 10px', fontSize: 11, fontWeight: 600,
            borderRadius: 999,
            background: period === p ? 'var(--canvas)' : 'transparent',
            color: period === p ? 'var(--text)' : 'var(--text-3)',
            boxShadow: period === p ? '0 1px 2px rgba(0,0,0,0.04)' : 'none',
          }}>{p}</button>
        ))}
      </div>

      {/* Quick search — abre el command palette con foco real */}
      <button onClick={onOpenCommand} className="btn" title="Buscar (⌘K)">
        <Icons.Search size={13} /> <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Buscar</span> <span className="kbd">⌘K</span>
      </button>

      {/* Dark/light */}
      <button className="btn" onClick={() => setMode(mode === 'dark' ? 'light' : 'dark')} title={mode === 'dark' ? 'Modo claro' : 'Modo oscuro'}>
        {mode === 'dark' ? <Icons.Sun size={14} /> : <Icons.Moon size={14} />}
      </button>
    </header>
  );
}

function CommandPalette({ onClose, onNav, onSetPeriod, onSetMode, onMentionClick, onOpenMentionsWithFilter }) {
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [liveResults, setLiveResults] = useState([]); // mentions matching `query`
  const [searching, setSearching] = useState(false);
  useEffect(() => { inputRef.current?.focus(); }, []);

  // Debounced live search — calls /api/eco-mentions?q= so the palette can
  // surface real mentions by keyword, not just navigation commands.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setLiveResults([]); setSearching(false); return; }
    setSearching(true);
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      const agency = localStorage.getItem('eco.agency') || '';
      const period = localStorage.getItem('eco.period') || '1M';
      const params = new URLSearchParams({ q, agency, period, limit: '8' });
      fetch('/api/eco-mentions?' + params.toString(), { signal: ctrl.signal, credentials: 'same-origin' })
        .then((r) => r.ok ? r.json() : { mentions: [] })
        .then((j) => setLiveResults(j.mentions || []))
        .catch(() => {})
        .finally(() => setSearching(false));
    }, 220);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [query]);

  // Real, executable commands
  const items = [
    // Navigation
    ...NAV.map((n) => ({ kind: 'Ir a', label: n.label, action: () => onNav(n.key), icon: n.icon })),
    ...SYSTEM_NAV.map((n) => ({ kind: 'Ir a', label: n.label, action: () => onNav(n.key), icon: n.icon })),
    // Period (real)
    { kind: 'Período', label: 'Hoy (1D)', action: () => onSetPeriod('1D'), icon: 'Calendar' },
    { kind: 'Período', label: 'Últimos 5 días (5D)', action: () => onSetPeriod('5D'), icon: 'Calendar' },
    { kind: 'Período', label: 'Último mes (1M)', action: () => onSetPeriod('1M'), icon: 'Calendar' },
    { kind: 'Período', label: 'Últimos 3 meses (3M)', action: () => onSetPeriod('3M'), icon: 'Calendar' },
    { kind: 'Período', label: 'Últimos 6 meses (6M)', action: () => onSetPeriod('6M'), icon: 'Calendar' },
    { kind: 'Período', label: 'Último año (1A)', action: () => onSetPeriod('1A'), icon: 'Calendar' },
    { kind: 'Período', label: 'Todo el histórico (Max)', action: () => onSetPeriod('Max'), icon: 'Calendar' },
    // Vista
    { kind: 'Vista', label: 'Cambiar a modo oscuro', action: () => onSetMode('dark'), icon: 'Moon' },
    { kind: 'Vista', label: 'Cambiar a modo claro', action: () => onSetMode('light'), icon: 'Sun' },
    // Mentions — open screen filtered
    { kind: 'Menciones', label: 'Ver solo menciones negativas', action: () => onOpenMentionsWithFilter({ sentiment: 'negativo' }), icon: 'AlertTriangle' },
    { kind: 'Menciones', label: 'Ver menciones de alta pertinencia', action: () => onOpenMentionsWithFilter({ pertinence: 'alta' }), icon: 'Star' },
    { kind: 'Menciones', label: 'Ver menciones en Facebook', action: () => onOpenMentionsWithFilter({ source: 'facebook' }), icon: 'Facebook' },
    { kind: 'Menciones', label: 'Ver menciones en X / Twitter', action: () => onOpenMentionsWithFilter({ source: 'twitter' }), icon: 'Twitter' },
    { kind: 'Menciones', label: 'Ver menciones en Noticias', action: () => onOpenMentionsWithFilter({ source: 'news' }), icon: 'Newspaper' },
    // Alertas
    { kind: 'Alertas', label: 'Crear nueva regla de alerta', action: () => onNav('alerts'), icon: 'Bell' },
    // Tópicos
    ...(window.ECO_DATA?.TOPICS || []).slice(0, 6).map((t) => ({
      kind: 'Tópico', label: `${t.name} · ${(t.count/1000).toFixed(1)}K menciones`, action: () => onNav('topics'), icon: 'Hash'
    })),
  ];

  const commandsMatch = query.trim() === '' ? items : items.filter((i) => i.label.toLowerCase().includes(query.toLowerCase()) || i.kind.toLowerCase().includes(query.toLowerCase()));
  const liveItems = liveResults.map((mn) => ({
    kind: 'Mención',
    label: mn.title.length > 80 ? mn.title.slice(0, 80) + '…' : mn.title,
    action: () => onMentionClick && onMentionClick(mn),
    icon: mn.sentiment === 'negativo' ? 'AlertTriangle' : mn.sentiment === 'positivo' ? 'Heart' : 'MessageSquare',
  }));
  const filtered = [...liveItems, ...commandsMatch];
  const grouped = filtered.reduce((acc, it) => { (acc[it.kind] ??= []).push(it); return acc; }, {});

  useEffect(() => { setSelectedIdx(0); }, [query]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx((i) => Math.max(i - 1, 0)); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const it = filtered[selectedIdx];
        if (it) { it.action?.(); onClose(); }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, filtered, selectedIdx]);

  let flatIdx = -1;
  return (
    <div className="spotlight-backdrop" onClick={onClose}>
      <div className="spotlight" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 18px', borderBottom: '1px solid var(--hairline)' }}>
          <Icons.Search size={16} color="var(--text-3)" />
          <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar comandos, ir a…"
            style={{ flex: 1, border: 'none', outline: 'none', background: 'none', fontSize: 16, color: 'var(--text)' }} />
          <span className="kbd">esc</span>
        </div>
        <div style={{ maxHeight: 440, overflowY: 'auto', padding: 8 }}>
          {Object.entries(grouped).map(([kind, list]) => (
            <div key={kind} style={{ marginBottom: 6 }}>
              <div style={{ padding: '8px 12px 4px', fontSize: 10, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>{kind}</div>
              {list.map((it, i) => {
                flatIdx++;
                const isSelected = flatIdx === selectedIdx;
                const I = Icons[it.icon] ?? Icons.ChevronRight;
                return (
                  <button key={`${kind}-${i}`} onClick={() => { it.action?.(); onClose(); }}
                    onMouseEnter={() => setSelectedIdx(flatIdx)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '9px 12px', borderRadius: 8, fontSize: 13, color: 'var(--text)',
                      background: isSelected ? 'var(--accent-fill)' : 'transparent',
                    }}>
                    <I size={14} color={isSelected ? 'var(--accent)' : 'var(--text-3)'} />
                    <span style={{ flex: 1, textAlign: 'left' }}>{it.label}</span>
                    <Icons.ChevronRight size={12} color="var(--text-3)" />
                  </button>
                );
              })}
            </div>
          ))}
          {filtered.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>Sin resultados</div>
          )}
        </div>
        <div style={{ padding: '8px 14px', borderTop: '1px solid var(--hairline)', display: 'flex', gap: 16, fontSize: 10, color: 'var(--text-3)' }}>
          <span><span className="kbd">↑↓</span> navegar</span>
          <span><span className="kbd">↵</span> ejecutar</span>
          <span><span className="kbd">esc</span> cerrar</span>
        </div>
      </div>
    </div>
  );
}

function MentionDrawer({ mention, onClose, onNavigate, onMentionClick }) {
  const [related, setRelated] = React.useState(null); // null while loading, [] if none

  // Fetch a handful of mentions in the same topic (or subtopic if present)
  // whenever a mention is opened. Falls back to municipality when no topic.
  React.useEffect(() => {
    if (!mention) return;
    setRelated(null);
    const ctrl = new AbortController();
    const agency = (typeof window !== 'undefined' && localStorage.getItem('eco.agency')) || '';
    const period = (typeof window !== 'undefined' && localStorage.getItem('eco.period')) || '1M';
    const params = new URLSearchParams({ period, limit: '6' });
    if (agency) params.set('agency', agency);
    if (mention.topic) params.set('topic', mention.topic);
    else if (mention.municipality) params.set('municipality', mention.municipality.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
    fetch('/api/eco-mentions?' + params.toString(), { signal: ctrl.signal, credentials: 'same-origin' })
      .then((r) => r.ok ? r.json() : { mentions: [] })
      .then((j) => setRelated((j.mentions || []).filter((m) => m.id !== mention.id).slice(0, 5)))
      .catch(() => setRelated([]));
    return () => ctrl.abort();
  }, [mention?.id]);

  if (!mention) return null;
  const sentClass = mention.sentiment === 'positivo' ? 'pill-pos' : mention.sentiment === 'negativo' ? 'pill-neg' : 'pill-neu';
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer">
        <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--hairline)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="section-eyebrow" style={{ margin: 0, flex: 1 }}>Mención · {mention.publishedAt}</div>
          <button className="btn" onClick={onClose}><Icons.Close size={14} /></button>
        </div>
        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: 12, color: 'var(--text-2)' }}>
              <span className={`pill ${sentClass}`}>{mention.sentiment}</span>
              <span className={`pill pill-warn`}>Pertinencia {mention.pertinence}</span>
              <span style={{ marginLeft: 'auto', color: 'var(--text-3)' }}>{mention.domain}</span>
            </div>
            <h2 style={{ margin: '4px 0 8px', fontSize: 20, fontWeight: 600, fontFamily: 'var(--ff-display)', lineHeight: 1.3 }}>
              {mention.title}
            </h2>
            <div style={{ color: 'var(--text-2)', fontSize: 13, lineHeight: 1.6 }}>
              {mention.author} · {mention.domain} · {mention.publishedAt}
            </div>
          </div>

          <hr className="hr" />

          <div>
            <div className="section-eyebrow" style={{ marginBottom: 10 }}>Métricas</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
              {[
                { label: 'Engagement', v: mention.engagement },
                { label: 'Likes', v: mention.likes },
                { label: 'Comentarios', v: mention.comments },
                { label: 'Compartidas', v: mention.shares },
              ].map((m) => (
                <div key={m.label} style={{ padding: '12px', background: 'var(--canvas-2)', borderRadius: 8, border: '1px solid var(--hairline)' }}>
                  <div style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>{m.label}</div>
                  <div className="num" style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>{m.v.toLocaleString('es-PR')}</div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="section-eyebrow" style={{ marginBottom: 10 }}>Resumen IA</div>
            <div style={{ padding: 14, background: 'var(--accent-fill)', border: '1px solid var(--hairline)', borderRadius: 10, fontSize: 13, lineHeight: 1.55, color: 'var(--text)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, fontSize: 10, color: 'var(--accent)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                <Icons.Sparkles size={12} /> Claude · Bedrock
              </div>
              Denuncia colectiva sobre el deterioro de la PR-21 en Río Piedras tras las lluvias recientes. Los residentes exigen intervención inmediata de DTOP y mencionan incidentes de daños a vehículos. Tono predominantemente de frustración.
            </div>
          </div>

          {mention.emotions?.length > 0 && (
            <div>
              <div className="section-eyebrow" style={{ marginBottom: 10 }}>Emociones detectadas</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {mention.emotions.map((e) => <span key={e} className="pill pill-neu" style={{ textTransform: 'capitalize' }}>{e}</span>)}
              </div>
            </div>
          )}

          {/* Tópicos y subtópicos detectados */}
          {mention.topicName && (
            <div>
              <div className="section-eyebrow" style={{ marginBottom: 10 }}>Tópicos y subtópicos detectados</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{
                  padding: '10px 12px', border: '1px solid var(--hairline)', borderRadius: 10,
                  background: 'var(--canvas-2)', display: 'flex', alignItems: 'center', gap: 10,
                }}>
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--accent-fill)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icons.Hash size={13} color="var(--accent)" />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>Tópico principal</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{mention.topicName}</div>
                  </div>
                  <div className="mono" style={{ fontSize: 10, color: 'var(--text-3)' }}>confianza 94%</div>
                </div>
                {mention.subtopics?.length > 0 && (
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, marginBottom: 6 }}>Subtópicos</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {mention.subtopics.map((s) => (
                        <span key={s} className="pill" style={{ background: 'var(--canvas-2)', border: '1px solid var(--hairline)', color: 'var(--text-2)' }}>
                          <Icons.ChevronRight size={10} /> {s}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Geografía */}
          {mention.municipality && (
            <div>
              <div className="section-eyebrow" style={{ marginBottom: 10 }}>Geografía detectada</div>
              <div style={{
                border: '1px solid var(--hairline)', borderRadius: 10, overflow: 'hidden',
                background: 'var(--canvas-2)',
              }}>
                {/* Mini mapa esquemático */}
                <div style={{
                  height: 120, position: 'relative',
                  background: 'linear-gradient(135deg, #e8edf2 0%, #dce4ed 100%)',
                  backgroundImage: `
                    linear-gradient(rgba(0,0,0,0.04) 1px, transparent 1px),
                    linear-gradient(90deg, rgba(0,0,0,0.04) 1px, transparent 1px)
                  `,
                  backgroundSize: '24px 24px',
                }}>
                  {/* Forma aproximada de PR */}
                  <svg viewBox="0 0 400 150" style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }}>
                    <path d="M30,70 Q60,50 110,55 L200,50 Q280,52 340,65 L370,80 Q340,95 280,100 L180,105 Q100,105 60,95 Q30,85 30,70 Z"
                      fill="rgba(255,255,255,0.6)" stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="3 3" />
                    {/* Pin en ubicación aproximada */}
                    <circle cx={mention.region === 'Sur' ? 180 : mention.region === 'Centro' ? 200 : mention.region === 'Oeste' ? 80 : mention.region === 'Este' ? 320 : 240} cy={mention.region === 'Sur' ? 90 : 70} r="8" fill="var(--neg)" opacity="0.2" />
                    <circle cx={mention.region === 'Sur' ? 180 : mention.region === 'Centro' ? 200 : mention.region === 'Oeste' ? 80 : mention.region === 'Este' ? 320 : 240} cy={mention.region === 'Sur' ? 90 : 70} r="4" fill="var(--neg)" />
                  </svg>
                  <div style={{ position: 'absolute', top: 6, left: 8, fontSize: 9, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>
                    Puerto Rico · {mention.region}
                  </div>
                </div>
                <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10, borderTop: '1px solid var(--hairline)' }}>
                  <Icons.MapPin size={14} color="var(--neg)" />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{mention.municipality}</div>
                    <div className="mono" style={{ fontSize: 10, color: 'var(--text-3)' }}>
                      {mention.coords?.[0].toFixed(4)}°N, {Math.abs(mention.coords?.[1] ?? 0).toFixed(4)}°O · Región {mention.region}
                    </div>
                  </div>
                  <button className="btn"
                    style={{ fontSize: 11 }}
                    onClick={() => {
                      if (onNavigate) {
                        // Persist desired map focus so the geography screen can
                        // open the slice modal for the clicked municipality.
                        try {
                          localStorage.setItem('eco.map.focus', JSON.stringify({
                            slug: (mention.municipality || '').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
                            name: mention.municipality,
                            ts: Date.now(),
                          }));
                        } catch (_) {}
                        onClose && onClose();
                        onNavigate('geography');
                      }
                    }}>Ver en mapa</button>
                </div>
              </div>
            </div>
          )}

          {/* Relacionadas — mentions from the same topic (or same municipality) */}
          <div>
            <div className="section-eyebrow" style={{ marginBottom: 10 }}>Relacionadas</div>
            {related === null && (
              <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Cargando menciones similares…</div>
            )}
            {related && related.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Sin menciones similares en el período.</div>
            )}
            {related && related.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {related.map((r) => {
                  const sc = r.sentiment === 'positivo' ? 'pill-pos' : r.sentiment === 'negativo' ? 'pill-neg' : 'pill-neu';
                  return (
                    <button key={r.id}
                      onClick={() => onMentionClick && onMentionClick(r)}
                      style={{
                        textAlign: 'left', background: 'var(--canvas-2)', border: '1px solid var(--hairline)',
                        borderRadius: 8, padding: '10px 12px', cursor: 'pointer', display: 'flex',
                        flexDirection: 'column', gap: 4,
                      }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <span className={`pill ${sc}`} style={{ fontSize: 9 }}>{r.sentiment}</span>
                        <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{r.publishedAt}</span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.title}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-3)' }}>{r.domain}</div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary"
              style={{ flex: 1, justifyContent: 'center' }}
              disabled={!mention.url}
              onClick={() => mention.url && window.open(mention.url, '_blank', 'noopener,noreferrer')}>
              <Icons.ExternalLink size={13} /> Ver original
            </button>
            <button className="btn"
              onClick={() => {
                const url = mention.url || '';
                const text = `${mention.title || ''}\n${url}`;
                if (navigator.share) {
                  navigator.share({ title: mention.title, text, url }).catch(() => {});
                } else if (navigator.clipboard) {
                  navigator.clipboard.writeText(text);
                }
              }}>
              <Icons.ExternalLink size={13} /> Compartir
            </button>
            <button className="btn"
              title="Copiar URL"
              onClick={() => navigator.clipboard && mention.url && navigator.clipboard.writeText(mention.url)}>
              <Icons.Download size={13} />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function TweaksPanel({ theme, setTheme, mode, setMode, density, setDensity, onClose }) {
  const themes = [
    { key: 'costa', label: 'Costa', desc: 'Moderno institucional' },
    { key: 'gaceta', label: 'Gaceta', desc: 'Formal, impreso' },
    { key: 'mando', label: 'Mando', desc: 'Centro de operaciones' },
  ];
  return (
    <div className="tweaks-panel">
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--hairline)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <Icons.Palette size={14} color="var(--accent)" />
        <div style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>Tweaks</div>
        <button onClick={onClose}><Icons.Close size={14} color="var(--text-3)" /></button>
      </div>
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-3)', marginBottom: 8 }}>Dirección visual</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {themes.map((t) => (
              <button key={t.key} onClick={() => setTheme(t.key)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: 10, borderRadius: 8,
                  border: `1px solid ${theme === t.key ? 'var(--accent)' : 'var(--hairline)'}`,
                  background: theme === t.key ? 'var(--accent-fill)' : 'var(--canvas)',
                  textAlign: 'left',
                }}>
                <div style={{ width: 32, height: 32, borderRadius: 6, background: t.key === 'costa' ? 'linear-gradient(135deg, #0B5F80, #3FB5D8)' : t.key === 'gaceta' ? 'linear-gradient(135deg, #0F2949, #C8A961)' : 'linear-gradient(135deg, #0A0F16, #C83A1E)' }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{t.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{t.desc}</div>
                </div>
                {theme === t.key && <Icons.Check size={14} color="var(--accent)" />}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-3)', marginBottom: 8 }}>Modo</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {['light', 'dark'].map((m) => (
              <button key={m} onClick={() => setMode(m)}
                style={{
                  flex: 1, padding: '8px 12px', borderRadius: 8,
                  border: `1px solid ${mode === m ? 'var(--accent)' : 'var(--hairline)'}`,
                  background: mode === m ? 'var(--accent-fill)' : 'var(--canvas)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  fontSize: 12, fontWeight: 500, color: mode === m ? 'var(--accent)' : 'var(--text-2)',
                }}>
                {m === 'light' ? <Icons.Sun size={13} /> : <Icons.Moon size={13} />}
                {m === 'light' ? 'Claro' : 'Oscuro'}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-3)', marginBottom: 8 }}>Densidad</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {['comfy', 'normal', 'compact'].map((d) => (
              <button key={d} onClick={() => setDensity(d)}
                style={{
                  flex: 1, padding: '8px 4px', borderRadius: 8,
                  border: `1px solid ${density === d ? 'var(--accent)' : 'var(--hairline)'}`,
                  background: density === d ? 'var(--accent-fill)' : 'var(--canvas)',
                  fontSize: 11, fontWeight: 500, color: density === d ? 'var(--accent)' : 'var(--text-2)',
                  textTransform: 'capitalize',
                }}>
                {d === 'comfy' ? 'Aireado' : d === 'normal' ? 'Normal' : 'Denso'}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// =========================================================
// MentionsSliceModal — generic "drill into a slice" modal
// Opens for any aggregate click: day, city, hour, topic, emotion, source,
// sentiment bar, ranked list item, chart point, etc.
// Props:
//   slice: {
//     eyebrow:   string          e.g. "Martes 15 abr 2026" | "Municipio" | "Emoción"
//     title:     string          e.g. "Ponce"
//     highlight: string          secondary title segment, colored accent
//     accent:    string (CSS color) — strip color
//     volume:    number          total matching mentions
//     sentiment: { pos, neu, neg }  counts
//     histogram: { label:string, values:number[], xLabels?:string[] } optional
//     mentions:  Mention[]       list to render
//     ctaLabel:  string          e.g. "Ver tópico · Infraestructura"
//     ctaIcon:   string          Icons[icon]
//     onCta:     () => void
//   }
// =========================================================
function MentionsSliceModal({ slice, onClose, onMentionClick }) {
  const [liveSlice, setLiveSlice] = React.useState(null);
  const [loading, setLoading] = React.useState(false);

  // If a slice carries a structured filter, fetch real matching mentions from
  // /api/eco-mentions and replace the placeholder list + counts. The slice
  // object is immutable; we merge the fetched fields into `liveSlice`.
  React.useEffect(() => {
    if (!slice || !slice._filter) { setLiveSlice(null); return; }
    setLoading(true);
    fetch('/api/eco-mentions?' + new URLSearchParams(Object.fromEntries(
      Object.entries({
        agency: localStorage.getItem('eco.agency') || '',
        period: localStorage.getItem('eco.period') || '1M',
        limit: '20',
        ...slice._filter,
      }).filter(([, v]) => v != null && v !== '')
    )).toString(), { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : { mentions: [], total: 0, sentiment: { pos: 0, neu: 0, neg: 0 } })
      .then((j) => setLiveSlice(j))
      .catch(() => setLiveSlice({ mentions: [], total: 0, sentiment: { pos: 0, neu: 0, neg: 0 } }))
      .finally(() => setLoading(false));
  }, [slice]);

  if (!slice) return null;
  const { eyebrow, title, highlight, accent = 'var(--accent)', ctaLabel, ctaIcon, onCta } = slice;
  const volume = liveSlice ? liveSlice.total : slice.volume;
  const sentiment = liveSlice ? liveSlice.sentiment : (slice.sentiment || {});
  const mentions = liveSlice ? liveSlice.mentions : (slice.mentions || []);
  const histogram = slice.histogram;
  const { pos = 0, neu = 0, neg = 0 } = sentiment;

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} style={{ zIndex: 2000 }} />
      <div role="dialog" aria-modal="true" style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: 'min(880px, 94vw)', maxHeight: '88vh', overflow: 'auto',
        background: 'var(--canvas)', border: '1px solid var(--hairline-strong)',
        borderRadius: 12, boxShadow: '0 24px 60px rgba(0,0,0,0.28)',
        zIndex: 2001,
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{
          padding: '20px 24px',
          borderBottom: '1px solid var(--hairline)',
          borderTop: `3px solid ${accent}`,
          display: 'flex', alignItems: 'flex-start', gap: 16,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {eyebrow && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: 6 }}>
                <span>{eyebrow}</span>
              </div>
            )}
            <div style={{ fontSize: 22, fontWeight: 600, fontFamily: 'var(--ff-display)', letterSpacing: 'var(--letter-display)', lineHeight: 1.25, color: 'var(--text)' }}>
              <span>{title}</span>
              {highlight && <> · <span style={{ color: accent }}>{highlight}</span></>}
            </div>
            {volume != null && (
              <div style={{ marginTop: 6, fontSize: 13, color: 'var(--text-2)' }}>
                <span className="num" style={{ color: 'var(--text)', fontWeight: 600, fontSize: 14 }}>{volume.toLocaleString('es-PR')}</span> menciones
              </div>
            )}
            {(pos || neu || neg) && (
              <div style={{ marginTop: 8, display: 'flex', gap: 14, fontSize: 11, color: 'var(--text-2)', flexWrap: 'wrap' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span className="dot" style={{ background: 'var(--pos)' }} />
                  <span className="num" style={{ fontWeight: 600, color: 'var(--text)' }}>{pos.toLocaleString('es-PR')}</span> positivas
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span className="dot" style={{ background: 'var(--text-3)' }} />
                  <span className="num" style={{ fontWeight: 600, color: 'var(--text)' }}>{neu.toLocaleString('es-PR')}</span> neutrales
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span className="dot" style={{ background: 'var(--neg)' }} />
                  <span className="num" style={{ fontWeight: 600, color: 'var(--text)' }}>{neg.toLocaleString('es-PR')}</span> negativas
                </span>
              </div>
            )}
          </div>
          <button className="btn" onClick={onClose}><Icons.Close size={14} /></button>
        </div>

        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
          {histogram && histogram.values?.length > 0 && (() => {
            const maxH = Math.max(...histogram.values) || 1;
            const xLabels = histogram.xLabels || [];
            return (
              <div>
                <div className="section-eyebrow" style={{ marginBottom: 8 }}>{histogram.label || 'Distribución'}</div>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${histogram.values.length}, 1fr)`,
                  gap: 2,
                  height: 80, alignItems: 'end',
                  padding: '8px 10px',
                  background: 'var(--canvas-2)',
                  border: '1px solid var(--hairline)',
                  borderRadius: 6,
                }}>
                  {histogram.values.map((v, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'flex-end', height: '100%' }} title={`${xLabels[i] ?? i} — ${v}`}>
                      <div style={{ width: '100%', height: `${(v / maxH) * 100}%`, background: accent, opacity: 0.85, borderRadius: '2px 2px 0 0', minHeight: 2 }} />
                    </div>
                  ))}
                </div>
                {xLabels.length > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 9, color: 'var(--text-3)', fontFamily: 'var(--ff-numeric)', padding: '0 2px' }}>
                    {[0, Math.floor(xLabels.length/4), Math.floor(xLabels.length/2), Math.floor(3*xLabels.length/4), xLabels.length-1].map((idx, i) => (
                      <span key={i}>{xLabels[idx]}</span>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
              <div className="section-eyebrow" style={{ margin: 0 }}>Menciones destacadas</div>
              <span style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--ff-numeric)' }}>
                {loading ? 'Cargando…' : `mostrando ${mentions.length}${volume ? ` de ${volume.toLocaleString('es-PR')}` : ''}`}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {mentions.map(mn => {
                const sourceIcon = { facebook: 'Facebook', twitter: 'Twitter', news: 'Newspaper', instagram: 'Instagram', youtube: 'Youtube' }[mn.source] || 'Globe';
                const SIcon = Icons[sourceIcon];
                const sc = mn.sentiment === 'positivo' ? 'pill-pos' : mn.sentiment === 'negativo' ? 'pill-neg' : mn.sentiment === 'neutral' ? 'pill-neu' : 'pill-unknown';
                return (
                  <div key={mn.id} className="row-hover"
                    onClick={() => onMentionClick && onMentionClick(mn)}
                    style={{
                      display: 'grid', gridTemplateColumns: '20px 1fr 90px 70px 70px',
                      gap: 12, alignItems: 'center',
                      padding: '10px 12px',
                      border: '1px solid var(--hairline)',
                      borderRadius: 6,
                      fontSize: 12,
                      cursor: 'pointer',
                    }}>
                    <SIcon size={14} color="var(--text-3)" />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ color: 'var(--text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{mn.title}</div>
                      <div style={{ color: 'var(--text-3)', fontSize: 10 }}>{mn.author} · {mn.domain} · {mn.publishedAt}</div>
                    </div>
                    <span className={`pill ${sc}`} style={{ justifySelf: 'start' }}>{mn.sentiment}</span>
                    <span className="num" style={{ textAlign: 'right', color: 'var(--text-2)', fontWeight: 600 }}>{(mn.engagement || 0).toLocaleString('es-PR')}</span>
                    <span style={{ fontSize: 10, color: mn.pertinence === 'alta' ? 'var(--neg)' : 'var(--warn)', fontWeight: 600, textTransform: 'uppercase', textAlign: 'right' }}>{mn.pertinence}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, paddingTop: 8, borderTop: '1px solid var(--hairline)' }}>
            {ctaLabel && onCta && (() => {
              const CtaIcon = ctaIcon ? Icons[ctaIcon] : null;
              return (
                <button className="btn btn-primary" onClick={onCta} style={{ flex: 1, justifyContent: 'center' }}>
                  {CtaIcon && <CtaIcon size={13} />} {ctaLabel}
                </button>
              );
            })()}
            <button className="btn"><Icons.Download size={13} /> Exportar</button>
            <button className="btn"
              onClick={async () => {
                const name = prompt('Nombre de la alerta (ej. "Menciones sobre ' + (mention.topicName || 'este tópico') + '")');
                if (!name) return;
                try {
                  const res = await fetch('/api/alerts', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'same-origin',
                    body: JSON.stringify({
                      name,
                      description: 'Creada desde la mención: ' + mention.title.slice(0, 80),
                      config: {
                        topic: mention.topic || null,
                        municipality: mention.municipality || null,
                        sentiment: mention.sentiment,
                        threshold: { volumeMinutes: 60, minMentions: 5 },
                      },
                      notifyEmails: [],
                    }),
                  });
                  if (res.ok) (window.ecoToast || (() => {}))('ok', 'Alerta creada.');
                  else (window.ecoToast || (() => {}))('err', 'No se pudo crear la alerta (' + res.status + ')');
                } catch (_) { (window.ecoToast || (() => {}))('err', 'Error creando la alerta'); }
              }}>
              <Icons.Bell size={13} /> Crear alerta
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

window.ECO_SHELL = { Sidebar, Header, CommandPalette, MentionDrawer, MentionsSliceModal, TweaksPanel, NAV, SYSTEM_NAV };
