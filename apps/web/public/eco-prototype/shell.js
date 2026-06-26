// Shell: sidebar, header, command palette, drawer, tweaks
const { Icons } = window;
const { useState, useEffect, useRef } = React;

/**
 * Construye los parámetros de ventana de tiempo para los endpoints de datos.
 * Si el usuario está en rango personalizado (eco.period === 'custom' y
 * eco.from/eco.to válidos en localStorage), retorna `{ period: 'custom',
 * from, to }`. Si no, `{ period }`. Centralizado aquí para que
 * CommandPalette, MentionDrawer y MentionsSliceModal envíen los mismos
 * parámetros y queden alineados con el filtro del overview.
 */
function getPeriodParams() {
  try {
    const period = localStorage.getItem('eco.period') || '1M';
    if (period === 'custom') {
      const from = localStorage.getItem('eco.from') || '';
      const to = localStorage.getItem('eco.to') || '';
      if (from && to) return { period, from, to };
    }
    return { period };
  } catch (_) {
    return { period: '1M' };
  }
}
window.ecoGetPeriodParams = getPeriodParams;

// Badges are derived from real data at render time (window.ECO_DATA).
function getNav() {
  const D = window.ECO_DATA || {};
  // CURRENT_METRICS.totalMentions is today's snapshot; for the sidebar badge
  // we want the period total (matches the dashboard "Volumen · período" KPI).
  const periodTotal = (D.TIMELINE && D.TIMELINE.reduce((s, t) => s + (t.totalMentions || 0), 0)) || 0;
  const totalMentions = periodTotal || (D.CURRENT_METRICS && D.CURRENT_METRICS.totalMentions) || (D.MENTIONS && D.MENTIONS.length) || 0;
  const activeAlerts = (D.ALERTS || []).filter((a) => a.active).length;
  return [
    { key: 'overview', icon: 'Grid', label: 'Overview', shortcut: 'O' },
    { key: 'dashboard', icon: 'Dashboard', label: 'Scorecard', shortcut: 'D' },
    { key: 'mentions', icon: 'Mentions', label: 'Menciones', shortcut: 'M', badge: totalMentions || null },
    { key: 'sentiment', icon: 'Activity', label: 'Sentimiento', shortcut: 'S' },
    { key: 'topics', icon: 'Hash', label: 'Tópicos', shortcut: 'T' },
    { key: 'narrative', icon: 'Branches', label: 'Narrativas', shortcut: 'N' },
    { key: 'geography', icon: 'MapPin', label: 'Geografía', shortcut: 'G' },
    { key: 'alerts', icon: 'Bell', label: 'Alertas', shortcut: 'A', badge: activeAlerts || null, urgent: activeAlerts > 0 },
  ];
}
const NAV = getNav();
const SYSTEM_NAV = [
  { key: 'settings', icon: 'Settings', label: 'Configuración' },
];

// --- RBAC gating: lee window.ECO_SESSION (lo puebla app.js desde /api/auth/me)
// con { role, capabilities, allowedPages }. Mientras la sesión no carga NO se
// oculta nada (evita parpadeo). 'overview' siempre visible como landing seguro.
function ecoSession() { return (typeof window !== 'undefined' && window.ECO_SESSION) || null; }
function ecoHasCap(cap) {
  const s = ecoSession();
  if (!s || !Array.isArray(s.capabilities)) return true;
  return s.capabilities.includes(cap);
}
function ecoCanSeePage(key) {
  const s = ecoSession();
  if (!s) return true;
  if (key !== 'overview' && Array.isArray(s.allowedPages) && s.allowedPages.length > 0 && !s.allowedPages.includes(key)) return false;
  if (key === 'settings') {
    return ecoHasCap('manage_users') || ecoHasCap('manage_templates') || ecoHasCap('manage_alert_rules');
  }
  return true;
}
if (typeof window !== 'undefined') { window.ecoCanSeePage = ecoCanSeePage; window.ecoHasCap = ecoHasCap; }

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

      {/* El buscador se movió al header (HeaderSearch). El atajo ⌘K sigue activo
          vía el listener global de teclado. */}

      {!collapsed && (
        <div style={{ padding: '12px 12px 6px', fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', color: 'rgba(255,255,255,0.28)', textTransform: 'uppercase' }}>
          Análisis
        </div>
      )}
      <nav style={{ padding: '4px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {NAV.filter((n) => ecoCanSeePage(n.key)).map((n) => <NavItem key={n.key} item={n} />)}
      </nav>

      {!collapsed && (
        <div style={{ padding: '12px 12px 6px', fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', color: 'rgba(255,255,255,0.28)', textTransform: 'uppercase' }}>
          Sistema
        </div>
      )}
      <nav style={{ padding: '4px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {SYSTEM_NAV.filter((n) => ecoCanSeePage(n.key)).map((n) => <NavItem key={n.key} item={n} />)}
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
        }}>{(() => { const s = ecoSession(); const nm = (s && (s.name || s.email)) || 'Usuario'; return nm.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((x) => x[0].toUpperCase()).join('') || 'U'; })()}</div>
        {!collapsed && (
          <div style={{ overflow: 'hidden', flex: 1 }}>
            <div style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{(() => { const s = ecoSession(); return (s && (s.name || s.email)) || 'Usuario'; })()}</div>
            <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, textTransform: 'capitalize' }}>{(() => { const s = ecoSession(); return (s && s.role) ? s.role : '—'; })()} · {agency?.name || agency}</div>
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

// Buscador del header: input de texto real (no solo el botón ⌘K). Enter dispara
// la búsqueda completa (texto o URL) navegando a /search; ⌘K sigue disponible
// como atajo para el command palette. Petición del usuario: el buscador va en el
// header (no en el menú lateral) y debe ser un poco más ancho.
function HeaderSearch({ onSearch, onOpenCommand }) {
  const [q, setQ] = React.useState('');
  return (
    <div style={{ position: 'relative', flex: '1 1 280px', minWidth: 180, maxWidth: 460 }}>
      <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', display: 'flex', color: 'var(--text-3)', pointerEvents: 'none' }}>
        <Icons.Search size={14} />
      </span>
      <input
        className="input"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && q.trim() && typeof onSearch === 'function') onSearch(q.trim()); }}
        placeholder="Buscar menciones, autor, URL…"
        title="Buscar por texto o URL — Enter. ⌘K abre el comando rápido."
        style={{ width: '100%', padding: '8px 56px 8px 32px', fontSize: 12 }}
      />
      <button onClick={onOpenCommand} title="Comando rápido (⌘K)" aria-label="Abrir comando rápido"
        style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 0', lineHeight: 1 }}>
        <span className="kbd">⌘K</span>
      </button>
    </div>
  );
}

function Header({ title, eyebrow, period, setPeriod, agency, setAgency, agencies, onOpenCommand, onSearch, onOpenChat, mode, setMode, onOpenTweaks, live = true }) {
  // Una sola fuente de control de periodo en TODA la aplicación: el Header.
  // Mismo look-and-feel en Overview, Scorecard, Sentiment, etc. — chips en
  // "bolsa" + ícono de calendario para rango personalizado. Petición explícita
  // del usuario: "los filtros en el overview no deben estar en otro lugar
  // diferente y ser diferentes visualmente a los que ya existen en el
  // scorecard (que están en el header)".
  // '90D' se removió: era idéntico a '3M' (ambos 90 días). '30D' se mantiene
  // como la única ventana ~mensual de los chips. El command palette y los
  // PERIOD_DAYS del API aceptan ambos por compatibilidad.
  const PERIODS = ['1D', '5D', '7D', '30D', '3M', '6M', '1A', 'Max'];
  const isCustom = period === 'custom';
  const [calendarOpen, setCalendarOpen] = React.useState(false);
  const lsFrom = (typeof localStorage !== 'undefined') ? (localStorage.getItem('eco.from') || '') : '';
  const lsTo = (typeof localStorage !== 'undefined') ? (localStorage.getItem('eco.to') || '') : '';
  const [draftFrom, setDraftFrom] = React.useState(lsFrom);
  const [draftTo, setDraftTo] = React.useState(lsTo);
  const todayIso = new Date().toISOString().slice(0, 10);

  function applyCustomRange() {
    if (!draftFrom || !draftTo || draftFrom > draftTo) return;
    try {
      localStorage.setItem('eco.from', draftFrom);
      localStorage.setItem('eco.to', draftTo);
      localStorage.setItem('eco.period', 'custom');
    } catch (_) {}
    window.location.reload();
  }
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
            // Los datos del dashboard son una ventana CERRADA (termina ayer en
            // TZ PR, incluso en 1D), así que "En vivo" engañaba. Etiqueta honesta,
            // sin pulso ni verde.
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'var(--text-3)', fontWeight: 500 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--text-3)' }} />
              <span className="mono" style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>Datos al cierre de ayer</span>
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

      {/* Buscador global — input real en el header (antes era solo un botón ⌘K) */}
      <HeaderSearch onSearch={onSearch} onOpenCommand={onOpenCommand} />

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

      {/* Period — estilo bolsa, único control de periodo de toda la app. */}
      <div style={{ display: 'flex', background: 'var(--canvas-2)', borderRadius: 999, padding: 3, border: '1px solid var(--hairline)' }}>
        {PERIODS.map((p) => (
          <button key={p} onClick={() => {
            // Si el usuario venía de un rango personalizado, limpiar
            // eco.from/eco.to antes de cambiar al preset para que el siguiente
            // boot no envíe restos del rango anterior.
            try {
              localStorage.removeItem('eco.from');
              localStorage.removeItem('eco.to');
            } catch (_) {}
            setPeriod(p);
          }} style={{
            padding: '4px 10px', fontSize: 11, fontWeight: 600,
            borderRadius: 999,
            background: (!isCustom && period === p) ? 'var(--canvas)' : 'transparent',
            color: (!isCustom && period === p) ? 'var(--text)' : 'var(--text-3)',
            boxShadow: (!isCustom && period === p) ? '0 1px 2px rgba(0,0,0,0.04)' : 'none',
          }}>{p}</button>
        ))}
      </div>
      {/* Calendar icon: abre popover con date inputs para rango custom. */}
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setCalendarOpen(v => !v)}
          title={isCustom && lsFrom && lsTo ? `Rango: ${lsFrom} → ${lsTo}` : 'Rango de fechas personalizado'}
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '5px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600,
            background: isCustom ? 'var(--accent-fill)' : 'var(--canvas-2)',
            color: isCustom ? 'var(--accent)' : 'var(--text-2)',
            border: '1px solid ' + (isCustom ? 'var(--accent)' : 'var(--hairline)'),
            cursor: 'pointer',
          }}>
          <Icons.Calendar size={12} />
          {isCustom && lsFrom && lsTo ? `${lsFrom} → ${lsTo}` : 'Fechas'}
        </button>
        {calendarOpen && (
          <>
            <div onClick={() => setCalendarOpen(false)}
              style={{ position: 'fixed', inset: 0, zIndex: 90 }} />
            <div className="card" style={{
              position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 100,
              padding: 14, minWidth: 280,
              boxShadow: '0 12px 32px rgba(0,0,0,0.16)',
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>Rango personalizado</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ fontSize: 11, color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ minWidth: 44 }}>Desde</span>
                  <input type="date" value={draftFrom}
                    onChange={(e) => setDraftFrom(e.target.value)}
                    max={todayIso}
                    className="input" style={{ fontSize: 12, padding: '6px 10px' }} />
                </label>
                <label style={{ fontSize: 11, color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ minWidth: 44 }}>Hasta</span>
                  <input type="date" value={draftTo}
                    onChange={(e) => setDraftTo(e.target.value)}
                    max={todayIso}
                    className="input" style={{ fontSize: 12, padding: '6px 10px' }} />
                </label>
              </div>
              {draftFrom && draftTo && draftFrom > draftTo && (
                <div style={{ fontSize: 11, color: 'var(--neg)', marginTop: 8 }}>La fecha "Desde" debe ser anterior o igual a "Hasta".</div>
              )}
              <div style={{ display: 'flex', gap: 6, marginTop: 12, justifyContent: 'flex-end' }}>
                <button className="btn" onClick={() => setCalendarOpen(false)} style={{ fontSize: 12 }}>Cancelar</button>
                {isCustom && (
                  <button className="btn" onClick={() => {
                    try {
                      localStorage.removeItem('eco.from');
                      localStorage.removeItem('eco.to');
                    } catch (_) {}
                    setPeriod('7D');
                  }} style={{ fontSize: 12 }} title="Limpiar rango y volver a 7D">Limpiar</button>
                )}
                <button className="btn btn-primary" onClick={applyCustomRange}
                  disabled={!draftFrom || !draftTo || draftFrom > draftTo}
                  style={{ fontSize: 12, opacity: (!draftFrom || !draftTo || draftFrom > draftTo) ? 0.5 : 1 }}>
                  Aplicar
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Chat contextual — asistente sobre la vista actual (⌘⏎) */}
      {onOpenChat && (
        <button className="btn" onClick={onOpenChat} title="Asistente contextual (⌘⏎)"
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icons.Sparkles size={14} color="var(--accent)" />
          <span style={{ fontSize: 12, fontWeight: 600 }}>Chat</span>
        </button>
      )}

      {/* Dark/light */}
      <button className="btn" onClick={() => setMode(mode === 'dark' ? 'light' : 'dark')} title={mode === 'dark' ? 'Modo claro' : 'Modo oscuro'}>
        {mode === 'dark' ? <Icons.Sun size={14} /> : <Icons.Moon size={14} />}
      </button>
    </header>
  );
}

function CommandPalette({ onClose, onNav, onSetPeriod, onSetMode, onMentionClick, onOpenMentionsWithFilter, onSearchAll }) {
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
      const params = new URLSearchParams({ q, agency, limit: '8', ...getPeriodParams() });
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
    ...NAV.filter((n) => ecoCanSeePage(n.key)).map((n) => ({ kind: 'Ir a', label: n.label, action: () => onNav(n.key), icon: n.icon })),
    ...SYSTEM_NAV.filter((n) => ecoCanSeePage(n.key)).map((n) => ({ kind: 'Ir a', label: n.label, action: () => onNav(n.key), icon: n.icon })),
    // Period (real)
    { kind: 'Período', label: 'Hoy (1D)', action: () => onSetPeriod('1D'), icon: 'Calendar' },
    { kind: 'Período', label: 'Últimos 5 días (5D)', action: () => onSetPeriod('5D'), icon: 'Calendar' },
    { kind: 'Período', label: 'Últimos 7 días cerrados (7D)', action: () => onSetPeriod('7D'), icon: 'Calendar' },
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
  // "Ver todos los resultados" — primera opción cuando hay query, así Enter
  // por defecto abre la página de resultados completa (/search). Reúne el
  // buscador rápido (palette) con la página dedicada.
  const trimmedQuery = query.trim();
  const searchAllItems = (trimmedQuery.length >= 2 && onSearchAll) ? [{
    kind: 'Búsqueda',
    label: `Ver todos los resultados para «${trimmedQuery}»`,
    action: () => onSearchAll(trimmedQuery),
    icon: 'Search',
  }] : [];
  const filtered = [...searchAllItems, ...liveItems, ...commandsMatch];
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

/**
 * Mini mapa Leaflet del municipio detectado en una mención. Reemplaza el SVG
 * mock anterior (forma genérica de PR con un pin por región) por el mapa real
 * con tiles CARTO y un círculo en las coordenadas exactas. Color del círculo
 * según el sentimiento. Si Leaflet no cargó (CSP/red), cae a placeholder.
 */
function MiniMunicipalityMap({ municipality, region, coords, sentiment }) {
  const containerRef = React.useRef(null);
  const mapRef = React.useRef(null);
  const roRef = React.useRef(null);

  React.useEffect(() => {
    if (!containerRef.current || typeof window === 'undefined' || !window.L) return;
    const L = window.L;
    const hasCoords = Array.isArray(coords) && typeof coords[0] === 'number' && typeof coords[1] === 'number';
    // Encuadre por defecto: centro de PR. Si la mención tiene coords, se
    // ajustará en la siguiente línea.
    const center = hasCoords ? [coords[0], coords[1]] : [18.22, -66.59];
    const zoom = hasCoords ? 10 : 8;

    if (!mapRef.current) {
      const map = L.map(containerRef.current, {
        center, zoom,
        zoomControl: false,
        attributionControl: false,
        scrollWheelZoom: false,
        dragging: false,
        doubleClickZoom: false,
        boxZoom: false,
        touchZoom: false,
      });
      const mode = document.documentElement.getAttribute('data-mode') || 'dark';
      const tileUrl = mode === 'light'
        ? 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
        : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
      L.tileLayer(tileUrl, { subdomains: 'abcd', maxZoom: 14 }).addTo(map);
      mapRef.current = map;
      // El drawer entra con animación slideLeft (~0.26s); Leaflet mide el
      // contenedor al crear el mapa, cuando aún está transformado/sin tamaño,
      // y pinta tiles grises/desplazados. Forzar invalidateSize tras el layout
      // + un ResizeObserver lo corrige de forma robusta y agnóstica a duración.
      const remeasure = () => { if (mapRef.current) mapRef.current.invalidateSize(); };
      requestAnimationFrame(() => requestAnimationFrame(remeasure));
      setTimeout(remeasure, 300);
      if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
        const ro = new ResizeObserver(remeasure);
        ro.observe(containerRef.current);
        roRef.current = ro;
      }
    } else {
      mapRef.current.setView(center, zoom);
    }

    // Limpiar marcadores previos.
    mapRef.current.eachLayer((layer) => {
      if (layer instanceof L.CircleMarker) mapRef.current.removeLayer(layer);
    });

    if (hasCoords) {
      const color = sentiment === 'positivo' ? '#3FD47A' : sentiment === 'negativo' ? '#FF6A3D' : '#8A94A1';
      L.circleMarker(center, {
        radius: 9, color: '#0E1620', weight: 1.5,
        fillColor: color, fillOpacity: 0.85,
      }).addTo(mapRef.current);
    }
  }, [coords, sentiment]);

  // Cleanup on unmount — Leaflet sobre un container reusado en React
  // puede acumular handlers; remove() libera memoria y listeners.
  React.useEffect(() => () => {
    if (roRef.current) { roRef.current.disconnect(); roRef.current = null; }
    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }
  }, []);

  if (typeof window !== 'undefined' && !window.L) {
    return (
      <div style={{
        height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--text-3)', fontSize: 11, fontStyle: 'italic',
        background: 'var(--canvas-2)',
      }}>Cargando mapa…</div>
    );
  }

  return (
    <div style={{ position: 'relative', height: 140 }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
      <div style={{
        position: 'absolute', top: 6, left: 8, zIndex: 400,
        fontSize: 9, color: 'var(--text-3)', textTransform: 'uppercase',
        letterSpacing: '0.1em', fontWeight: 700,
        textShadow: '0 0 4px var(--canvas), 0 0 8px var(--canvas)',
        pointerEvents: 'none',
      }}>
        Puerto Rico · {region || 'PR'}
      </div>
    </div>
  );
}

function MentionDrawer({ mention, onClose, onNavigate, onMentionClick }) {
  const [related, setRelated] = React.useState(null); // null while loading, [] if none

  // Cerrar con Escape (mismo patrón que CommandPalette).
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Relacionadas por similitud coseno sobre embeddings (Titan Embed v2). Si
  // la mención fuente aún no tiene embedding (backfill pendiente), el backend
  // hace fallback a "mismo topic principal".
  React.useEffect(() => {
    if (!mention) return;
    setRelated(null);
    const ctrl = new AbortController();
    const agency = (typeof window !== 'undefined' && localStorage.getItem('eco.agency')) || '';
    // similar_to (#41): embeddings-based similarity (la columna de pertinencia
    // ya no se muestra; el related drawer ahora opera sobre cosine similarity).
    // getPeriodParams (mio): respeta la ventana del usuario, así el drawer no
    // mezcla menciones fuera del rango filtrado.
    const params = new URLSearchParams({ similar_to: mention.id, limit: '6', ...getPeriodParams() });
    if (agency) params.set('agency', agency);
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

          {(() => {
            // Solo mostrar métricas con valor > 0. Si todas son 0 (ej. tweet
            // huérfano), ocultar toda la sección.
            const metrics = [
              { label: 'Engagement', v: Number(mention.engagement) || 0 },
              { label: 'Likes', v: Number(mention.likes) || 0 },
              { label: 'Comentarios', v: Number(mention.comments) || 0 },
              { label: 'Compartidas', v: Number(mention.shares) || 0 },
            ].filter((m) => m.v > 0);
            if (metrics.length === 0) return null;
            const cols = Math.min(4, metrics.length);
            return (
              <div>
                <div className="section-eyebrow" style={{ marginBottom: 10 }}>Métricas</div>
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 12 }}>
                  {metrics.map((m) => (
                    <div key={m.label} style={{ padding: '12px', background: 'var(--canvas-2)', borderRadius: 8, border: '1px solid var(--hairline)' }}>
                      <div style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>{m.label}</div>
                      <div className="num" style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>{m.v.toLocaleString('es-PR')}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {mention.summary ? (
            <div>
              <div className="section-eyebrow" style={{ marginBottom: 10 }}>Resumen IA</div>
              <div style={{ padding: 14, background: 'var(--accent-fill)', border: '1px solid var(--hairline)', borderRadius: 10, fontSize: 13, lineHeight: 1.55, color: 'var(--text)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, fontSize: 10, color: 'var(--accent)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                  <Icons.Sparkles size={12} /> Generado con IA
                </div>
                {mention.summary}
              </div>
            </div>
          ) : null}

          {mention.snippet && (mention.snippet.trim() !== (mention.title || '').trim()) ? (
            <div>
              <div className="section-eyebrow" style={{ marginBottom: 10 }}>Contenido</div>
              <div style={{ padding: 14, background: 'var(--canvas-2)', border: '1px solid var(--hairline)', borderRadius: 10, fontSize: 13, lineHeight: 1.55, color: 'var(--text-2)', whiteSpace: 'pre-wrap' }}>
                {mention.snippet}
              </div>
            </div>
          ) : null}

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
                  <div className="mono" style={{ fontSize: 10, color: 'var(--text-3)' }}>{typeof mention.topicConfidence === 'number' ? `confianza ${Math.round(mention.topicConfidence * 100)}%` : 'confianza —'}</div>
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

          {/* Geografía — mini mapa Leaflet real (issue QA: el SVG mock anterior
              ignoraba las coordenadas exactas del municipio). */}
          {mention.municipality && (
            <div>
              <div className="section-eyebrow" style={{ marginBottom: 10 }}>Geografía detectada</div>
              <div style={{
                border: '1px solid var(--hairline)', borderRadius: 10, overflow: 'hidden',
                background: 'var(--canvas-2)',
              }}>
                <MiniMunicipalityMap
                  municipality={mention.municipality}
                  region={mention.region}
                  coords={mention.coords}
                  sentiment={mention.sentiment}
                />
                <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10, borderTop: '1px solid var(--hairline)' }}>
                  <Icons.MapPin size={14} color="var(--neg)" />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{mention.municipality}</div>
                    <div className="mono" style={{ fontSize: 10, color: 'var(--text-3)' }}>
                      {Array.isArray(mention.coords) && typeof mention.coords[0] === 'number' && typeof mention.coords[1] === 'number'
                        ? `${mention.coords[0].toFixed(4)}°N, ${Math.abs(mention.coords[1]).toFixed(4)}°O · Región ${mention.region}`
                        : `Región ${mention.region || 'PR'}`}
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
          </div>
        </div>
      </div>
    </>
  );
}

function TweaksPanel({ theme, setTheme, mode, setMode, density, setDensity, onClose }) {

  // Cerrar con Escape (mismo patrón que CommandPalette).
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
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

  // Cerrar con Escape (mismo patrón que CommandPalette).
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Cuando el slice filtra por tópico, default a "primary" (top-confidence) —
  // el conteo coincide con el row del Overview/Scorecard/TopicsScreen. Toggle
  // permite incluir secundarias y ver el total multi-clasificación.
  const hasTopicFilter = !!(slice && slice._filter && slice._filter.topic);
  const [topicMode, setTopicMode] = React.useState('primary');
  // Reset cuando cambia el slice (otro tópico, otro filtro).
  React.useEffect(() => { setTopicMode('primary'); }, [slice]);

  // If a slice carries a structured filter, fetch real matching mentions from
  // /api/eco-mentions and replace the placeholder list + counts. The slice
  // object is immutable; we merge the fetched fields into `liveSlice`.
  React.useEffect(() => {
    if (!slice || !slice._filter) { setLiveSlice(null); return; }
    setLoading(true);
    const filter = { ...slice._filter };
    // Solo enviamos topicMode cuando hay filtro de tópico — para otros filtros
    // (heatmap, source, day) el parámetro no aplica.
    if (filter.topic) filter.topicMode = topicMode;
    fetch('/api/eco-mentions?' + new URLSearchParams(Object.fromEntries(
      Object.entries({
        agency: localStorage.getItem('eco.agency') || '',
        ...getPeriodParams(),
        limit: '20',
        ...filter,
      }).filter(([, v]) => v != null && v !== '')
    )).toString(), { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : { mentions: [], total: 0, sentiment: { pos: 0, neu: 0, neg: 0 } })
      .then((j) => setLiveSlice(j))
      .catch(() => setLiveSlice({ mentions: [], total: 0, sentiment: { pos: 0, neu: 0, neg: 0 } }))
      .finally(() => setLoading(false));
  }, [slice, topicMode]);

  if (!slice) return null;
  const { eyebrow, title, highlight, accent = 'var(--accent)', ctaLabel, ctaIcon, onCta, insightText, subcomponents, headlineValue } = slice;
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
            {hasTopicFilter && (
              <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--text-2)' }}>
                <span style={{ color: 'var(--text-3)' }}>
                  {topicMode === 'primary'
                    ? 'Mostrando solo menciones donde este tópico es el principal'
                    : 'Mostrando todas las menciones que tocan este tópico (principal + secundario)'}
                </span>
                <button
                  className="chip"
                  onClick={() => setTopicMode((m) => (m === 'primary' ? 'all' : 'primary'))}
                  style={{ fontSize: 10, padding: '3px 8px' }}
                >
                  {topicMode === 'primary' ? '+ Incluir secundarias' : '— Solo principales'}
                </button>
              </div>
            )}
          </div>
          <button className="btn" onClick={onClose}><Icons.Close size={14} /></button>
        </div>

        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Insight LLM (cuando el slice viene de un click en una métrica
              sintética como Crisis, NSS, BHI). Va arriba del histogram +
              mentions; explica el porqué del número para esta agencia. */}
          {(insightText || headlineValue != null) && (
            <div className="card" style={{
              padding: 16, background: 'var(--canvas-2)', border: '1px solid var(--hairline)',
              display: 'flex', flexDirection: 'column', gap: 10,
            }}>
              {headlineValue != null && (
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                  <div className="num" style={{ fontSize: 30, fontWeight: 600, color: accent, fontFamily: 'var(--ff-display)', lineHeight: 1 }}>
                    {headlineValue}
                  </div>
                  {slice.headlineLabel && (
                    <div style={{ fontSize: 11, color: 'var(--text-2)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                      {slice.headlineLabel}
                    </div>
                  )}
                </div>
              )}
              {insightText && insightText !== '__loading__' && (
                <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.55 }}
                  dangerouslySetInnerHTML={{ __html: insightText }} />
              )}
              {insightText === '__loading__' && (
                <>
                  <div className="skeleton" style={{ height: 14 }} />
                  <div className="skeleton" style={{ height: 14, width: '95%' }} />
                  <div className="skeleton" style={{ height: 14, width: '82%' }} />
                </>
              )}
              {Array.isArray(subcomponents) && subcomponents.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                  <div className="section-eyebrow" style={{ marginBottom: 4 }}>Componentes</div>
                  {subcomponents.map((sc, i) => {
                    const pct = Math.max(0, Math.min(100, Number(sc.value) || 0));
                    return (
                      <div key={i} style={{ display: 'grid', gridTemplateColumns: '140px 1fr 60px', gap: 10, alignItems: 'center', fontSize: 11 }}>
                        <span style={{ color: 'var(--text-2)' }}>{sc.label}</span>
                        <div style={{ height: 6, borderRadius: 3, background: 'var(--canvas)', overflow: 'hidden', border: '1px solid var(--hairline)' }}>
                          <div style={{ height: '100%', width: `${pct}%`, background: sc.color || accent }} />
                        </div>
                        <span className="num" style={{ textAlign: 'right', color: 'var(--text)', fontWeight: 600 }}>
                          {sc.display ?? (Number.isFinite(Number(sc.value)) ? Number(sc.value).toFixed(2) : '—')}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
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
                      display: 'grid', gridTemplateColumns: '20px 1fr 90px 120px 120px',
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
                    {/* Tópico (columna nueva — reemplazó engagement). Truncado a una línea. */}
                    <span style={{ color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>
                      {mn.topicName || '—'}
                    </span>
                    {/* Subtópico (columna nueva — reemplazó pertinencia). Muestra el
                        primer subtopic + indicador "+N" si hay más. */}
                    <span style={{ color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>
                      {(mn.subtopics && mn.subtopics.length > 0) ? (
                        <>
                          {mn.subtopics[0]}
                          {mn.subtopics.length > 1 && (
                            <span style={{ color: 'var(--text-3)', marginLeft: 4 }}>+{mn.subtopics.length - 1}</span>
                          )}
                        </>
                      ) : '—'}
                    </span>
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
            <button className="btn"
              onClick={() => {
                // Export CSV client-side de las menciones cargadas en el slice
                // (antes el botón no tenía onClick — no hacía nada).
                const rows = mentions || [];
                if (!rows.length) { (window.ecoToast || (() => {}))('err', 'No hay menciones para exportar.'); return; }
                const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
                const headers = ['Título', 'Autor', 'Fuente', 'Dominio', 'Sentimiento', 'Tópico', 'Engagement', 'Fecha', 'URL'];
                const lines = [headers.join(',')];
                for (const mn of rows) {
                  lines.push([esc(mn.title), esc(mn.author), esc(mn.source), esc(mn.domain), esc(mn.sentiment), esc(mn.topicName), esc(mn.engagement), esc(mn.publishedAt), esc(mn.url)].join(','));
                }
                const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                const safe = ((slice && (slice.title || slice.eyebrow)) || 'menciones').toString().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'menciones';
                a.href = url; a.download = `eco-${safe}.csv`;
                document.body.appendChild(a); a.click(); document.body.removeChild(a);
                URL.revokeObjectURL(url);
                (window.ecoToast || (() => {}))('ok', `${rows.length} menciones exportadas.`);
              }}>
              <Icons.Download size={13} /> Exportar
            </button>
            <button className="btn"
              onClick={async () => {
                // La regla se deriva del slice activo (slice._filter + slice.title);
                // antes referenciaba una variable `mention` inexistente y lanzaba
                // ReferenceError al primer clic en cualquier drill-down.
                const f = (slice && slice._filter) || {};
                const label = (slice && (slice.title || slice.eyebrow)) || 'filtro actual';
                const name = prompt('Nombre de la alerta', 'Menciones · ' + label);
                if (!name || !name.trim()) return;
                // config.type debe pertenecer a KNOWN_CONFIG_TYPES del backend o
                // /api/alerts responde 422. negative_sentiment para slices
                // negativos; volume_spike para cualquier otro segmento.
                const type = (f.sentiment === 'negativo' || f.sentiment === 'negative') ? 'negative_sentiment' : 'volume_spike';
                const config = { type, threshold: { volumeMinutes: 60, minMentions: 5 } };
                ['topic', 'municipality', 'sentiment', 'source', 'emotion', 'region', 'minEngagement', 'day', 'dow', 'hour'].forEach((k) => {
                  if (f[k] != null && f[k] !== '') config[k] = f[k];
                });
                try {
                  const res = await fetch('/api/alerts', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'same-origin',
                    body: JSON.stringify({
                      name: name.trim(),
                      description: 'Creada desde: ' + label,
                      config,
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

// =========================================================
// MetricInsightModal — modal de drilldown para cada KPI del Scorecard.
// Patrón visual inspirado en OverviewHighlights (banda + etiqueta + valor)
// del Overview, ahora con serie temporal e interpretación AI coloquial.
//
// Props:
//   metricKey: 'nss' | 'crisis' | 'volume' | 'bhi' | 'polarization'
//   value:     number (valor en el periodo actual; sirve de placeholder
//              mientras carga el fetch)
//   label:     "Net Sentiment Score" etc.
//   accent:    color CSS para borde superior y línea del chart
//   period:    period activo del header (1D/7D/...)
//   agency:    slug de la agencia activa
// =========================================================
function MetricInsightModal({ metricKey, value, valueDisplay, label, accent = 'var(--accent)', period, agency, onClose }) {
  const { Sparkline, MultiLineChart } = window.ECO_CHARTS;
  const [data, setData] = React.useState(null);
  const [error, setError] = React.useState(null);

  // Cerrar con Escape (mismo patrón que CommandPalette).
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  React.useEffect(() => {
    // Cache por sesión: evita re-fetchear cuando el usuario abre y cierra
    // el mismo modal varias veces sin cambiar de period. El sufijo `.v3`
    // invalida cachés generados antes del backfill V3 (crisis sin gate +
    // BHI escala 1-10), que se quedaban pegados en sessionStorage del
    // tab y mostraban valores stale aún tras redeploy.
    const cacheKey = `eco.metricInsight.v3.${agency}.${metricKey}.${period}`;
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) { setData(JSON.parse(cached)); return; }
    } catch (_) {}
    const ctrl = new AbortController();
    const params = new URLSearchParams({ metric: metricKey, period: period || '7D' });
    if (agency) params.set('agency', agency);
    fetch(`/api/ai/metric-insight?${params.toString()}`, { credentials: 'same-origin', cache: 'no-store', signal: ctrl.signal })
      .then((r) => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then((j) => {
        setData(j);
        try { sessionStorage.setItem(cacheKey, JSON.stringify(j)); } catch (_) {}
      })
      .catch((e) => { if (e?.name !== 'AbortError') setError(String(e?.message || e)); });
    return () => ctrl.abort();
  }, [metricKey, period, agency]);

  function sanitize(html) {
    if (!html) return '';
    return String(html).replace(/<(?!\/?strong\b)[^>]*>/gi, '');
  }

  function formatValue(v) {
    if (v == null) return '—';
    if (metricKey === 'nss') return (v > 0 ? '+' : '') + Number(v).toFixed(1);
    if (metricKey === 'crisis') return Number(v).toFixed(2);
    // BHI: el endpoint /api/ai/metric-insight ya devuelve TODOS los campos
    // (value, deltaVsPrev, historicalP25/P75, series.value) en escala 1-10.
    // El placeholder inicial pasado por openMetric en screens.js también se
    // pre-convierte. Aquí solo formateamos a 1 decimal — sin re-mapear.
    if (metricKey === 'bhi') return Number(v).toFixed(1);
    if (metricKey === 'polarization') return Math.round(Number(v)) + '%';
    if (metricKey === 'volume') return Number(v).toLocaleString('es-PR');
    return String(v);
  }

  function bandColor(band) {
    if (!band) return 'var(--text-3)';
    const b = String(band).toUpperCase();
    if (['CRISIS', 'ALERTA', 'NEGATIVO', 'CRÍTICO'].includes(b)) return 'var(--neg)';
    if (['ELEVADO', 'DÉBIL', 'MODERADA', 'EXTREMA'].includes(b)) return 'var(--warn)';
    if (['SANO', 'POSITIVO', 'NORMAL', 'ALTA'].includes(b)) return 'var(--pos)';
    if (['FUERTE'].includes(b)) return 'var(--accent)';
    return 'var(--text-3)';
  }

  // Bandas para la barra gradiente — patrón replicado de OverviewHighlights
  // crisis card (screens.js:2865). Cada métrica tiene su gradiente.
  function bandConfig() {
    if (metricKey === 'crisis') {
      return {
        labels: ['NORMAL', 'ELEVADO', 'ALERTA', 'CRISIS'],
        gradient: 'linear-gradient(90deg, var(--pos) 0%, var(--pos) 25%, var(--warn) 25%, var(--warn) 40%, var(--neg) 40%, var(--neg) 60%, var(--neg) 100%)',
        pct: (v) => Math.min((v ?? 0) * 100, 100),
      };
    }
    if (metricKey === 'bhi') {
      return {
        labels: ['CRÍTICO', 'DÉBIL', 'SANO', 'FUERTE'],
        gradient: 'linear-gradient(90deg, var(--neg) 0%, var(--neg) 40%, var(--warn) 40%, var(--warn) 60%, var(--pos) 60%, var(--pos) 80%, var(--accent) 80%, var(--accent) 100%)',
        // Valor en escala 1-10 → posición 0-100% (clamp). Antes se multiplicaba
        // por 100 asumiendo 0-1, lo que dejaba el marcador siempre pegado al
        // borde derecho (cualquier valor >= 1 da pct = 100%).
        pct: (v) => Math.min(Math.max((((v ?? 1) - 1) / 9) * 100, 0), 100),
      };
    }
    if (metricKey === 'polarization') {
      return {
        labels: ['APÁTICA', 'MODERADA', 'ALTA', 'EXTREMA'],
        gradient: 'linear-gradient(90deg, var(--text-3) 0%, var(--text-3) 30%, var(--warn) 30%, var(--warn) 50%, #8B5CF6 50%, #8B5CF6 75%, var(--neg) 75%, var(--neg) 100%)',
        pct: (v) => Math.max(0, Math.min(v ?? 0, 100)),
      };
    }
    if (metricKey === 'nss') {
      return {
        labels: ['MUY NEG', 'NEG', 'NEUTRAL', 'POS', 'MUY POS'],
        gradient: 'linear-gradient(90deg, var(--neg) 0%, var(--neg) 30%, var(--warn) 30%, var(--warn) 45%, var(--text-3) 45%, var(--text-3) 55%, var(--pos) 55%, var(--pos) 70%, var(--accent) 70%, var(--accent) 100%)',
        pct: (v) => Math.max(0, Math.min(((v ?? 0) + 100) / 2, 100)),
      };
    }
    // volume — sin banda intrínseca, mostramos solo posición vs P25/P75
    return null;
  }

  const displayValue = data ? data.value : value;
  const displayBand = data ? data.band : null;
  // Formato legible (palabra + número de apoyo). Viene del API
  // (@eco/shared/format) o del placeholder inicial pasado por openMetric.
  // Cae a formatValue() si ninguno está disponible.
  const vd = (data && data.valueDisplay) || valueDisplay || null;
  const dd = (data && data.deltaDisplay) || null;
  const cfg = bandConfig();
  const series = (data && data.series) || [];

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} style={{ zIndex: 2000 }} />
      <div role="dialog" aria-modal="true" style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: 'min(720px, 94vw)', maxHeight: '88vh', overflow: 'auto',
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: 6 }}>
              <span>Métrica · {period || '—'}</span>
              {data && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--accent)', background: 'var(--accent-fill)', padding: '2px 6px', borderRadius: 4 }}>
                  <Icons.Sparkles size={9} /> IA
                </span>
              )}
            </div>
            <div style={{ fontSize: 22, fontWeight: 600, fontFamily: 'var(--ff-display)', letterSpacing: 'var(--letter-display)', lineHeight: 1.25, color: 'var(--text)' }}>
              {label}
            </div>
            <div style={{ marginTop: 12, display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
              <div className="num" style={{ fontSize: 30, fontWeight: 600, color: vd ? vd.color : 'var(--text)', fontFamily: 'var(--ff-display)', lineHeight: 1 }}>
                {vd ? vd.word : formatValue(displayValue)}
              </div>
              {vd && vd.value && (
                <div className="num" style={{ fontSize: 13, color: 'var(--text-2)', fontWeight: 600 }}>{vd.value}</div>
              )}
              {!vd && displayBand && (
                <div style={{ fontSize: 11, fontWeight: 700, color: bandColor(displayBand), letterSpacing: '0.06em' }}>
                  {displayBand}
                </div>
              )}
              {dd ? (
                dd.hasBaseline ? (
                  <div style={{ fontSize: 11, fontWeight: 600, color: dd.direction === 'flat' ? 'var(--text-3)' : (dd.tone === 'pos' ? 'var(--pos)' : dd.tone === 'neg' ? 'var(--neg)' : 'var(--text-3)') }}>
                    {dd.direction === 'flat' ? `· ${dd.word}` : `${dd.arrow} ${dd.value}`}
                    <span style={{ color: 'var(--text-3)', fontWeight: 500 }}> vs período anterior</span>
                  </div>
                ) : (
                  <div style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 500 }}>— sin base de comparación</div>
                )
              ) : (data && data.deltaVsPrev != null && (
                <div style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 500 }}>
                  {data.deltaVsPrev > 0 ? '▲ +' : data.deltaVsPrev < 0 ? '▼ ' : '· '}
                  {Math.abs(data.deltaVsPrev)} vs ventana anterior
                </div>
              ))}
            </div>
          </div>
          <button className="btn" onClick={onClose}><Icons.Close size={14} /></button>
        </div>

        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Banda visual — patrón Overview crisis card. */}
          {cfg && displayValue != null && (
            <div>
              <div style={{ height: 8, borderRadius: 4, background: cfg.gradient, position: 'relative' }}>
                <div style={{ position: 'absolute', left: `${cfg.pct(displayValue)}%`, top: -4, width: 14, height: 14, borderRadius: '50%', background: 'var(--canvas)', border: `2px solid ${bandColor(displayBand)}`, transform: 'translateX(-50%)' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--text-3)', marginTop: 6, fontFamily: 'var(--ff-mono)' }}>
                {cfg.labels.map((l) => <span key={l}>{l}</span>)}
              </div>
            </div>
          )}

          {/* Interpretación AI coloquial (issue #4). */}
          <div style={{
            padding: '14px 16px', background: 'var(--canvas-2)',
            border: '1px solid var(--hairline)', borderRadius: 8,
            fontSize: 13, lineHeight: 1.5, color: 'var(--text)',
          }}>
            {!data && !error && (
              <span style={{ color: 'var(--text-3)' }}>Generando interpretación…</span>
            )}
            {error && (
              <span style={{ color: 'var(--neg)' }}>No se pudo generar la interpretación: {error}</span>
            )}
            {data && data.interpretation && (
              <span dangerouslySetInnerHTML={{ __html: sanitize(data.interpretation) }} />
            )}
          </div>

          {/* Serie temporal de la métrica para la ventana del period. */}
          <div>
            <div className="section-eyebrow" style={{ marginBottom: 8 }}>Evolución diaria</div>
            {series.length === 0 && (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)', fontSize: 12, background: 'var(--canvas-2)', borderRadius: 6 }}>
                Sin datos suficientes para graficar la serie.
              </div>
            )}
            {series.length > 0 && (
              <MultiLineChart
                data={series}
                series={[{ key: 'value', label, color: accent }]}
                height={200}
                /* Dominio Y absoluto por métrica: sin esto la normalización
                   por-serie estira la línea a min/max del period y un valor
                   como 0.12 → 0.28 (crisis NORMAL) se ve dramático, como si
                   tocara fondo y techo. Con dominio fijo el usuario ve la
                   posición real en la escala completa de la métrica. */
                yDomain={
                  metricKey === 'crisis' ? [0, 1]
                  : metricKey === 'bhi' ? [1, 10]
                  : metricKey === 'polarization' ? [0, 100]
                  : metricKey === 'nss' ? [-100, 100]
                  : null
                }
                valueFormat={(v) => formatValue(v)}
              />
            )}
          </div>

          {/* Tópicos contribuyentes (opcional). */}
          {data && data.topContributingTopics && data.topContributingTopics.length > 0 && (
            <div>
              <div className="section-eyebrow" style={{ marginBottom: 8 }}>Tópicos contribuyentes</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {data.topContributingTopics.map((t) => (
                  <div key={t.name} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
                    <span style={{ flex: 1, color: 'var(--text)' }}>{t.name}</span>
                    <span className="num" style={{ color: 'var(--text-3)', fontSize: 11 }}>{Math.round(t.share * 100)}%</span>
                    <div style={{ width: 80, height: 4, background: 'var(--canvas-2)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ width: `${Math.min(t.share * 100, 100)}%`, height: '100%', background: accent }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Contexto histórico — P25/P75 90d. */}
          {data && data.historicalP25 != null && data.historicalP75 != null && (
            <div style={{ fontSize: 11, color: 'var(--text-3)', fontStyle: 'italic' }}>
              Rango típico de los últimos 90 días: <strong className="num" style={{ color: 'var(--text-2)' }}>{formatValue(data.historicalP25)}</strong> a <strong className="num" style={{ color: 'var(--text-2)' }}>{formatValue(data.historicalP75)}</strong>.
            </div>
          )}
        </div>
      </div>
    </>
  );
}

window.ECO_SHELL = { Sidebar, Header, CommandPalette, MentionDrawer, MentionsSliceModal, MetricInsightModal, TweaksPanel, NAV, SYSTEM_NAV };
