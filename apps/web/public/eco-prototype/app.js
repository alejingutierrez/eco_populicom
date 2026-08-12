// App root — production mount (no tweaks panel, fixed Mando theme)
const { useState, useEffect, useCallback } = React;
const { Sidebar, Header, CommandPalette, MentionDrawer } = window.ECO_SHELL;
// Responsive breakpoint hook (defined in shell.js, loaded earlier). Screens
// and the shell branch inline layouts on this since @media can't reach them.
const useBreakpoint = window.ecoUseBreakpoint || (() => 'desktop');
const ChatDrawer = (window.ECO_CHAT && window.ECO_CHAT.ChatDrawer) || (() => null);
const { OverviewScreen, DashboardScreen, MentionsScreen, SearchScreen, SentimentScreen, TopicsScreen, GeographyScreen, AlertsScreen, SettingsScreen, NarrativeScreen, TablaScreen, SalaScreen, RadarScreen } = window.ECO_SCREENS;

// Toast system — replaces browser alert()/confirm() for ephemeral messages.
// Shared state stored on window and observed by the React <ToastHost>.
(function initToastBus() {
  if (window.ecoToast) return;
  const listeners = new Set();
  let nextId = 1;
  window.ecoToast = function (kind, text, opts) {
    const toast = { id: nextId++, kind: kind || 'info', text: String(text || ''), ttl: (opts && opts.ttl) || 3600 };
    listeners.forEach((fn) => fn({ type: 'add', toast }));
    setTimeout(() => {
      listeners.forEach((fn) => fn({ type: 'remove', id: toast.id }));
    }, toast.ttl);
    return toast.id;
  };
  window.ecoConfirm = function (text) {
    return new Promise((resolve) => {
      const id = nextId++;
      const toast = { id, kind: 'confirm', text, onChoice: (v) => resolve(v) };
      listeners.forEach((fn) => fn({ type: 'add', toast }));
    });
  };
  window.__ecoToastBus = { listeners, remove: (id) => listeners.forEach((fn) => fn({ type: 'remove', id })) };
})();

function ToastHost() {
  const [toasts, setToasts] = useState([]);
  useEffect(() => {
    const fn = (evt) => {
      if (evt.type === 'add') setToasts((ts) => [...ts, evt.toast]);
      else if (evt.type === 'remove') setToasts((ts) => ts.filter((t) => t.id !== evt.id));
    };
    window.__ecoToastBus.listeners.add(fn);
    return () => window.__ecoToastBus.listeners.delete(fn);
  }, []);
  const close = (id) => window.__ecoToastBus.remove(id);
  if (toasts.length === 0) return null;
  return (
    <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 2500, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {toasts.map((t) => {
        const base = {
          padding: '10px 16px', borderRadius: 8, border: '1px solid var(--hairline)',
          boxShadow: '0 10px 30px rgba(0,0,0,0.25)', fontSize: 12, fontWeight: 600,
          display: 'flex', alignItems: 'center', gap: 10, minWidth: 240, maxWidth: 420,
        };
        const palette = t.kind === 'err' ? { bg: 'var(--neg-bg)', fg: 'var(--neg)' }
          : t.kind === 'ok' ? { bg: 'var(--pos-bg)', fg: 'var(--pos)' }
          : t.kind === 'warn' ? { bg: 'var(--warn-bg)', fg: 'var(--warn)' }
          : t.kind === 'confirm' ? { bg: 'var(--canvas)', fg: 'var(--text)' }
          : { bg: 'var(--canvas-2)', fg: 'var(--text)' };
        return (
          <div key={t.id} style={{ ...base, background: palette.bg, color: palette.fg }}>
            {t.kind !== 'confirm' && <span className="dot" style={{ background: 'currentColor' }} />}
            <span style={{ flex: 1 }}>{t.text}</span>
            {t.kind === 'confirm' ? (
              <>
                <button className="btn" style={{ fontSize: 11 }} onClick={() => { t.onChoice(false); close(t.id); }}>Cancelar</button>
                <button className="btn btn-primary" style={{ fontSize: 11 }} onClick={() => { t.onChoice(true); close(t.id); }}>Confirmar</button>
              </>
            ) : (
              <button onClick={() => close(t.id)} style={{ background: 'transparent', border: 'none', color: 'currentColor', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>×</button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Map URL path <-> active screen so deep links, browser back/forward and
// bookmarks all work. `/` y rutas desconocidas resuelven a Overview (vista
// diaria, espejo del correo). El path `/dashboard` sigue funcionando para no
// romper bookmarks; ahora muestra el Scorecard táctico.
const PATH_TO_SCREEN = {
  '/': 'overview',
  '/overview': 'overview',
  '/dashboard': 'dashboard',
  '/mentions': 'mentions',
  '/search': 'search',
  '/sentiment': 'sentiment',
  '/topics': 'topics',
  '/geography': 'geography',
  '/alerts': 'alerts',
  '/settings': 'settings',
  '/narrative': 'narrative',
  // Vista ejecutiva multi-agencia (solo cuando agency === '__all__').
  '/exec/tabla': 'exec-tabla',
  '/exec/sala': 'exec-sala',
  '/exec/radar': 'exec-radar',
};
const SCREEN_TO_PATH = {
  overview: '/overview',
  dashboard: '/dashboard',
  mentions: '/mentions',
  search: '/search',
  sentiment: '/sentiment',
  topics: '/topics',
  geography: '/geography',
  alerts: '/alerts',
  settings: '/settings',
  narrative: '/narrative',
  'exec-tabla': '/exec/tabla',
  'exec-sala': '/exec/sala',
  'exec-radar': '/exec/radar',
};

// Topics has a nested drill-in route (/topics/<slug>). Resolve any such path
// back to the 'topics' screen so deep links and browser Back/forward keep the
// dashboard on the right tab. Exact matches win first.
function screenFromPath(pathname) {
  if (PATH_TO_SCREEN[pathname]) return PATH_TO_SCREEN[pathname];
  if (pathname.indexOf('/topics/') === 0) return 'topics';
  return null;
}

// Error boundary — without this a render crash in any screen white-screens
// the whole dashboard.
class EcoErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) {
    console.error('[ECO] render crash', error, info?.componentStack);
  }
  render() {
    if (this.state.error) {
      return React.createElement('div', {
        style: { padding: 32, maxWidth: 640, margin: '80px auto', background: 'var(--canvas)', border: '1px solid var(--hairline-strong)', borderRadius: 12 },
      }, [
        React.createElement('div', { key: 'eye', className: 'section-eyebrow', style: { color: 'var(--neg)' } }, 'Error de render'),
        React.createElement('h2', { key: 'h', style: { marginTop: 8, fontFamily: 'var(--ff-display)', fontSize: 20 } }, 'Algo rompió la pantalla actual.'),
        React.createElement('pre', { key: 'p', style: { marginTop: 12, padding: 12, background: 'var(--canvas-2)', borderRadius: 6, fontSize: 11, color: 'var(--text-2)', whiteSpace: 'pre-wrap', overflow: 'auto', maxHeight: 180 } }, String(this.state.error && (this.state.error.stack || this.state.error.message))),
        React.createElement('div', { key: 'btns', style: { marginTop: 16, display: 'flex', gap: 8 } }, [
          React.createElement('button', { key: 'r', className: 'btn btn-primary', onClick: () => { this.setState({ error: null }); } }, 'Reintentar'),
          React.createElement('button', { key: 'h2', className: 'btn', onClick: () => { location.href = '/dashboard'; } }, 'Volver al dashboard'),
        ]),
      ]);
    }
    return this.props.children;
  }
}

const TWEAK_DEFAULTS = { theme: 'mando', mode: 'dark', density: 'normal', collapsed: false };

const SCREEN_META = {
  overview:  { label: 'Overview',      eyebrow: null },
  dashboard: { label: 'Scorecard',     eyebrow: 'Scorecard táctico · tiempo real' },
  mentions:  { label: 'Menciones',     eyebrow: 'Flujo de conversación' },
  search:    { label: 'Búsqueda',      eyebrow: 'Resultados en todas las menciones' },
  sentiment: { label: 'Sentimiento',   eyebrow: 'Análisis emocional' },
  topics:    { label: 'Tópicos',       eyebrow: 'Temas detectados' },
  geography: { label: 'Geografía',     eyebrow: '78 municipios · Puerto Rico' },
  alerts:    { label: 'Alertas',       eyebrow: 'Reglas y vigilancia activa' },
  settings:  { label: 'Configuración', eyebrow: 'Alertas y usuarios' },
  narrative: { label: 'Narrativas',    eyebrow: 'Clusters emergentes · ramificaciones' },
  'exec-tabla': { label: 'Tabla de posiciones', eyebrow: 'Vista ejecutiva · ranking de salud digital' },
  'exec-sala':  { label: 'Sala de mando',       eyebrow: 'Vista ejecutiva · sala de mando multi-agencia' },
  'exec-radar': { label: 'Radar de crisis',     eyebrow: 'Vista ejecutiva · sala situacional' },
};

// El selector de agencias toma SIEMPRE la lista del backend
// (`AGENCIES_FULL` viene de /api/eco-data). El fallback ya no incluye
// menciones inventadas — si el API falla, mostramos lista vacía y la UI
// resuelve con su empty state en lugar de fingir agencias falsas.
const AGENCIES = (window.ECO_DATA && window.ECO_DATA.AGENCIES_FULL) || [];

// Sentinel de la vista ejecutiva multi-agencia. Cuando la agencia seleccionada
// es '__all__' (solo staff — lo inyecta AGENCIES_FULL), el dashboard muestra
// las 3 pantallas ejecutivas (Tabla / Sala / Radar) en vez de las de una sola
// agencia. Esas pantallas consumen /api/exec-overview (NO /api/eco-data), así
// que da igual que el slug '__all__' no resuelva en el boot de eco-data.
const ALL_AGENCIES_KEY = '__all__';
const EXEC_SCREENS = ['exec-tabla', 'exec-sala', 'exec-radar'];
const DEFAULT_EXEC_SCREEN = 'exec-sala';
function isExecScreen(key) { return EXEC_SCREENS.indexOf(key) !== -1; }

function App() {
  const [theme] = useState(TWEAK_DEFAULTS.theme);
  const [mode, setMode] = useState(() => localStorage.getItem('eco.mode') || TWEAK_DEFAULTS.mode);
  const [density] = useState(TWEAK_DEFAULTS.density);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('eco.collapsed') === 'true');
  const bp = useBreakpoint();
  // Off-canvas navigation drawer state (only meaningful at <=768px).
  const [menuOpen, setMenuOpen] = useState(false);
  // On tablet the rail auto-collapses to an icon column (CSS sets 64px); on
  // mobile it becomes a full-label off-canvas drawer; on desktop honor the
  // user's toggle. Keeping the rendered `collapsed` in sync with the CSS grid
  // width is what prevents labels from clipping inside a 64px column.
  const effectiveCollapsed = bp === 'tablet' ? true : bp === 'mobile' ? false : collapsed;
  // Close the drawer whenever we leave mobile (e.g. rotate / resize up).
  useEffect(() => { if (bp !== 'mobile' && menuOpen) setMenuOpen(false); }, [bp, menuOpen]);

  // URL path is the source of truth for the active screen on initial load, so
  // deep links like /mentions or /geography work from a fresh browser.
  const [active, setActiveRaw] = useState(() => {
    const fromPath = screenFromPath(location.pathname);
    return fromPath || localStorage.getItem('eco.active') || 'overview';
  });
  const setActive = useCallback((next) => {
    const path = SCREEN_TO_PATH[next];
    // Push the section's base path even when already on that section (e.g.
    // clicking "Tópicos" while drilled into a topic) so nested screens can
    // collapse their drill-in. pushState doesn't emit popstate, so we also fire
    // a custom event that the nested screens listen for.
    if (path && location.pathname !== path) {
      history.pushState({ eco: next }, '', path);
      window.dispatchEvent(new Event('eco:locationchange'));
    }
    setActiveRaw(next);
  }, []);

  // Keep the app in sync when the user presses back/forward in the browser.
  useEffect(() => {
    const handler = () => {
      const fromPath = screenFromPath(location.pathname);
      if (fromPath) setActiveRaw(fromPath);
    };
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, []);

  const [agency, setAgency] = useState(() => {
    // Prefer the live agency list from /api/eco-data over the seed mock — the
    // mock has fictional slugs (dtop, salud) that aren't in the real DB, so
    // falling back to AGENCIES[0] picked a slug the backend would never honor.
    const list = (window.ECO_DATA && window.ECO_DATA.AGENCIES_FULL) || AGENCIES;
    const saved = localStorage.getItem('eco.agency');
    if (saved && list.some((a) => a.key === saved)) return saved;
    // Honor the JWT-bound agency before falling back to the alphabetically
    // first slug (otherwise a ddecpr user lands on aaa charts at first boot).
    const jwtSlug = window.ECO_DATA && window.ECO_DATA.USER_AGENCY_SLUG;
    if (jwtSlug && list.some((a) => a.key === jwtSlug)) return jwtSlug;
    return (list[0] && list[0].key) || 'aaa';
  });
  const [period, setPeriod] = useState(() => localStorage.getItem('eco.period') || '7D');
  const [cmdOpen, setCmdOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [drawerMention, setDrawerMention] = useState(null);
  const [mentionsFilter, setMentionsFilter] = useState(null);
  // Query del buscador global. La setea el command palette (⌘K → "ver todos
  // los resultados") y la lee SearchScreen. Inicializa desde ?q= si el usuario
  // entra por deep-link a /search.
  const [searchQuery, setSearchQuery] = useState(() => {
    try { return new URLSearchParams(location.search).get('q') || ''; } catch (_) { return ''; }
  });

  // Sesión + RBAC: el SPA consulta /api/auth/me al boot para gatear navegación y
  // controles (rol, capacidades, páginas permitidas por usuario). window.ECO_SESSION
  // lo leen shell.js (filtros de nav/⌘K) y screens.js (gating de tabs de config).
  const [session, setSession] = useState(() => window.ECO_SESSION || null);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { user: null }))
      .then((d) => { if (!cancelled && d && d.user) { window.ECO_SESSION = d.user; setSession(d.user); } })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  // Guard de deep-link: si el usuario no puede ver la pantalla activa (override de
  // páginas o capacidad insuficiente), redirige a overview.
  useEffect(() => {
    if (session && typeof window.ecoCanSeePage === 'function' && !window.ecoCanSeePage(active)) {
      setActive('overview');
    }
  }, [session, active, setActive]);

  // Coherencia agencia ↔ pantalla para la vista ejecutiva '__all__'.
  //  • Con '__all__' seleccionada: si la pantalla activa NO es ejecutiva
  //    (una de una sola agencia), saltar a la pantalla ejecutiva por defecto.
  //    Esto también corre tras el reload que dispara el cambio de agencia, así
  //    que seleccionar "TODAS" aterriza en Sala de mando.
  //  • Con una agencia real seleccionada: si la pantalla activa es ejecutiva,
  //    volver a overview (evita quedar atascado en una vista multi-agencia).
  useEffect(() => {
    if (agency === ALL_AGENCIES_KEY) {
      if (!isExecScreen(active)) setActive(DEFAULT_EXEC_SCREEN);
    } else if (isExecScreen(active)) {
      setActive('overview');
    }
  }, [agency, active, setActive]);

  useEffect(() => { localStorage.setItem('eco.active', active); }, [active]);
  useEffect(() => { localStorage.setItem('eco.mode', mode); }, [mode]);
  useEffect(() => { localStorage.setItem('eco.collapsed', String(collapsed)); }, [collapsed]);

  // Sign-out helper exposed globally so the sidebar user menu can call it.
  window.ecoSignOut = useCallback(async () => {
    try {
      await fetch('/api/auth/session', { method: 'DELETE', credentials: 'same-origin' });
    } catch (_) {}
    try { localStorage.clear(); } catch (_) {}
    location.href = '/sign-in';
  }, []);

  // Period and agency drive the /api/eco-data query. A reload re-runs the
  // boot loader with the new slug/period so the dashboard reflects real data.
  const firstRun = React.useRef(true);
  useEffect(() => {
    const prev = localStorage.getItem('eco.period');
    localStorage.setItem('eco.period', period);
    if (firstRun.current) return;
    if (prev !== period) window.location.reload();
  }, [period]);
  useEffect(() => {
    const prev = localStorage.getItem('eco.agency');
    localStorage.setItem('eco.agency', agency);
    if (firstRun.current) { firstRun.current = false; return; }
    if (prev !== agency) window.location.reload();
  }, [agency]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.setAttribute('data-mode', mode);
    document.documentElement.setAttribute('data-density', density);
  }, [theme, mode, density]);

  useEffect(() => {
    const handler = (e) => {
      const metaKey = e.metaKey || e.ctrlKey;
      if (metaKey && e.key.toLowerCase() === 'k') { e.preventDefault(); setCmdOpen(true); return; }
      if (metaKey && e.key === 'Enter') { e.preventDefault(); setChatOpen((v) => !v); return; }
      if (e.key === 'Escape') { setCmdOpen(false); setDrawerMention(null); setChatOpen(false); return; }
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
      if (!metaKey && !e.altKey) {
        const map = { o: 'overview', d: 'dashboard', m: 'mentions', s: 'sentiment', t: 'topics', g: 'geography', a: 'alerts', n: 'narrative' };
        const k = e.key.toLowerCase();
        if (map[k]) { setActive(map[k]); return; }
        if (e.key === '[' || e.key === ']') { setCollapsed(!collapsed); return; }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [collapsed]);

  const screenMeta = SCREEN_META[active];
  const ScreenComponent = {
    overview: OverviewScreen,
    dashboard: DashboardScreen,
    mentions: MentionsScreen,
    search: SearchScreen,
    sentiment: SentimentScreen,
    topics: TopicsScreen,
    geography: GeographyScreen,
    alerts: AlertsScreen,
    settings: SettingsScreen,
    narrative: NarrativeScreen,
    'exec-tabla': TablaScreen,
    'exec-sala': SalaScreen,
    'exec-radar': RadarScreen,
  }[active];

  return (
    <div className="eco-app" data-collapsed={effectiveCollapsed} data-menu-open={menuOpen} data-density={density} data-chat-open={chatOpen}>
      <Sidebar
        active={active} onNav={(k) => { setActive(k); setMenuOpen(false); }}
        collapsed={effectiveCollapsed} setCollapsed={setCollapsed}
        agency={((window.ECO_DATA && window.ECO_DATA.AGENCIES_FULL) || AGENCIES).find(a => a.key === agency)}
        onOpenCommand={() => setCmdOpen(true)}
        theme={theme} mode={mode}
      />
      {bp === 'mobile' && menuOpen && <div className="eco-menu-backdrop" onClick={() => setMenuOpen(false)} />}
      <div className="eco-main">
        <Header
          title={screenMeta.label} eyebrow={screenMeta.eyebrow}
          period={period} setPeriod={setPeriod}
          agency={agency} setAgency={setAgency}
          agencies={(window.ECO_DATA && window.ECO_DATA.AGENCIES_FULL) || AGENCIES}
          onOpenCommand={() => setCmdOpen(true)}
          onOpenMenu={() => setMenuOpen(true)}
          bp={bp}
          onSearch={(query) => { setSearchQuery(query); setActive('search'); }}
          onOpenChat={() => setChatOpen(true)}
          mode={mode} setMode={setMode} live={true}
        />
        <main className="eco-page"
          data-screen-label={`${String(Object.keys(SCREEN_META).indexOf(active) + 1).padStart(2, '0')} ${screenMeta.label}`}>
          <ScreenComponent
            onMentionClick={setDrawerMention}
            period={period} setPeriod={setPeriod}
            mentionsFilter={mentionsFilter} setMentionsFilter={setMentionsFilter}
            searchQuery={searchQuery} setSearchQuery={setSearchQuery}
            agency={agency}
            setActive={setActive}
            bp={bp}
          />
        </main>
      </div>

      {cmdOpen && <CommandPalette
        onClose={() => setCmdOpen(false)}
        onNav={(k) => { setActive(k); setCmdOpen(false); }}
        onSetPeriod={(p) => { setPeriod(p); }}
        onSetMode={(m) => { setMode(m); }}
        onMentionClick={(m) => { setDrawerMention(m); setCmdOpen(false); }}
        onOpenMentionsWithFilter={(f) => { setMentionsFilter(f); setActive('mentions'); }}
        onSearchAll={(query) => { setSearchQuery(query); setActive('search'); setCmdOpen(false); }}
      />}
      {drawerMention && (
        <MentionDrawer
          mention={drawerMention}
          onClose={() => setDrawerMention(null)}
          onNavigate={(screen) => { setDrawerMention(null); setActive(screen); }}
          onMentionClick={(m) => setDrawerMention(m)}
        />
      )}
      <ChatDrawer
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        agency={agency}
        period={period}
        screen={active}
        screenLabel={screenMeta.label}
        filters={mentionsFilter || (searchQuery ? { q: searchQuery } : null)}
      />
      <ToastHost />
    </div>
  );
}

function boot() {
  if (!window.ECO_DATA || !window.ECO_SHELL || !window.ECO_SCREENS) {
    setTimeout(boot, 30);
    return;
  }
  const root = document.getElementById('eco-root');
  if (!root) { setTimeout(boot, 30); return; }
  ReactDOM.createRoot(root).render(
    <EcoErrorBoundary>
      <App />
    </EcoErrorBoundary>
  );
}
boot();
