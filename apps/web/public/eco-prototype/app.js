// App root — production mount (no tweaks panel, fixed Mando theme)
const { useState, useEffect, useCallback } = React;
const { Sidebar, Header, CommandPalette, MentionDrawer } = window.ECO_SHELL;
const { DashboardScreen, MentionsScreen, SentimentScreen, TopicsScreen, GeographyScreen, AlertsScreen, SettingsScreen } = window.ECO_SCREENS;

const TWEAK_DEFAULTS = { theme: 'mando', mode: 'dark', density: 'normal', collapsed: false };

const SCREEN_META = {
  dashboard: { label: 'Dashboard',     eyebrow: 'Monitoreo · tiempo real' },
  mentions:  { label: 'Menciones',     eyebrow: 'Flujo de conversación' },
  sentiment: { label: 'Sentimiento',   eyebrow: 'Análisis emocional' },
  topics:    { label: 'Tópicos',       eyebrow: 'Temas detectados' },
  geography: { label: 'Geografía',     eyebrow: '78 municipios · Puerto Rico' },
  alerts:    { label: 'Alertas',       eyebrow: 'Reglas y vigilancia activa' },
  settings:  { label: 'Configuración', eyebrow: 'Alertas y usuarios' },
};

const AGENCIES = (window.ECO_DATA && window.ECO_DATA.AGENCIES_FULL) || [
  { key: 'dtop',  name: 'DTOP',  long: 'Dept. de Transportación y Obras Públicas' },
  { key: 'dacco', name: 'DACo',  long: 'Dept. de Asuntos del Consumidor' },
  { key: 'salud', name: 'Salud', long: 'Dept. de Salud' },
  { key: 'ama',   name: 'AMA',   long: 'Autoridad Metropolitana de Autobuses' },
];

function App() {
  const [theme] = useState(TWEAK_DEFAULTS.theme);
  const [mode, setMode] = useState(() => localStorage.getItem('eco.mode') || TWEAK_DEFAULTS.mode);
  const [density] = useState(TWEAK_DEFAULTS.density);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('eco.collapsed') === 'true');

  const [active, setActive] = useState(() => localStorage.getItem('eco.active') || 'dashboard');
  const [agency, setAgency] = useState(() => {
    const saved = localStorage.getItem('eco.agency');
    if (saved && AGENCIES.some((a) => a.key === saved)) return saved;
    return (AGENCIES[0] && AGENCIES[0].key) || 'dtop';
  });
  const [period, setPeriod] = useState(() => localStorage.getItem('eco.period') || '1M');
  const [cmdOpen, setCmdOpen] = useState(false);
  const [drawerMention, setDrawerMention] = useState(null);
  const [mentionsFilter, setMentionsFilter] = useState(null);

  useEffect(() => { localStorage.setItem('eco.active', active); }, [active]);
  useEffect(() => { localStorage.setItem('eco.mode', mode); }, [mode]);
  useEffect(() => { localStorage.setItem('eco.collapsed', String(collapsed)); }, [collapsed]);

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
      if (e.key === 'Escape') { setCmdOpen(false); setDrawerMention(null); return; }
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
      if (!metaKey && !e.altKey) {
        const map = { d: 'dashboard', m: 'mentions', s: 'sentiment', t: 'topics', g: 'geography', a: 'alerts' };
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
    dashboard: DashboardScreen,
    mentions: MentionsScreen,
    sentiment: SentimentScreen,
    topics: TopicsScreen,
    geography: GeographyScreen,
    alerts: AlertsScreen,
    settings: SettingsScreen,
  }[active];

  return (
    <div className="eco-app" data-collapsed={collapsed} data-density={density}>
      <Sidebar
        active={active} onNav={setActive}
        collapsed={collapsed} setCollapsed={setCollapsed}
        agency={AGENCIES.find(a => a.key === agency)}
        onOpenCommand={() => setCmdOpen(true)}
        theme={theme} mode={mode}
      />
      <div className="eco-main">
        <Header
          title={screenMeta.label} eyebrow={screenMeta.eyebrow}
          period={period} setPeriod={setPeriod}
          agency={agency} setAgency={setAgency} agencies={AGENCIES}
          onOpenCommand={() => setCmdOpen(true)}
          mode={mode} setMode={setMode} live={true}
        />
        <main className="eco-page"
          data-screen-label={`${String(Object.keys(SCREEN_META).indexOf(active) + 1).padStart(2, '0')} ${screenMeta.label}`}>
          <ScreenComponent
            onMentionClick={setDrawerMention}
            period={period} setPeriod={setPeriod}
            mentionsFilter={mentionsFilter} setMentionsFilter={setMentionsFilter}
            agency={agency}
          />
        </main>
      </div>

      {cmdOpen && <CommandPalette
        onClose={() => setCmdOpen(false)}
        onNav={(k) => { setActive(k); setCmdOpen(false); }}
        onSetPeriod={(p) => { setPeriod(p); }}
        onSetMode={(m) => { setMode(m); }}
        onOpenMentionsWithFilter={(f) => { setMentionsFilter(f); setActive('mentions'); }}
      />}
      {drawerMention && <MentionDrawer mention={drawerMention} onClose={() => setDrawerMention(null)} />}
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
  ReactDOM.createRoot(root).render(<App />);
}
boot();
