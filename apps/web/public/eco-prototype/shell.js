// Shell: sidebar, header, command palette, drawer, tweaks
const { Icons } = window;
const { useState, useEffect, useRef } = React;

/**
 * Responsive breakpoint hook. Inline style objects CANNOT carry @media
 * queries, so every screen that must restructure its layout branches on the
 * value returned here instead. Defined in shell.js because it loads before
 * screens.js and app.js, so both can read `window.ecoUseBreakpoint`.
 *   'mobile'  <= 768px   'tablet'  769–1024px   'desktop' > 1024px
 * These stops mirror the CSS breakpoints in index.html.
 */
function useBreakpoint() {
  const get = () => {
    if (typeof window === 'undefined') return 'desktop';
    const w = window.innerWidth;
    return w <= 768 ? 'mobile' : w <= 1024 ? 'tablet' : 'desktop';
  };
  const [bp, setBp] = useState(get);
  useEffect(() => {
    let raf = null;
    const onResize = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = null; setBp(get()); });
    };
    window.addEventListener('resize', onResize);
    onResize();
    return () => { window.removeEventListener('resize', onResize); if (raf) cancelAnimationFrame(raf); };
  }, []);
  return bp;
}
window.ecoUseBreakpoint = useBreakpoint;

/**
 * Render-time breakpoint helpers for screens.js. They read window.innerWidth
 * at call time (not cached state), so they're always fresh — and because the
 * App root subscribes to resize via useBreakpoint() and re-renders the whole
 * screen tree, any descendant that calls ecoCols() re-computes on resize
 * without needing `bp` threaded through props.
 */
window.ecoBp = function () {
  if (typeof window === 'undefined') return 'desktop';
  const w = window.innerWidth;
  return w <= 768 ? 'mobile' : w <= 1024 ? 'tablet' : 'desktop';
};
// ecoCols(desktop, mobile, tablet?) → grid-template-columns for the current
// breakpoint. tablet falls back to desktop when omitted.
window.ecoCols = function (desktop, mobile, tablet) {
  const b = window.ecoBp();
  if (b === 'mobile') return mobile;
  if (b === 'tablet') return tablet != null ? tablet : desktop;
  return desktop;
};
window.ecoIsMobile = function () { return window.ecoBp() === 'mobile'; };

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
      // Default '7D': el MISMO que usa app.js para el estado inicial. Antes era
      // '1M' y el estado React arrancaba en '7D' — dos defaults distintos para
      // el mismo concepto (auditoría consistencia 2026-08). `ECO_DEFAULT_PERIOD`
      // es esa fuente única —la fija el boot de index.html y la lee app.js—, así
      // que aquí se consulta en vez de repetir el literal en un tercer sitio.
      const period = localStorage.getItem('eco.period') || window.ECO_DEFAULT_PERIOD || '7D';
    if (period === 'custom') {
      const from = localStorage.getItem('eco.from') || '';
      const to = localStorage.getItem('eco.to') || '';
      if (from && to) return { period, from, to };
    }
    return { period };
  } catch (_) {
    return { period: '7D' };
  }
}
window.ecoGetPeriodParams = getPeriodParams;

// Espejo client-side del PERIOD_DAYS canónico de @eco/shared/dates.ts. Si se
// añade un chip de período nuevo, actualizar AMBOS.
const ECO_PERIOD_DAYS = {
  '1D': 1, '5D': 5, '7D': 7, '30D': 30, '90D': 90,
  '1M': 30, '2M': 60, '3M': 90, '6M': 180, '1A': 365, 'Max': 730,
};

/**
 * Ventana efectiva del dashboard como { from, to } (YYYY-MM-DD, días AST
 * inclusivos). Custom → lo guardado por el FilterBar; preset → la MISMA
 * ventana cerrada terminando AYER que calculan /api/eco-data, /api/overview
 * y los correos (closedWindowYmdInTZ). Los drill-downs la usan para mandar
 * bordes explícitos a /api/eco-mentions en vez de dejar que el endpoint
 * derive una ventana rolling distinta — la causa #1 de "el número de la
 * modal no cuadra con la card" (auditoría consistencia 2026-08).
 *
 * AST es UTC-4 fijo (Puerto Rico no tiene DST), así que "hoy en AST" es el
 * reloj UTC corrido 4 horas — sin depender de la TZ del navegador.
 */
function ecoResolvedWindow() {
  try {
    const period = localStorage.getItem('eco.period') || '7D';
    if (period === 'custom') {
      const from = localStorage.getItem('eco.from') || '';
      const to = localStorage.getItem('eco.to') || '';
      if (from && to) return { from, to };
    }
    const days = ECO_PERIOD_DAYS[period] || 7;
    const cursor = new Date(Date.now() - 4 * 3600 * 1000); // reloj AST
    cursor.setUTCDate(cursor.getUTCDate() - 1);            // ayer (día cerrado)
    const to = cursor.toISOString().slice(0, 10);
    cursor.setUTCDate(cursor.getUTCDate() - (days - 1));
    const from = cursor.toISOString().slice(0, 10);
    return { from, to };
  } catch (_) {
    return null;
  }
}
window.ecoResolvedWindow = ecoResolvedWindow;

// Badges are derived from real data at render time (window.ECO_DATA).
// `group` corta este orden en los tramos del rail (Lectura / Detalle /
// Seguimiento) SIN reordenarlo. Sin badges (sep-2026): el de Menciones era el
// total del período —no pide acción— y el de Alertas, en rojo, contaba reglas
// ENCENDIDAS (a.active), no disparos: una falsa alarma permanente.
function getNav() {
  return [
    // Orden pedido por el usuario (ago-2026): Overview, Tópicos, Narrativas y
    // después el resto en su orden previo. La lectura va de "qué pasó" a "de
    // qué se habla" a "cómo se está contando", antes de bajar al detalle.
    // ESTE ARRAY ES LA FUENTE ÚNICA del orden: el rail de escritorio, el drawer
    // off-canvas de móvil (mismo <Sidebar>, movido por CSS) y la sección "Ir a"
    // del ⌘K lo iteran sin reordenar. Si cambias este orden, actualiza también
    // PAGE_OPTIONS (screens.js) y SCREEN_META (app.js), que son las dos únicas
    // copias con orden significativo.
    { key: 'overview', icon: 'Grid', label: 'Overview', shortcut: 'O', group: 'Lectura' },
    { key: 'topics', icon: 'Hash', label: 'Tópicos', shortcut: 'T', group: 'Lectura' },
    { key: 'narrative', icon: 'Branches', label: 'Narrativas', shortcut: 'N', group: 'Lectura' },
    { key: 'dashboard', icon: 'Dashboard', label: 'Scorecard', shortcut: 'D', group: 'Detalle' },
    { key: 'mentions', icon: 'Mentions', label: 'Menciones', shortcut: 'M', group: 'Detalle' },
    { key: 'sentiment', icon: 'Activity', label: 'Sentimiento', shortcut: 'S', group: 'Detalle' },
    { key: 'geography', icon: 'MapPin', label: 'Geografía', shortcut: 'G', group: 'Detalle' },
    { key: 'alerts', icon: 'Bell', label: 'Alertas', shortcut: 'A', group: 'Seguimiento' },
  ];
}
const NAV = getNav();

// Navegación de la vista ejecutiva multi-agencia. Solo se muestra cuando la
// agencia seleccionada es el sentinel '__all__' (staff). Reemplaza la nav de
// una sola agencia — no tiene sentido mezclar pantallas de una agencia con la
// vista de gobierno compuesta.
const EXEC_NAV = [
  { key: 'exec-tabla', icon: 'Table', label: 'Tabla de posiciones', group: 'Vista ejecutiva' },
  { key: 'exec-sala', icon: 'Grid', label: 'Sala de mando', group: 'Vista ejecutiva' },
  { key: 'exec-radar', icon: 'Radio', label: 'Radar de crisis', group: 'Vista ejecutiva' },
];
function navForAgency(agencyKey) {
  return agencyKey === '__all__' ? EXEC_NAV : NAV;
}

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
  // Alertas: restringida por correo desde el servidor (ALERTS_ALLOWED_EMAILS →
  // /api/auth/me expone `canSeeAlerts`). Flag propio y no un recorte de
  // allowedPages, porque esa lista significa "vacía = todas". Sin sesión
  // cargada NO se oculta (evita parpadeo); el corte real vive en las rutas
  // /api/alerts/*, así que ocultarlo aquí es solo cosmético.
  if (key === 'alerts' && s.canSeeAlerts === false) return false;
  if (key !== 'overview' && Array.isArray(s.allowedPages) && s.allowedPages.length > 0 && !s.allowedPages.includes(key)) return false;
  if (key === 'settings') {
    return ecoHasCap('manage_users') || ecoHasCap('manage_templates') || ecoHasCap('manage_alert_rules');
  }
  return true;
}
if (typeof window !== 'undefined') { window.ecoCanSeePage = ecoCanSeePage; window.ecoHasCap = ecoHasCap; }

// Iniciales de una persona. Un solo algoritmo para el rail, la tabla de
// Configuración y el drawer: el rail partía por espacio/arroba/punto y la tabla
// sólo por espacio, así que un usuario sin `name` —que cae a la parte local del
// correo, «laura.quinones»— salía con dos letras en un sitio y una en el otro.
function ecoInitials(nameOrEmail) {
  const parts = String(nameOrEmail || 'Usuario').split(/[\s@._-]+/).filter(Boolean);
  return parts.slice(0, 2).map((x) => x[0].toUpperCase()).join('') || 'U';
}

// Avatar único (rail + tabla de usuarios + drawer). A la persona la identifican
// sus INICIALES, no un hue: el fondo por hash del correo repartía la paleta
// categórica —que se asigna EN ORDEN, ver data.js— y llegaba a --cat-8, el gris
// reservado a «resto/otros», mientras el mismo usuario salía naranja de marca en
// el rail. Fondo neutro derivado de --text-2, que además conserva el contraste
// que motivó abandonar el azul fijo de 4.20:1 (las iniciales van en --text sobre
// una mezcla al 18%). Al usuario de la sesión se le marca con un anillo
// --accent, no con otro relleno. `tone="rail"` existe porque el rail es oscuro
// en los dos modos y --canvas-2 (#091018) sobre --rail-bg (#030609) no se vería.
function Avatar({ name, size = 28, tone = 'surface', self = false }) {
  const rail = tone === 'rail';
  return (
    <div title={String(name || '')} style={{
      width: size, height: size, borderRadius: 'var(--r-circle)', flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: rail ? 'rgba(255,255,255,0.12)' : 'color-mix(in oklab, var(--text-2) 18%, transparent)',
      border: `1px solid ${rail ? 'rgba(255,255,255,0.22)' : 'color-mix(in oklab, var(--text-2) 35%, transparent)'}`,
      color: rail ? 'rgba(255,255,255,0.92)' : 'var(--text)',
      fontSize: 'var(--fs-overline)', fontWeight: 700, lineHeight: 1,
      boxShadow: self ? '0 0 0 2px var(--accent)' : 'none',
    }}>{ecoInitials(name)}</div>
  );
}

// Menú flotante del rail y del header (selector de agencia, menú de usuario,
// "Más" del período). Se posiciona `fixed` contra el rect del disparador porque
// el rail recorta su contenido (overflow:hidden para el colapso) y un menú
// absoluto quedaba cortado en el rail de 64px. Cierra con clic fuera y con Esc.
function EcoMenu({ anchor, placement = 'below', width = 260, onClose, children, label }) {
  const [rect, setRect] = React.useState(null);
  React.useLayoutEffect(() => {
    if (anchor && anchor.current) setRect(anchor.current.getBoundingClientRect());
  }, [anchor]);
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  if (!rect) return null;
  const vw = window.innerWidth, vh = window.innerHeight;
  const pos = {};
  if (placement === 'right') { pos.left = Math.min(rect.right + 8, vw - width - 8); pos.top = Math.max(8, Math.min(rect.top, vh - 360)); }
  else if (placement === 'above') { pos.left = Math.max(8, Math.min(rect.left, vw - width - 8)); pos.bottom = vh - rect.top + 6; }
  else if (placement === 'below-end') { pos.left = Math.max(8, Math.min(rect.right - width, vw - width - 8)); pos.top = rect.bottom + 6; }
  else { pos.left = Math.max(8, Math.min(rect.left, vw - width - 8)); pos.top = rect.bottom + 6; }
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 2090 }} />
      <div role="menu" aria-label={label} className="eco-menu" style={{
        position: 'fixed', zIndex: 2100, width, maxWidth: 'calc(100vw - 16px)', ...pos,
        maxHeight: 'min(70vh, 520px)', overflowY: 'auto',
        background: 'var(--surface-overlay)', color: 'var(--text)',
        border: '1px solid var(--hairline-strong)', borderRadius: 'var(--r-sm)',
        boxShadow: 'var(--shadow-lg)', padding: 'var(--sp-1) 0',
      }}>{children}</div>
    </>
  );
}

// Fila de EcoMenu. `checked` marca la opción vigente con un check (no con
// color: el cromo es acromático, ver --action en tokens.css).
function EcoMenuItem({ icon, label, hint, checked, onClick, danger }) {
  const IconC = icon ? Icons[icon] : null;
  return (
    <button role="menuitem" onClick={onClick} className="eco-menu-item" style={{
      display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', width: '100%',
      minHeight: 'var(--control-h)', padding: '0 var(--sp-3)', textAlign: 'left',
      fontSize: 'var(--fs-body-sm)', fontWeight: checked ? 600 : 400,
      color: danger ? 'var(--neg)' : 'var(--text)', background: 'transparent', border: 0,
    }}>
      <span style={{ width: 16, display: 'flex', flexShrink: 0 }}>
        {checked ? <Icons.Check size={14} /> : (IconC ? <IconC size={14} color="var(--text-3)" /> : null)}
      </span>
      <span style={{ flex: 1, minWidth: 0 }} className="truncate">{label}</span>
      {hint && <span className="mono" style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)' }}>{hint}</span>}
    </button>
  );
}
function EcoMenuRule() {
  return <div style={{ height: 1, background: 'var(--hairline)', margin: 'var(--sp-1) 0' }} />;
}

// Monograma de la agencia: sus dos primeras letras en mono. Acromático por la
// misma razón que el avatar (el color por hash es justo lo que el sistema
// prohíbe: se leería como una serie del gráfico).
function AgencyMark({ agency, size = 30 }) {
  const txt = agency && agency.key === '__all__' ? '∗' : String((agency && agency.name) || '—').slice(0, 2);
  return (
    <span className="mono" aria-hidden="true" style={{
      width: size, height: size, borderRadius: 'var(--r-sm)', flexShrink: 0,
      background: 'var(--rail-fg-active)', color: 'var(--rail-bg)',
      fontSize: 'var(--fs-caption)', fontWeight: 600,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>{txt}</span>
  );
}

// Rail de navegación (S1 «Rail grafito», sep-2026). Tres decisiones:
//  1. El rail responde «dónde estoy»: la AGENCIA —el alcance de todo lo que se
//     ve— sube aquí desde el header, donde era la pastilla más chica de 15
//     controles, y deja de repetirse en el pie del usuario.
//  2. Acromático: grafito en los dos modos, sin naranja. El color queda para el
//     dato (dirección «Instrumento», ago-2026).
//  3. Menos que leer: grupos Lectura/Detalle/Seguimiento que CORTAN el orden de
//     getNav() sin reordenarlo; sin badges (el de Menciones era el total del
//     período y el de Alertas, pintado de rojo, contaba reglas ENCENDIDAS —una
//     falsa alarma—); atajos visibles porque el listener de app.js sí existe;
//     Configuración, modo y cierre de sesión al menú del usuario.
function Sidebar({ active, onNav, collapsed, setCollapsed, agency, agencies, setAgency, mode, setMode }) {
  const I = Icons;
  const isExecView = (agency && agency.key) === '__all__';
  const analysisNav = navForAgency(agency && agency.key).filter((n) => isExecView || ecoCanSeePage(n.key));
  const groups = [];
  analysisNav.forEach((n) => {
    const g = n.group || '';
    if (!groups.length || groups[groups.length - 1].label !== g) groups.push({ label: g, items: [] });
    groups[groups.length - 1].items.push(n);
  });
  const agencyList = agencies || [];
  const canSwitch = agencyList.length > 1;
  const [agencyOpen, setAgencyOpen] = React.useState(false);
  const [userOpen, setUserOpen] = React.useState(false);
  const agencyBtn = React.useRef(null);
  const userBtn = React.useRef(null);
  const session = ecoSession();
  const userName = (session && (session.name || session.email)) || 'Usuario';
  const ROLE_LABEL = { admin: 'Administrador', editor: 'Editor', analyst: 'Analista', viewer: 'Lector' };
  const roleLabel = session && session.role ? (ROLE_LABEL[session.role] || session.role) : '—';
  const ingest = (window.ECO_DATA && window.ECO_DATA.INGESTION_STATUS) || null;
  const canSettings = ecoCanSeePage('settings');

  const NavItem = ({ item }) => {
    const IconC = I[item.icon];
    const isActive = active === item.key;
    return (
      <button onClick={() => onNav(item.key)} className="eco-rail-item"
        aria-current={isActive ? 'page' : undefined}
        title={collapsed ? item.label : undefined}
        aria-label={collapsed ? item.label : undefined}
        style={{
          display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', width: '100%',
          height: 34, padding: collapsed ? 0 : '0 var(--sp-3)',
          justifyContent: collapsed ? 'center' : 'flex-start',
          borderRadius: 'var(--r-sm)', border: 0,
          background: isActive ? 'var(--rail-active-bg)' : 'transparent',
          color: isActive ? 'var(--rail-fg-active)' : 'var(--rail-fg)',
          // Marca de activo = barra blanca interior, no color: en un rail
          // acromático el relleno solo (10% de blanco) no bastaba en proyector.
          boxShadow: isActive ? 'inset 2px 0 0 var(--rail-fg-active)' : 'none',
          fontSize: 'var(--fs-body)', fontWeight: isActive ? 600 : 500,
        }}>
        <IconC size={16} />
        {!collapsed && <>
          <span style={{ flex: 1, textAlign: 'left' }} className="truncate">{item.label}</span>
          {item.shortcut && <span className="mono hide-mobile" aria-hidden="true" style={{ fontSize: 'var(--fs-caption)', color: 'var(--rail-fg-muted)', opacity: 0.8 }}>{item.shortcut}</span>}
        </>}
      </button>
    );
  };

  return (
    <aside className="eco-sidebar" style={{
      background: 'var(--rail-bg)', color: 'var(--rail-fg)',
      borderRight: '1px solid var(--rail-border)',
      display: 'flex', flexDirection: 'column',
      height: '100vh', position: 'sticky', top: 0, overflowX: 'hidden', overflowY: 'auto',
    }}>
      {/* Marca. Sin «v2.3» ni «Operations Console» (inglés, no informaban) y sin
          el punto azul pegado al logo: el estado de la recolección vive UNA vez,
          en el pie. */}
      <div style={{
        height: 60, flexShrink: 0, padding: collapsed ? 0 : '0 var(--sp-2) 0 var(--sp-4)',
        display: 'flex', alignItems: 'center', gap: 'var(--sp-3)',
        justifyContent: collapsed ? 'center' : 'flex-start',
        borderBottom: '1px solid var(--rail-border)',
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: 'var(--r-sm)', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--rail-tint)', border: '1px solid var(--rail-tint-border)',
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
            <path d="M 7 19 A 7 7 0 0 1 7 5" stroke="var(--rail-fg-active)" strokeWidth="1.8" strokeLinecap="round" opacity="0.35" />
            <path d="M 10 17 A 5 5 0 0 1 10 7" stroke="var(--rail-fg-active)" strokeWidth="1.8" strokeLinecap="round" opacity="0.6" />
            <path d="M 13 15 A 3 3 0 0 1 13 9" stroke="var(--rail-fg-active)" strokeWidth="1.8" strokeLinecap="round" opacity="0.9" />
            <circle cx="16.5" cy="12" r="1.9" fill="var(--rail-fg-active)" />
          </svg>
        </div>
        {!collapsed && <>
          <span style={{ flex: 1, color: 'var(--rail-fg-active)', fontSize: 'var(--fs-title-md)', fontWeight: 600, letterSpacing: '0.04em' }}>ECO</span>
          <button onClick={() => setCollapsed(true)} className="hide-mobile eco-rail-item" aria-label="Colapsar menú" title="Colapsar menú ( [ )"
            style={{ width: 32, height: 32, border: 0, borderRadius: 'var(--r-sm)', background: 'transparent', color: 'var(--rail-fg-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <I.PanelLeft size={16} />
          </button>
        </>}
      </div>

      {/* Agencia: el alcance de todo. Con una sola agencia visible (usuario
          restringido) es una etiqueta, no un control: no se ofrece un menú de
          una opción. */}
      <div style={{ padding: collapsed ? 'var(--sp-3) var(--sp-2) var(--sp-1)' : 'var(--sp-3) var(--sp-3) var(--sp-1)' }}>
        {(() => {
          const inner = (
            <>
              <AgencyMark agency={agency} />
              {!collapsed && (
                <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                  <span style={{ display: 'block', color: 'var(--rail-fg-active)', fontSize: 'var(--fs-body)', fontWeight: 600 }} className="truncate">{(agency && agency.name) || '—'}</span>
                  <span style={{ display: 'block', color: 'var(--rail-fg-muted)', fontSize: 'var(--fs-caption)' }} className="truncate">{(agency && agency.long) || ''}</span>
                </span>
              )}
              {!collapsed && canSwitch && <I.ChevronsUpDown size={15} color="var(--rail-fg-muted)" />}
            </>
          );
          const box = {
            width: '100%', minHeight: 52, padding: collapsed ? 'var(--sp-2) 0' : '0 var(--sp-2)',
            display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'flex-start', gap: 'var(--sp-2)',
            background: 'var(--rail-tint)', border: '1px solid var(--rail-tint-border)', borderRadius: 'var(--r-sm)',
            color: 'var(--rail-fg-active)',
          };
          if (!canSwitch) return <div style={box} title={agency && agency.long}>{inner}</div>;
          return (
            <button ref={agencyBtn} onClick={() => setAgencyOpen(true)} className="eco-rail-item"
              aria-haspopup="menu" aria-expanded={agencyOpen}
              aria-label={`Agencia: ${(agency && agency.long) || ''}. Cambiar agencia`}
              title={collapsed ? (agency && agency.long) : undefined} style={box}>{inner}</button>
          );
        })()}
        {agencyOpen && (
          <EcoMenu anchor={agencyBtn} placement={collapsed ? 'right' : 'below'} width={340} label="Cambiar agencia" onClose={() => setAgencyOpen(false)}>
            {agencyList.map((a) => (
              <EcoMenuItem key={a.key} checked={agency && a.key === agency.key}
                label={a.long || a.name}
                hint={a.archived ? 'archivada' : a.name}
                onClick={() => { setAgencyOpen(false); if (!agency || a.key !== agency.key) setAgency(a.key); }} />
            ))}
          </EcoMenu>
        )}
      </div>

      <nav aria-label="Secciones" style={{ padding: collapsed ? 'var(--sp-2)' : 'var(--sp-2) var(--sp-3)', display: 'flex', flexDirection: 'column', gap: collapsed ? 'var(--sp-3)' : 'var(--sp-4)' }}>
        {groups.map((g, gi) => (
          <div key={g.label || gi} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-05)' }}>
            {!collapsed && g.label && (
              <div className="mono" style={{ padding: '0 var(--sp-3) var(--sp-15)', fontSize: 'var(--fs-caption)', fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--rail-fg-muted)' }}>{g.label}</div>
            )}
            {collapsed && gi > 0 && <div style={{ height: 1, background: 'var(--rail-border)', margin: '0 var(--sp-2) var(--sp-2)' }} />}
            {g.items.map((n) => <NavItem key={n.key} item={n} />)}
          </div>
        ))}
      </nav>

      <div style={{ flex: 1 }} />

      {/* Recolección: el ÚNICO lugar donde se dice. El header dice qué ventana
          se está mirando; esto dice cuándo entró la última mención. Son dos
          hechos distintos y antes se pisaban («Ingesta en vivo» contra «Datos
          al cierre de ayer»). */}
      {/* La vista ejecutiva mezcla agencias: no hay UNA última recolección. */}
      {!collapsed && !isExecView && (
        <div style={{ padding: 'var(--sp-3) var(--sp-4)', borderTop: '1px solid var(--rail-border)', fontSize: 'var(--fs-caption)', color: 'var(--rail-fg-muted)', lineHeight: 1.4 }}>
          {agency && agency.archived
            ? 'Recolección detenida · agencia archivada'
            : <>Última recolección <span className="mono" style={{ color: 'var(--rail-fg)' }}>{(ingest && ingest.lastIngestLabel) || '—'}</span></>}
        </div>
      )}

      {collapsed && (
        <button onClick={() => setCollapsed(false)} className="hide-mobile eco-rail-item" aria-label="Expandir menú" title="Expandir menú ( ] )"
          style={{ height: 40, border: 0, borderTop: '1px solid var(--rail-border)', background: 'transparent', color: 'var(--rail-fg-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <I.PanelLeft size={16} />
        </button>
      )}

      {/* Usuario: un solo botón que abre Configuración, modo y salir. */}
      <button ref={userBtn} onClick={() => setUserOpen(true)} className="eco-rail-item"
        aria-haspopup="menu" aria-expanded={userOpen} aria-label={`Cuenta de ${userName}`}
        style={{
          flexShrink: 0, minHeight: 56, padding: collapsed ? 0 : '0 var(--sp-3) 0 var(--sp-4)',
          border: 0, borderTop: '1px solid var(--rail-border)',
          background: active === 'settings' ? 'var(--rail-active-bg)' : 'transparent',
          color: 'var(--rail-fg-active)', textAlign: 'left',
          display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', justifyContent: collapsed ? 'center' : 'flex-start',
        }}>
        <Avatar name={userName} size={28} tone="rail" />
        {!collapsed && <>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 'var(--fs-body-sm)', fontWeight: 500 }} className="truncate">{userName}</span>
            <span style={{ display: 'block', fontSize: 'var(--fs-caption)', color: 'var(--rail-fg-muted)' }}>{roleLabel}</span>
          </span>
          <I.ChevronsUpDown size={15} color="var(--rail-fg-muted)" />
        </>}
      </button>
      {userOpen && (
        <EcoMenu anchor={userBtn} placement={collapsed ? 'right' : 'above'} width={240} label="Cuenta" onClose={() => setUserOpen(false)}>
          {canSettings && <EcoMenuItem icon="Settings" label="Configuración" checked={active === 'settings'} onClick={() => { setUserOpen(false); onNav('settings'); }} />}
          <EcoMenuItem icon={mode === 'dark' ? 'Sun' : 'Moon'} label={mode === 'dark' ? 'Modo claro' : 'Modo oscuro'} onClick={() => { setUserOpen(false); setMode(mode === 'dark' ? 'light' : 'dark'); }} />
          <EcoMenuRule />
          <EcoMenuItem icon="LogOut" label="Cerrar sesión" onClick={() => { setUserOpen(false); if (window.ecoSignOut) window.ecoSignOut(); }} />
        </EcoMenu>
      )}
    </aside>
  );
}

// Un solo campo de búsqueda de menciones para toda la app. Antes el MISMO verbo
// tenía dos implementaciones visibles a la vez en /search (34px/12px/icono 14 en
// el header contra 48px/15px/icono 18 en el hero) con placeholders distintos, así
// que nada decía cuál buscaba qué. Los dos tamaños salen de tokens: 'sm' es un
// control de barra (hereda --control-h de `.input`), 'lg' es el campo
// protagonista de la pantalla de búsqueda. `trailing` recibe el adorno de la
// derecha (⌘K en el header, limpiar en el hero) y `trailingWidth` reserva su
// espacio para que el texto no pase por debajo.
const SEARCH_PLACEHOLDER = 'Buscar menciones, autor o URL…';
function SearchField({ size = 'sm', value, onChange, onKeyDown, placeholder = SEARCH_PLACEHOLDER, title, ariaLabel, inputRef, trailing, trailingWidth }) {
  const lg = size === 'lg';
  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <span style={{ position: 'absolute', left: lg ? 14 : 11, top: '50%', transform: 'translateY(-50%)', display: 'flex', color: 'var(--text-3)', pointerEvents: 'none' }}>
        <Icons.Search size={lg ? 18 : 14} />
      </span>
      <input
        ref={inputRef}
        className="input"
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        title={title}
        aria-label={ariaLabel || placeholder}
        style={{
          width: '100%',
          // 'sm' no fija altura: la hereda de `.input` (--control-h) para no
          // volver a tener un campo de 34 al lado de botones de 32.
          height: lg ? 48 : undefined,
          paddingLeft: lg ? 42 : 32,
          paddingRight: trailingWidth || (lg ? 14 : 12),
          fontSize: lg ? 'var(--fs-body-lg)' : 'var(--fs-body-sm)',
        }}
      />
      {trailing}
    </div>
  );
}

// Período del header (H1, sep-2026). Los cuatro más usados van a la vista en un
// segmentado; el resto y el rango personalizado viven en «Más». Antes eran 8
// chips + «Fechas» = 9 controles para UNA decisión. Los nombres largos dicen
// lo que el código abreviado no: la ventana termina AYER (día cerrado AST), así
// que '1D' es «Ayer», no «Hoy».
const PERIOD_QUICK = ['7D', '30D', '3M', '1A'];
const PERIOD_OPTIONS = [
  ['1D', 'Ayer'], ['5D', 'Últimos 5 días'], ['7D', 'Últimos 7 días'], ['30D', 'Últimos 30 días'],
  ['3M', 'Últimos 3 meses'], ['6M', 'Últimos 6 meses'], ['1A', 'Último año'], ['Max', 'Máximo (2 años)'],
];
const ECO_MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
// «21 – 27 sep 2026» / «28 ago – 27 sep 2026» / «27 sep 2025 – 27 sep 2026».
// Días AST en YYYY-MM-DD, sin pasar por Date para no correr el día por TZ.
function ecoFmtRange(from, to) {
  if (!from || !to) return '';
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  if (from === to) return `${td} ${ECO_MONTHS[tm - 1]} ${ty}`;
  if (fy === ty && fm === tm) return `${fd} – ${td} ${ECO_MONTHS[tm - 1]} ${ty}`;
  if (fy === ty) return `${fd} ${ECO_MONTHS[fm - 1]} – ${td} ${ECO_MONTHS[tm - 1]} ${ty}`;
  return `${fd} ${ECO_MONTHS[fm - 1]} ${fy} – ${td} ${ECO_MONTHS[tm - 1]} ${ty}`;
}

// showPeriod=false oculta el control de período y pinta una nota explicando la
// ausencia. Hoy NINGUNA pantalla lo usa (Narrativas recuperó las fechas en
// ago-2026); se conserva el prop para no reconstruir el mecanismo.
//
// Header H1 «Una fila» (sep-2026): título + la ventana REAL bajo él; período;
// buscar (abre ⌘K, que ya busca menciones y URL y navega); exportar; asistente.
// La agencia se fue al rail y el modo claro/oscuro al menú del usuario.
function Header({ title, period, setPeriod, agency, agencies, onOpenCommand, onOpenMenu, onOpenChat, showPeriod = true }) {
  const isCustom = period === 'custom';
  const [moreOpen, setMoreOpen] = React.useState(false);
  const [rangeOpen, setRangeOpen] = React.useState(false);
  const moreBtn = React.useRef(null);
  const lsFrom = (typeof localStorage !== 'undefined') ? (localStorage.getItem('eco.from') || '') : '';
  const lsTo = (typeof localStorage !== 'undefined') ? (localStorage.getItem('eco.to') || '') : '';
  const [draftFrom, setDraftFrom] = React.useState(lsFrom);
  const [draftTo, setDraftTo] = React.useState(lsTo);
  const todayIso = new Date().toISOString().slice(0, 10);
  const win = ecoResolvedWindow();
  const rangeLabel = win ? ecoFmtRange(win.from, win.to) : '';
  const current = (agencies || []).find((x) => x.key === agency);
  const inQuick = !isCustom && PERIOD_QUICK.includes(period);
  const moreLabel = isCustom
    ? 'Personalizado'
    : (!inQuick ? ((PERIOD_OPTIONS.find(([k]) => k === period) || [null, period])[1]) : 'Más');

  function choosePreset(p) {
    // Al pasar de un rango personalizado a un preset se limpian eco.from/eco.to
    // para que el siguiente boot no mande restos del rango anterior.
    try { localStorage.removeItem('eco.from'); localStorage.removeItem('eco.to'); } catch (_) {}
    setMoreOpen(false); setRangeOpen(false);
    setPeriod(p);
  }
  function applyCustomRange() {
    if (!draftFrom || !draftTo || draftFrom > draftTo) return;
    try {
      localStorage.setItem('eco.from', draftFrom);
      localStorage.setItem('eco.to', draftTo);
      localStorage.setItem('eco.period', 'custom');
    } catch (_) {}
    window.location.reload();
  }

  // URL del reporte exportable con los filtros VIGENTES (agencia, período y, si
  // es custom, from/to — lo que resolveWindow prioriza).
  const exportHref = React.useMemo(() => {
    const qs = new URLSearchParams();
    if (agency) qs.set('agency', agency);
    qs.set('period', period);
    if (isCustom && lsFrom && lsTo) { qs.set('from', lsFrom); qs.set('to', lsTo); }
    return `/api/export/report?${qs.toString()}`;
  }, [agency, period, isCustom, lsFrom, lsTo]);

  const invalidRange = !draftFrom || !draftTo || draftFrom > draftTo;

  return (
    <header className="eco-header" style={{
      position: 'sticky', top: 0, zIndex: 50,
      background: 'var(--canvas)', borderBottom: '1px solid var(--hairline)',
      minHeight: 72, boxSizing: 'border-box',
      padding: 'var(--sp-3) var(--gutter-page)',
      display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', flexWrap: 'wrap',
    }}>
      <button className="show-mobile" onClick={onOpenMenu} aria-label="Abrir menú"
        style={{
          alignItems: 'center', justifyContent: 'center', width: 40, height: 40, flex: 'none',
          borderRadius: 'var(--r-sm)', border: '1px solid var(--hairline-strong)',
          background: 'var(--control-bg)', color: 'var(--text)',
        }}>
        <Icons.Menu size={18} />
      </button>

      <div className="eco-header-title" style={{ flex: '1 1 220px', minWidth: 0 }}>
        <h1 style={{
          margin: 0, fontSize: 'var(--fs-display-lg)', fontWeight: 600,
          letterSpacing: 'var(--letter-display)', fontFamily: 'var(--ff-display)',
        }} className="truncate">{title}</h1>
        {/* La ventana real, no su código: «7D» obligaba a saber que termina
            ayer. Una agencia archivada lo dice aquí, junto a las fechas, o las
            cifras se leen como de hoy. */}
        <div style={{ marginTop: 'var(--sp-05)', fontSize: 'var(--fs-caption)', color: 'var(--text-3)', display: 'flex', gap: 'var(--sp-15)', flexWrap: 'wrap', alignItems: 'center' }}>
          {showPeriod && rangeLabel && <span className="mono" style={{ color: 'var(--text-2)' }}>{rangeLabel}</span>}
          {/* Solo los presets terminan ayer; un rango personalizado termina donde
              el usuario dijo, y ahí «al cierre de ayer» sería falso. */}
          {showPeriod && !isCustom && <span>· al cierre de ayer</span>}
          {showPeriod && isCustom && <span>· rango personalizado</span>}
          {!showPeriod && <span>Sin filtro de fechas · cada narrativa muestra su ciclo completo</span>}
          {current && current.archived && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-1)', color: 'var(--text)' }}>
              <Icons.Info size={12} color="var(--neg)" />Agencia archivada · solo histórico
            </span>
          )}
        </div>
      </div>

      {showPeriod && (
        <div className="eco-header-period" style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flex: 'none' }}>
          <div role="group" aria-label="Período" className="eco-seg">
            {PERIOD_QUICK.map((p) => {
              const on = !isCustom && period === p;
              return (
                <button key={p} onClick={() => choosePreset(p)} aria-pressed={on}
                  title={(PERIOD_OPTIONS.find(([k]) => k === p) || [])[1]}
                  className={on ? 'on' : ''}>{p}</button>
              );
            })}
          </div>
          <button ref={moreBtn} className={'btn eco-more' + (!inQuick ? ' on' : '')} onClick={() => { setMoreOpen(true); setRangeOpen(isCustom); }}
            aria-haspopup="menu" aria-expanded={moreOpen}
            title={isCustom && lsFrom && lsTo ? `Rango: ${lsFrom} → ${lsTo}` : 'Más períodos y rango personalizado'}>
            <Icons.Calendar size={14} />
            <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 600 }}>{moreLabel}</span>
            <Icons.ChevronDown size={12} color="var(--text-3)" />
          </button>
          {moreOpen && (
            <EcoMenu anchor={moreBtn} placement="below-end" width={rangeOpen ? 300 : 250} label="Período" onClose={() => setMoreOpen(false)}>
              {!rangeOpen && <>
                {PERIOD_OPTIONS.map(([k, l]) => (
                  <EcoMenuItem key={k} label={l} hint={k} checked={!isCustom && period === k} onClick={() => choosePreset(k)} />
                ))}
                <EcoMenuRule />
                <EcoMenuItem icon="Calendar" label="Rango personalizado…" checked={isCustom} onClick={() => setRangeOpen(true)} />
              </>}
              {rangeOpen && (
                <div style={{ padding: 'var(--sp-3)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
                  <div className="mono" style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Rango personalizado</div>
                  <label style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                    <span style={{ minWidth: 44 }}>Desde</span>
                    <input type="date" value={draftFrom} max={todayIso} onChange={(e) => setDraftFrom(e.target.value)} className="input" style={{ fontSize: 'var(--fs-caption)' }} />
                  </label>
                  <label style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                    <span style={{ minWidth: 44 }}>Hasta</span>
                    <input type="date" value={draftTo} max={todayIso} onChange={(e) => setDraftTo(e.target.value)} className="input" style={{ fontSize: 'var(--fs-caption)' }} />
                  </label>
                  {draftFrom && draftTo && draftFrom > draftTo && (
                    <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--neg)' }}>La fecha «Desde» debe ser anterior o igual a «Hasta».</div>
                  )}
                  <div style={{ display: 'flex', gap: 'var(--sp-15)', justifyContent: 'flex-end', marginTop: 'var(--sp-1)' }}>
                    <button className="btn" onClick={() => setRangeOpen(false)} style={{ fontSize: 'var(--fs-caption)' }}>Volver</button>
                    {isCustom && <button className="btn" onClick={() => choosePreset('7D')} style={{ fontSize: 'var(--fs-caption)' }} title="Limpiar rango y volver a 7D">Limpiar</button>}
                    <button className="btn btn-action" onClick={applyCustomRange} disabled={invalidRange}
                      style={{ fontSize: 'var(--fs-caption)', opacity: invalidRange ? 0.5 : 1 }}>Aplicar</button>
                  </div>
                </div>
              )}
            </EcoMenu>
          )}
        </div>
      )}

      <div className="hide-mobile" style={{ width: 1, height: 24, background: 'var(--hairline-strong)', flex: 'none' }} />

      {/* Acciones: contenedor propio con flex:none para que envuelvan JUNTAS. En
          móvil suben a la fila del título y el período baja entero (index.html). */}
      <div className="eco-header-actions" style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flex: 'none', marginLeft: 'auto' }}>
        {/* Buscar abre el comando rápido, que ya busca menciones, autores y URL
            («Ver todos los resultados» navega a /search). El campo de 460 px
            dominaba la fila para un verbo que ⌘K ya tenía. */}
        <button className="btn eco-search-btn" onClick={onOpenCommand} aria-label="Buscar (⌘K)" title="Buscar menciones, autores, URL o ir a… (⌘K)">
          <Icons.Search size={14} color="var(--text-3)" />
          <span className="hide-mobile" style={{ flex: 1, textAlign: 'left', color: 'var(--text-3)', fontSize: 'var(--fs-caption)' }}>Buscar</span>
          <span className="kbd hide-mobile">⌘K</span>
        </button>
        {/* Exportar: <a target=_blank> (nunca popup; ⌘-clic funciona). Gateado
            por `export`; el corte que manda está en /api/export/report. */}
        {ecoHasCap('export') && (
          <a className="btn" href={exportHref} target="_blank" rel="noopener"
            aria-label="Exportar reporte en PDF"
            title={`Exportar reporte analítico en PDF · ${isCustom && lsFrom && lsTo ? `${lsFrom} → ${lsTo}` : period}`}
            style={{ textDecoration: 'none' }}>
            <Icons.Download size={14} color="var(--text-2)" />
            <span className="hide-mobile" style={{ fontSize: 'var(--fs-caption)', fontWeight: 600 }}>Exportar</span>
          </a>
        )}
        {onOpenChat && (
          <button className="btn btn-action" onClick={onOpenChat} aria-label="Abrir asistente contextual" title="Asistente contextual (⌘⏎)">
            <Icons.Sparkles size={14} />
            <span className="hide-mobile" style={{ fontSize: 'var(--fs-caption)', fontWeight: 600 }}>Asistente</span>
          </button>
        )}
      </div>
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

  // Real, executable commands. La nav de análisis depende de la agencia
  // activa: con '__all__' (staff) ofrece las pantallas ejecutivas.
  const paletteAgency = (typeof localStorage !== 'undefined' && localStorage.getItem('eco.agency')) || '';
  const paletteNav = navForAgency(paletteAgency);
  const items = [
    // Navigation
    ...paletteNav.filter((n) => paletteAgency === '__all__' || ecoCanSeePage(n.key)).map((n) => ({ kind: 'Ir a', label: n.label, action: () => onNav(n.key), icon: n.icon })),
    ...SYSTEM_NAV.filter((n) => ecoCanSeePage(n.key)).map((n) => ({ kind: 'Ir a', label: n.label, action: () => onNav(n.key), icon: n.icon })),
    // Period (real)
    { kind: 'Período', label: 'Ayer (1D)', action: () => onSetPeriod('1D'), icon: 'Calendar' },
    { kind: 'Período', label: 'Últimos 5 días (5D)', action: () => onSetPeriod('5D'), icon: 'Calendar' },
    { kind: 'Período', label: 'Últimos 7 días cerrados (7D)', action: () => onSetPeriod('7D'), icon: 'Calendar' },
    { kind: 'Período', label: 'Últimos 30 días (30D)', action: () => onSetPeriod('30D'), icon: 'Calendar' },
    { kind: 'Período', label: 'Últimos 3 meses (3M)', action: () => onSetPeriod('3M'), icon: 'Calendar' },
    { kind: 'Período', label: 'Últimos 6 meses (6M)', action: () => onSetPeriod('6M'), icon: 'Calendar' },
    { kind: 'Período', label: 'Último año (1A)', action: () => onSetPeriod('1A'), icon: 'Calendar' },
    { kind: 'Período', label: 'Máximo · 2 años (Max)', action: () => onSetPeriod('Max'), icon: 'Calendar' },
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', padding: '16px 18px', borderBottom: '1px solid var(--hairline)' }}>
          <Icons.Search size={16} color="var(--text-3)" />
          <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar menciones, autor, URL o ir a…"
            style={{ flex: 1, border: 'none', outline: 'none', background: 'none', fontSize: 'var(--fs-title-md)', color: 'var(--text)' }} />
          <span className="kbd">esc</span>
        </div>
        <div style={{ maxHeight: 440, overflowY: 'auto', padding: 'var(--sp-2)' }}>
          {Object.entries(grouped).map(([kind, list]) => (
            <div key={kind} style={{ marginBottom: 'var(--sp-15)' }}>
              <div style={{ padding: '8px 12px 4px', fontSize: 'var(--fs-overline)', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>{kind}</div>
              {list.map((it, i) => {
                flatIdx++;
                const isSelected = flatIdx === selectedIdx;
                const I = Icons[it.icon] ?? Icons.ChevronRight;
                return (
                  <button key={`${kind}-${i}`} onClick={() => { it.action?.(); onClose(); }}
                    onMouseEnter={() => setSelectedIdx(flatIdx)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', width: '100%', padding: '9px 12px', borderRadius: 'var(--r-lg)', fontSize: 'var(--fs-body-sm)', color: 'var(--text)',
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
            <div style={{ padding: 'var(--sp-6)', textAlign: 'center', color: 'var(--text-3)', fontSize: 'var(--fs-body-sm)' }}>Sin resultados</div>
          )}
        </div>
        <div style={{ padding: '8px 14px', borderTop: '1px solid var(--hairline)', display: 'flex', gap: 'var(--sp-4)', fontSize: 'var(--fs-overline)', color: 'var(--text-3)' }}>
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
      // Ver la nota de PRMap en charts.js: Leaflet no resuelve custom properties,
      // así que el color se resuelve con ecoTokenValue() para que el modo claro
      // no herede los hex de oscuro.
      const T = (t) => window.ecoTokenValue(t);
      L.circleMarker(center, {
        radius: 9, color: T('var(--canvas)'), weight: 1.5,
        fillColor: T(window.ecoSentimentColor(sentiment)), fillOpacity: 0.85,
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
        color: 'var(--text-3)', fontSize: 'var(--fs-overline)', fontStyle: 'italic',
        background: 'var(--canvas-2)',
      }}>Cargando mapa…</div>
    );
  }

  return (
    <div style={{ position: 'relative', height: 140 }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
      <div style={{
        position: 'absolute', top: 6, left: 8, zIndex: 400,
        fontSize: 'var(--fs-overline)', color: 'var(--text-3)', textTransform: 'uppercase',
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
        <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--hairline)', display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
          <div className="section-eyebrow" style={{ margin: 0, flex: 1 }}>Mención · {mention.publishedAt}</div>
          <button aria-label="Cerrar" className="btn" onClick={onClose}><Icons.Close size={14} /></button>
        </div>
        <div style={{ padding: 'var(--sp-6)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-3)', fontSize: 'var(--fs-caption)', color: 'var(--text-2)' }}>
              <span className={`pill ${sentClass}`}>{mention.sentiment}</span>
              <span style={{ marginLeft: 'auto', color: 'var(--text-3)' }}>{mention.domain}</span>
            </div>
            {mention.image && (
              <img src={mention.image} alt="" loading="lazy"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                style={{ width: '100%', maxHeight: 220, objectFit: 'cover', borderRadius: 'var(--r-lg)', margin: '2px 0 12px', background: 'var(--canvas-2)' }} />
            )}
            <h2 style={{ margin: '4px 0 8px', fontSize: 'var(--fs-display-md)', fontWeight: 600, fontFamily: 'var(--ff-display)', lineHeight: 1.3 }}>
              {mention.title}
            </h2>
            <div style={{ color: 'var(--text-2)', fontSize: 'var(--fs-body-sm)', lineHeight: 1.6 }}>
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
                <div className="section-eyebrow" style={{ marginBottom: 'var(--sp-3)' }}>Métricas</div>
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 'var(--sp-3)' }}>
                  {metrics.map((m) => (
                    <div key={m.label} style={{ padding: '12px', background: 'var(--canvas-2)', borderRadius: 'var(--r-lg)', border: '1px solid var(--hairline)' }}>
                      <div style={{ fontSize: 'var(--fs-overline)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>{m.label}</div>
                      <div className="num" style={{ fontSize: 'var(--fs-title-lg)', fontWeight: 700, marginTop: 'var(--sp-1)' }}>{m.v.toLocaleString('es-PR')}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {mention.summary ? (
            <div>
              <div className="section-eyebrow" style={{ marginBottom: 'var(--sp-3)' }}>Resumen IA</div>
              <div style={{ padding: 'var(--sp-4)', background: 'var(--accent-fill)', border: '1px solid var(--hairline)', borderRadius: 'var(--r-lg)', fontSize: 'var(--fs-body-sm)', lineHeight: 1.55, color: 'var(--text)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-15)', marginBottom: 'var(--sp-15)', fontSize: 'var(--fs-overline)', color: 'var(--accent)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                  <Icons.Sparkles size={12} /> Generado con IA
                </div>
                {mention.summary}
              </div>
            </div>
          ) : null}

          {mention.snippet && (mention.snippet.trim() !== (mention.title || '').trim()) ? (
            <div>
              <div className="section-eyebrow" style={{ marginBottom: 'var(--sp-3)' }}>Contenido</div>
              <div style={{ padding: 'var(--sp-4)', background: 'var(--canvas-2)', border: '1px solid var(--hairline)', borderRadius: 'var(--r-lg)', fontSize: 'var(--fs-body-sm)', lineHeight: 1.55, color: 'var(--text-2)', whiteSpace: 'pre-wrap' }}>
                {mention.snippet}
              </div>
            </div>
          ) : null}

          {mention.emotions?.length > 0 && (
            <div>
              <div className="section-eyebrow" style={{ marginBottom: 'var(--sp-3)' }}>Emociones detectadas</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-15)' }}>
                {mention.emotions.map((e) => <span key={e} className="pill pill-neu" style={{ textTransform: 'capitalize' }}>{e}</span>)}
              </div>
            </div>
          )}

          {/* Tópicos y subtópicos detectados */}
          {mention.topicName && (
            <div>
              <div className="section-eyebrow" style={{ marginBottom: 'var(--sp-3)' }}>Tópicos y subtópicos detectados</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
                <div style={{
                  padding: '10px 12px', border: '1px solid var(--hairline)', borderRadius: 'var(--r-lg)',
                  background: 'var(--canvas-2)', display: 'flex', alignItems: 'center', gap: 'var(--sp-3)',
                }}>
                  <div style={{ width: 28, height: 28, borderRadius: 'var(--r-lg)', background: 'var(--accent-fill)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icons.Hash size={13} color="var(--accent)" />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 'var(--fs-overline)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>Tópico principal</div>
                    <div style={{ fontSize: 'var(--fs-body)', fontWeight: 600, color: 'var(--text)' }}>{mention.topicName}</div>
                  </div>
                  <div className="mono" style={{ fontSize: 'var(--fs-overline)', color: 'var(--text-3)' }}>{typeof mention.topicConfidence === 'number' ? `confianza ${Math.round(mention.topicConfidence * 100)}%` : 'confianza —'}</div>
                </div>
                {mention.subtopics?.length > 0 && (
                  <div>
                    <div style={{ fontSize: 'var(--fs-overline)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, marginBottom: 'var(--sp-15)' }}>Subtópicos</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-15)' }}>
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
              <div className="section-eyebrow" style={{ marginBottom: 'var(--sp-3)' }}>Geografía detectada</div>
              <div style={{
                border: '1px solid var(--hairline)', borderRadius: 'var(--r-lg)', overflow: 'hidden',
                background: 'var(--canvas-2)',
              }}>
                <MiniMunicipalityMap
                  municipality={mention.municipality}
                  region={mention.region}
                  coords={mention.coords}
                  sentiment={mention.sentiment}
                />
                <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', borderTop: '1px solid var(--hairline)' }}>
                  <Icons.MapPin size={14} color="var(--neg)" />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 'var(--fs-body)', fontWeight: 600, color: 'var(--text)' }}>{mention.municipality}</div>
                    <div className="mono" style={{ fontSize: 'var(--fs-overline)', color: 'var(--text-3)' }}>
                      {Array.isArray(mention.coords) && typeof mention.coords[0] === 'number' && typeof mention.coords[1] === 'number'
                        ? `${mention.coords[0].toFixed(4)}°N, ${Math.abs(mention.coords[1]).toFixed(4)}°O · Región ${mention.region}`
                        : `Región ${mention.region || 'PR'}`}
                    </div>
                  </div>
                  <button className="btn"
                    style={{ fontSize: 'var(--fs-overline)' }}
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
            <div className="section-eyebrow" style={{ marginBottom: 'var(--sp-3)' }}>Relacionadas</div>
            {related === null && (
              <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)' }}>Cargando menciones similares…</div>
            )}
            {related && related.length === 0 && (
              <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-3)' }}>Sin menciones similares en el período.</div>
            )}
            {related && related.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-15)' }}>
                {related.map((r) => {
                  const sc = r.sentiment === 'positivo' ? 'pill-pos' : r.sentiment === 'negativo' ? 'pill-neg' : 'pill-neu';
                  return (
                    <button key={r.id}
                      onClick={() => onMentionClick && onMentionClick(r)}
                      style={{
                        textAlign: 'left', background: 'var(--canvas-2)', border: '1px solid var(--hairline)',
                        borderRadius: 'var(--r-lg)', padding: '10px 12px', cursor: 'pointer', display: 'flex',
                        flexDirection: 'column', gap: 'var(--sp-1)',
                      }}>
                      <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
                        <span className={`pill ${sc}`} style={{ fontSize: 'var(--fs-overline)' }}>{r.sentiment}</span>
                        <span style={{ fontSize: 'var(--fs-overline)', color: 'var(--text-3)' }}>{r.publishedAt}</span>
                      </div>
                      <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.title}
                      </div>
                      <div style={{ fontSize: 'var(--fs-overline)', color: 'var(--text-3)' }}>{r.domain}</div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
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

function TweaksPanel({ mode, setMode, density, setDensity, onClose }) {

  // Cerrar con Escape (mismo patrón que CommandPalette).
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  // El selector de temas se retiró con costa y gaceta (WS-F5): `mando` es el
  // único tema y app.js no expone setTheme. El panel conserva modo y densidad.
  return (
    <div className="tweaks-panel">
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--hairline)', display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
        <Icons.Palette size={14} color="var(--accent)" />
        <div style={{ fontSize: 'var(--fs-body-sm)', fontWeight: 600, flex: 1 }}>Tweaks</div>
        <button aria-label="Cerrar" onClick={onClose}><Icons.Close size={14} color="var(--text-3)" /></button>
      </div>
      <div style={{ padding: 'var(--sp-4)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
        <div>
          <div style={{ fontSize: 'var(--fs-overline)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-3)', marginBottom: 'var(--sp-2)' }}>Modo</div>
          <div style={{ display: 'flex', gap: 'var(--sp-15)' }}>
            {['light', 'dark'].map((m) => (
              <button key={m} onClick={() => setMode(m)}
                style={{
                  flex: 1, padding: '8px 12px', borderRadius: 'var(--r-lg)',
                  border: `1px solid ${mode === m ? 'var(--accent)' : 'var(--hairline)'}`,
                  background: mode === m ? 'var(--accent-fill)' : 'var(--canvas)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--sp-15)',
                  fontSize: 'var(--fs-caption)', fontWeight: 500, color: mode === m ? 'var(--accent)' : 'var(--text-2)',
                }}>
                {m === 'light' ? <Icons.Sun size={13} /> : <Icons.Moon size={13} />}
                {m === 'light' ? 'Claro' : 'Oscuro'}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--fs-overline)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-3)', marginBottom: 'var(--sp-2)' }}>Densidad</div>
          <div style={{ display: 'flex', gap: 'var(--sp-15)' }}>
            {['comfy', 'normal', 'compact'].map((d) => (
              <button key={d} onClick={() => setDensity(d)}
                style={{
                  flex: 1, padding: '8px 4px', borderRadius: 'var(--r-lg)',
                  border: `1px solid ${density === d ? 'var(--accent)' : 'var(--hairline)'}`,
                  background: density === d ? 'var(--accent-fill)' : 'var(--canvas)',
                  fontSize: 'var(--fs-overline)', fontWeight: 500, color: density === d ? 'var(--accent)' : 'var(--text-2)',
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
// EmptyState — la primitiva de "aquí no hay nada" (WS-F8).
//
// Había 22 bloques escritos a mano con tres tamaños de letra, cuatro colores y
// vocabulario incompatible: "Sin datos", "Sin resultados", "Sin datos para esta
// dimensión en el periodo.", "Aún sin datos (requiere ≥24h)", "No hay menciones
// de este tópico...". El panel de Narrativas llegaba a mostrar SEIS cajas que
// decían "Sin datos" a la vez.
//
// El problema no era la repetición: era que un vacío no dice lo mismo según POR
// QUÉ está vacío, y esas 22 copias no distinguían los casos. Esta primitiva
// obliga a elegir:
//
//   · `reason="empty"`   — la consulta corrió y no hay nada. Es un HECHO.
//   · `reason="filtered"` — hay datos, pero los filtros los excluyen. Es
//     accionable: se ofrece la salida.
//   · `reason="pending"`  — todavía no se puede saber (una ventana que necesita
//     24h, un cómputo que no ha corrido). NO es un cero.
//   · `reason="error"`    — falló la consulta. Nunca se debe pintar como vacío,
//     que es lo que hacía UsersAdmin ("no hay usuarios · ajusta los filtros"
//     cuando la API devolvía 500).
function EmptyState({ reason = 'empty', title, detail, action, actionLabel, compact, size }) {
  // Tres tamaños porque hay tres situaciones distintas, no por gusto: `compact`
  // es un hueco dentro de una card apretada, el default es un hueco normal y
  // `size="lg"` es el vacío que OCUPA la pantalla (p.ej. /search sin criterio),
  // donde el título y la prosa son el contenido principal y no una nota al pie.
  const lg = size === 'lg';
  const R = {
    empty:    { icon: 'Circle',        tone: 'var(--text-3)' },
    filtered: { icon: 'Filter',        tone: 'var(--text-2)' },
    pending:  { icon: 'Calendar',      tone: 'var(--text-3)' },
    error:    { icon: 'AlertTriangle', tone: 'var(--neg)' },
  }[reason] || { icon: 'Inbox', tone: 'var(--text-3)' };
  const IC = Icons[R.icon] || Icons.Info;
  const defaults = {
    empty: 'Sin datos en este período',
    filtered: 'Nada coincide con estos filtros',
    pending: 'Todavía no hay suficiente historia',
    error: 'No se pudo cargar',
  };
  return (
    <div role={reason === 'error' ? 'alert' : undefined}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', textAlign: 'center', gap: 'var(--sp-2)',
        padding: compact ? 'var(--sp-4)' : 'var(--sp-8) var(--sp-4)',
        minHeight: compact ? 0 : 120,
      }}>
      {IC && <IC size={compact ? 16 : (lg ? 28 : 20)} color={R.tone} />}
      <div style={{
        fontFamily: 'var(--ff-sans)',
        // En lg el título sube a --fs-title-lg (17): a --fs-title-md empataba con
        // el placeholder del buscador, así que el elemento tipográficamente más
        // grande de la pantalla era un placeholder y no un título.
        fontSize: compact ? 'var(--fs-body-sm)' : (lg ? 'var(--fs-title-lg)' : 'var(--fs-body)'),
        fontWeight: 500,
        color: reason === 'error' ? 'var(--neg)' : (lg ? 'var(--text)' : 'var(--text-2)'),
      }}>{title || defaults[reason]}</div>
      {detail && (
        // El detalle de un vacío protagonista es PROSA de 3-4 líneas: en
        // --fs-caption/--text-3 quedaba en el piso de la escala, que tokens.css
        // reserva a metadatos y ticks de eje. En lg va a --fs-body sobre --text-2.
        <div style={{ fontSize: lg ? 'var(--fs-body)' : 'var(--fs-caption)', color: lg ? 'var(--text-2)' : 'var(--text-3)', maxWidth: lg ? '46ch' : '42ch', lineHeight: 1.5 }}>
          {detail}
        </div>
      )}
      {action && actionLabel && (
        <button className="btn" style={{ marginTop: 'var(--sp-1)' }} onClick={action}>{actionLabel}</button>
      )}
    </div>
  );
}

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
  // el conteo coincide con el row del Overview/Scorecard/TopicsScreen. Las
  // cards cuyo número de origen es multi-clasificación (p.ej. el calendario
  // de tópicos) pasan `_filter.topicMode: 'all'` para que el modal abra en la
  // MISMA base de conteo. El toggle sigue disponible en ambos casos.
  const hasTopicFilter = !!(slice && slice._filter && slice._filter.topic);
  const initialTopicMode = (slice && slice._filter && slice._filter.topicMode) || 'primary';
  const [topicMode, setTopicMode] = React.useState(initialTopicMode);
  // Toggle de universo: por default el modal cuenta menciones PERTINENTES
  // (sin 'baja'), igual que todas las cards. El toggle permite auditar el
  // universo completo a un click sin tocar los agregados (decisión D2,
  // auditoría 2026-08). Oculto cuando la card fija pertinencia explícita
  // (p. ej. el drill de crisis con pertinence=alta).
  const initialIncludeLow = !!(slice && slice._filter && slice._filter.includeLow === '1');
  const [includeLow, setIncludeLow] = React.useState(initialIncludeLow);
  // Reset cuando cambia el slice (otro tópico, otro filtro).
  React.useEffect(() => { setTopicMode(initialTopicMode); setIncludeLow(initialIncludeLow); }, [slice]); // eslint-disable-line react-hooks/exhaustive-deps

  // If a slice carries a structured filter, fetch real matching mentions from
  // /api/eco-mentions and replace the placeholder list + counts. The slice
  // object is immutable; we merge the fetched fields into `liveSlice`.
  React.useEffect(() => {
    if (!slice || !slice._filter) { setLiveSlice(null); return; }
    setLoading(true);
    const filter = { ...slice._filter };
    // topicMode viaja siempre que haya filtro de tópico; refleja el estado
    // del toggle (inicializado con el modo de la card de origen).
    if (filter.topic) filter.topicMode = topicMode;
    // Universo según el toggle (salvo pertinencia explícita de la card).
    if (!filter.pertinence) {
      if (includeLow) filter.includeLow = '1';
      else delete filter.includeLow;
    }
    // Ventana SIEMPRE explícita: la de la card de origen (filter.from/to) o,
    // si la card no la trae, la ventana cerrada global. Nunca dejamos que
    // /api/eco-mentions derive su rolling window del `period` — era la causa
    // #1 de "el número de la modal no cuadra con la card" (auditoría 2026-08).
    // Con `day` presente el endpoint acota a ese día y los bordes from/to
    // sobran, pero enviarlos es inocuo.
    if (!filter.from || !filter.to) {
      const w = ecoResolvedWindow();
      if (w) { filter.from = w.from; filter.to = w.to; }
    }
    fetch('/api/eco-mentions?' + new URLSearchParams(Object.fromEntries(
      Object.entries({
        agency: localStorage.getItem('eco.agency') || '',
        limit: '20',
        ...filter,
      }).filter(([, v]) => v != null && v !== '')
    )).toString(), { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : { mentions: [], total: 0, sentiment: { pos: 0, neu: 0, neg: 0 } })
      .then((j) => setLiveSlice(j))
      .catch(() => setLiveSlice({ mentions: [], total: 0, sentiment: { pos: 0, neu: 0, neg: 0 } }))
      .finally(() => setLoading(false));
  }, [slice, topicMode, includeLow]);

  if (!slice) return null;
  const { eyebrow, title, highlight, accent = 'var(--accent)', ctaLabel, ctaIcon, onCta, insightText, subcomponents, headlineValue } = slice;
  // El botón "Crear alerta" del pie escribe con POST /api/alerts, que exige la
  // capacidad manage_alert_rules (admin/editor). Sin este gate un analyst o un
  // viewer veían el botón, escribían el nombre en el prompt y se comían un 403:
  // mismo criterio que ya aplican "Nueva regla" y la pestaña de crisis en
  // screens.js. ecoHasCap devuelve true mientras la sesión no ha cargado, para
  // no hacer parpadear el botón en cada apertura del drill-down.
  const canCreateAlert = ecoHasCap('manage_alert_rules');
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
        borderRadius: 'var(--r-xl)', boxShadow: '0 24px 60px rgba(0,0,0,0.28)',
        zIndex: 2001,
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{
          padding: '20px 24px',
          borderBottom: '1px solid var(--hairline)',
          borderTop: `3px solid ${accent}`,
          display: 'flex', alignItems: 'flex-start', gap: 'var(--sp-4)',
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {eyebrow && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', fontSize: 'var(--fs-overline)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: 'var(--sp-15)' }}>
                <span>{eyebrow}</span>
              </div>
            )}
            <div style={{ fontSize: 'var(--fs-display-lg)', fontWeight: 600, fontFamily: 'var(--ff-display)', letterSpacing: 'var(--letter-display)', lineHeight: 1.25, color: 'var(--text)' }}>
              <span>{title}</span>
              {highlight && <> · <span style={{ color: accent }}>{highlight}</span></>}
            </div>
            {volume != null && (
              <div style={{ marginTop: 'var(--sp-15)', fontSize: 'var(--fs-body-sm)', color: 'var(--text-2)' }}>
                <span className="num" style={{ color: 'var(--text)', fontWeight: 600, fontSize: 'var(--fs-body)' }}>{volume.toLocaleString('es-PR')}</span> menciones
              </div>
            )}
            {slice._filter && (() => {
              // Ventana y universo REALES de la consulta de este modal,
              // visibles para que el número sea auditable contra la card de
              // origen (auditoría consistencia 2026-08: antes el modal usaba
              // una ventana rolling implícita distinta a la de toda card).
              const f = slice._filter;
              const w = f.day ? { from: f.day, to: f.day }
                : (f.from && f.to) ? { from: f.from, to: f.to }
                : ecoResolvedWindow();
              if (!w) return null;
              const fmtYmd = (ymd) => {
                const [y, m, d] = String(ymd).split('-').map(Number);
                if (!y || !m || !d) return ymd;
                return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
              };
              const range = w.from === w.to ? fmtYmd(w.from) : `${fmtYmd(w.from)} – ${fmtYmd(w.to)}`;
              // El universo refleja el TOGGLE (estado vivo de la consulta),
              // no solo el _filter inicial de la card.
              const universo = f.pertinence ? `pertinencia ${f.pertinence}`
                : (includeLow ? 'todas las pertinencias' : 'sin pertinencia baja');
              return (
                <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span>{range} · {universo}</span>
                  {!f.pertinence && (
                    <button
                      className="chip"
                      onClick={() => setIncludeLow((v) => !v)}
                      title="Cambia el universo de esta consulta; los agregados del dashboard no cambian"
                      style={{ fontSize: 10, padding: '2px 8px' }}
                    >
                      {includeLow ? '— Solo pertinentes' : '+ Incluir baja pertinencia'}
                    </button>
                  )}
                </div>
              );
            })()}
            {(pos || neu || neg) && (
              <div style={{ marginTop: 'var(--sp-2)', display: 'flex', gap: 'var(--sp-4)', fontSize: 'var(--fs-overline)', color: 'var(--text-2)', flexWrap: 'wrap' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-15)' }}>
                  <span className="dot" style={{ background: 'var(--pos)' }} />
                  <span className="num" style={{ fontWeight: 600, color: 'var(--text)' }}>{pos.toLocaleString('es-PR')}</span> positivas
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-15)' }}>
                  <span className="dot" style={{ background: 'var(--text-3)' }} />
                  <span className="num" style={{ fontWeight: 600, color: 'var(--text)' }}>{neu.toLocaleString('es-PR')}</span> neutrales
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-15)' }}>
                  <span className="dot" style={{ background: 'var(--neg)' }} />
                  <span className="num" style={{ fontWeight: 600, color: 'var(--text)' }}>{neg.toLocaleString('es-PR')}</span> negativas
                </span>
              </div>
            )}
            {hasTopicFilter && (
              <div style={{ marginTop: 'var(--sp-3)', display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', fontSize: 'var(--fs-overline)', color: 'var(--text-2)' }}>
                <span style={{ color: 'var(--text-3)' }}>
                  {topicMode === 'primary'
                    ? 'Mostrando solo menciones donde este tópico es el principal'
                    : 'Mostrando todas las menciones que tocan este tópico (principal + secundario)'}
                </span>
                <button
                  className="chip"
                  onClick={() => setTopicMode((m) => (m === 'primary' ? 'all' : 'primary'))}
                  style={{ fontSize: 'var(--fs-overline)', padding: '3px 8px' }}
                >
                  {topicMode === 'primary' ? '+ Incluir secundarias' : '— Solo principales'}
                </button>
              </div>
            )}
          </div>
          <button aria-label="Cerrar" className="btn" onClick={onClose}><Icons.Close size={14} /></button>
        </div>

        <div style={{ padding: 'var(--sp-6)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>
          {/* Insight LLM (cuando el slice viene de un click en una métrica
              sintética como Crisis, NSS, BHI). Va arriba del histogram +
              mentions; explica el porqué del número para esta agencia. */}
          {(insightText || headlineValue != null) && (
            <div className="card" style={{
              padding: 'var(--sp-4)', background: 'var(--canvas-2)', border: '1px solid var(--hairline)',
              display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)',
            }}>
              {headlineValue != null && (
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--sp-3)' }}>
                  <div className="num" style={{ fontSize: 'var(--fs-num-xl)', fontWeight: 600, color: accent, fontFamily: 'var(--ff-display)', lineHeight: 1 }}>
                    {headlineValue}
                  </div>
                  {slice.headlineLabel && (
                    <div style={{ fontSize: 'var(--fs-overline)', color: 'var(--text-2)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                      {slice.headlineLabel}
                    </div>
                  )}
                </div>
              )}
              {insightText && insightText !== '__loading__' && (
                <div style={{ fontSize: 'var(--fs-body-sm)', color: 'var(--text)', lineHeight: 1.55 }}
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-15)', marginTop: 'var(--sp-1)' }}>
                  <div className="section-eyebrow" style={{ marginBottom: 'var(--sp-1)' }}>Componentes</div>
                  {subcomponents.map((sc, i) => {
                    const pct = Math.max(0, Math.min(100, Number(sc.value) || 0));
                    return (
                      <div key={i} style={{ display: 'grid', gridTemplateColumns: '140px 1fr 60px', gap: 'var(--sp-3)', alignItems: 'center', fontSize: 'var(--fs-overline)' }}>
                        <span style={{ color: 'var(--text-2)' }}>{sc.label}</span>
                        <div style={{ height: 6, borderRadius: 'var(--r-sm)', background: 'var(--canvas)', overflow: 'hidden', border: '1px solid var(--hairline)' }}>
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
                <div className="section-eyebrow" style={{ marginBottom: 'var(--sp-2)' }}>{histogram.label || 'Distribución'}</div>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${histogram.values.length}, 1fr)`,
                  gap: 'var(--sp-05)',
                  height: 80, alignItems: 'end',
                  padding: '8px 10px',
                  background: 'var(--canvas-2)',
                  border: '1px solid var(--hairline)',
                  borderRadius: 'var(--r-md)',
                }}>
                  {histogram.values.map((v, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'flex-end', height: '100%' }} title={`${xLabels[i] ?? i} — ${v}`}>
                      <div style={{ width: '100%', height: `${(v / maxH) * 100}%`, background: accent, opacity: 0.85, borderRadius: '2px 2px 0 0', minHeight: 2 }} />
                    </div>
                  ))}
                </div>
                {xLabels.length > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--sp-1)', fontSize: 'var(--fs-overline)', color: 'var(--text-3)', fontFamily: 'var(--ff-numeric)', padding: '0 2px' }}>
                    {[0, Math.floor(xLabels.length/4), Math.floor(xLabels.length/2), Math.floor(3*xLabels.length/4), xLabels.length-1].map((idx, i) => (
                      <span key={i}>{xLabels[idx]}</span>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 'var(--sp-3)' }}>
              <div className="section-eyebrow" style={{ margin: 0 }}>Menciones destacadas</div>
              <span style={{ fontSize: 'var(--fs-overline)', color: 'var(--text-3)', fontFamily: 'var(--ff-numeric)' }}>
                {loading ? 'Cargando…' : `mostrando ${mentions.length}${volume ? ` de ${volume.toLocaleString('es-PR')}` : ''}`}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-15)' }}>
              {mentions.map(mn => {
                const sourceIcon = { facebook: 'Facebook', twitter: 'Twitter', news: 'Newspaper', instagram: 'Instagram', youtube: 'Youtube' }[mn.source] || 'Globe';
                const SIcon = Icons[sourceIcon];
                const sc = mn.sentiment === 'positivo' ? 'pill-pos' : mn.sentiment === 'negativo' ? 'pill-neg' : mn.sentiment === 'neutral' ? 'pill-neu' : 'pill-unknown';
                return (
                  <div key={mn.id} className="row-hover"
                    onClick={() => onMentionClick && onMentionClick(mn)}
                    style={{
                      display: 'grid', gridTemplateColumns: '20px 1fr 90px 120px 120px',
                      gap: 'var(--sp-3)', alignItems: 'center',
                      padding: '10px 12px',
                      border: '1px solid var(--hairline)',
                      borderRadius: 'var(--r-md)',
                      fontSize: 'var(--fs-caption)',
                      cursor: 'pointer',
                    }}>
                    <SIcon size={14} color="var(--text-3)" />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ color: 'var(--text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{mn.title}</div>
                      <div style={{ color: 'var(--text-3)', fontSize: 'var(--fs-overline)' }}>{mn.author} · {mn.domain} · {mn.publishedAt}</div>
                    </div>
                    <span className={`pill ${sc}`} style={{ justifySelf: 'start' }}>{mn.sentiment}</span>
                    {/* Tópico (columna nueva — reemplazó engagement). Truncado a una línea. */}
                    <span style={{ color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 'var(--fs-overline)' }}>
                      {mn.topicName || '—'}
                    </span>
                    {/* Subtópico (columna nueva — reemplazó pertinencia). Muestra el
                        primer subtopic + indicador "+N" si hay más. */}
                    <span style={{ color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 'var(--fs-overline)' }}>
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

          {/* La fila de acciones solo existe si va a llevar algo: sin CTA y sin
              permiso de alertas quedaba como una franja vacía con su borde
              superior colgando del último subcomponente. */}
          {((ctaLabel && onCta) || canCreateAlert) && (
            <div style={{ display: 'flex', gap: 'var(--sp-2)', paddingTop: 8, borderTop: '1px solid var(--hairline)' }}>
              {ctaLabel && onCta && (() => {
                const CtaIcon = ctaIcon ? Icons[ctaIcon] : null;
                return (
                  <button className="btn btn-primary" onClick={onCta} style={{ flex: 1, justifyContent: 'center' }}>
                    {CtaIcon && <CtaIcon size={13} />} {ctaLabel}
                  </button>
                );
              })()}
              {/* El botón "Exportar" (CSV del slice) se retiró: la exportación es
                  ahora una sola acción de nivel de aplicación — el reporte
                  analítico en PDF del header, que responde a los filtros
                  vigentes. Tener dos exportaciones con alcance distinto (un CSV
                  de 50 filas aquí, un reporte completo allá) bajo la misma
                  palabra era el problema. */}
              {canCreateAlert && (
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
              )}
            </div>
          )}
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
    // Rango personalizado: mandar from/to explícitos (el endpoint ya los
    // acepta vía resolveWindow) e incluirlos en la clave del caché — antes
    // period='custom' devolvía 400 y, peor, cambiar el rango manteniendo
    // 'custom' servía el insight stale del rango anterior (auditoría
    // 2026-08, P0-7).
    const w = (period === 'custom' && window.ecoResolvedWindow) ? window.ecoResolvedWindow() : null;
    const winSuffix = w && w.from && w.to ? `.${w.from}.${w.to}` : '';
    const cacheKey = `eco.metricInsight.v3.${agency}.${metricKey}.${period}${winSuffix}`;
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) { setData(JSON.parse(cached)); return; }
    } catch (_) {}
    const ctrl = new AbortController();
    const params = new URLSearchParams({ metric: metricKey, period: period || '7D' });
    if (w && w.from && w.to) { params.set('from', w.from); params.set('to', w.to); }
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
        borderRadius: 'var(--r-xl)', boxShadow: '0 24px 60px rgba(0,0,0,0.28)',
        zIndex: 2001,
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{
          padding: '20px 24px',
          borderBottom: '1px solid var(--hairline)',
          borderTop: `3px solid ${accent}`,
          display: 'flex', alignItems: 'flex-start', gap: 'var(--sp-4)',
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', fontSize: 'var(--fs-overline)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: 'var(--sp-15)' }}>
              <span>Métrica · {period || '—'}</span>
              {data && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-1)', color: 'var(--accent)', background: 'var(--accent-fill)', padding: '2px 6px', borderRadius: 'var(--r-sm)' }}>
                  <Icons.Sparkles size={9} /> IA
                </span>
              )}
            </div>
            <div style={{ fontSize: 'var(--fs-display-lg)', fontWeight: 600, fontFamily: 'var(--ff-display)', letterSpacing: 'var(--letter-display)', lineHeight: 1.25, color: 'var(--text)' }}>
              {label}
            </div>
            <div style={{ marginTop: 'var(--sp-3)', display: 'flex', alignItems: 'baseline', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
              <div className="num" style={{ fontSize: 'var(--fs-num-xl)', fontWeight: 600, color: vd ? vd.color : 'var(--text)', fontFamily: 'var(--ff-display)', lineHeight: 1 }}>
                {vd ? vd.word : formatValue(displayValue)}
              </div>
              {vd && vd.value && (
                <div className="num" style={{ fontSize: 'var(--fs-body-sm)', color: 'var(--text-2)', fontWeight: 600 }}>{vd.value}</div>
              )}
              {!vd && displayBand && (
                <div style={{ fontSize: 'var(--fs-overline)', fontWeight: 700, color: bandColor(displayBand), letterSpacing: '0.06em' }}>
                  {displayBand}
                </div>
              )}
              {dd ? (
                dd.hasBaseline ? (
                  <div style={{ fontSize: 'var(--fs-overline)', fontWeight: 600, color: dd.direction === 'flat' ? 'var(--text-3)' : (dd.tone === 'pos' ? 'var(--pos)' : dd.tone === 'neg' ? 'var(--neg)' : 'var(--text-3)') }}>
                    {dd.direction === 'flat' ? `· ${dd.word}` : `${dd.arrow} ${dd.value}`}
                    <span style={{ color: 'var(--text-3)', fontWeight: 500 }}> vs período anterior</span>
                  </div>
                ) : (
                  <div style={{ fontSize: 'var(--fs-overline)', color: 'var(--text-3)', fontWeight: 500 }}>— sin base de comparación</div>
                )
              ) : (data && data.deltaVsPrev != null && (
                <div style={{ fontSize: 'var(--fs-overline)', color: 'var(--text-3)', fontWeight: 500 }}>
                  {data.deltaVsPrev > 0 ? '▲ +' : data.deltaVsPrev < 0 ? '▼ ' : '· '}
                  {Math.abs(data.deltaVsPrev)} vs ventana anterior
                </div>
              ))}
            </div>
          </div>
          <button aria-label="Cerrar" className="btn" onClick={onClose}><Icons.Close size={14} /></button>
        </div>

        <div style={{ padding: 'var(--sp-6)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>
          {/* Banda visual — patrón Overview crisis card. */}
          {cfg && displayValue != null && (
            <div>
              <div style={{ height: 8, borderRadius: 'var(--r-sm)', background: cfg.gradient, position: 'relative' }}>
                <div style={{ position: 'absolute', left: `${cfg.pct(displayValue)}%`, top: -4, width: 14, height: 14, borderRadius: '50%', background: 'var(--canvas)', border: `2px solid ${bandColor(displayBand)}`, transform: 'translateX(-50%)' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-overline)', color: 'var(--text-3)', marginTop: 'var(--sp-15)', fontFamily: 'var(--ff-mono)' }}>
                {cfg.labels.map((l) => <span key={l}>{l}</span>)}
              </div>
            </div>
          )}

          {/* Interpretación AI coloquial (issue #4). */}
          <div style={{
            padding: '14px 16px', background: 'var(--canvas-2)',
            border: '1px solid var(--hairline)', borderRadius: 'var(--r-lg)',
            fontSize: 'var(--fs-body-sm)', lineHeight: 1.5, color: 'var(--text)',
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
            <div className="section-eyebrow" style={{ marginBottom: 'var(--sp-2)' }}>Evolución diaria</div>
            {series.length === 0 && (
              <div style={{ padding: 'var(--sp-6)', textAlign: 'center', color: 'var(--text-3)', fontSize: 'var(--fs-caption)', background: 'var(--canvas-2)', borderRadius: 'var(--r-md)' }}>
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
              <div className="section-eyebrow" style={{ marginBottom: 'var(--sp-2)' }}>Tópicos contribuyentes</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-15)' }}>
                {data.topContributingTopics.map((t) => (
                  <div key={t.name} style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', fontSize: 'var(--fs-caption)' }}>
                    <span style={{ flex: 1, color: 'var(--text)' }}>{t.name}</span>
                    <span className="num" style={{ color: 'var(--text-3)', fontSize: 'var(--fs-overline)' }}>{Math.round(t.share * 100)}%</span>
                    <div style={{ width: 80, height: 4, background: 'var(--canvas-2)', borderRadius: 'var(--r-sm)', overflow: 'hidden' }}>
                      <div style={{ width: `${Math.min(t.share * 100, 100)}%`, height: '100%', background: accent }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Contexto histórico — P25/P75 90d. */}
          {data && data.historicalP25 != null && data.historicalP75 != null && (
            <div style={{ fontSize: 'var(--fs-overline)', color: 'var(--text-3)', fontStyle: 'italic' }}>
              Rango típico de los últimos 90 días: <strong className="num" style={{ color: 'var(--text-2)' }}>{formatValue(data.historicalP25)}</strong> a <strong className="num" style={{ color: 'var(--text-2)' }}>{formatValue(data.historicalP75)}</strong>.
            </div>
          )}
        </div>
      </div>
    </>
  );
}

window.ECO_SHELL = { EmptyState, Avatar, Sidebar, Header, CommandPalette, MentionDrawer, MentionsSliceModal, MetricInsightModal, TweaksPanel, NAV, SYSTEM_NAV };
