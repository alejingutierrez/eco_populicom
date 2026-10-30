// Chat contextual — drawer lateral que corre la interfaz a la izquierda.
// Pregunta sobre la vista actual (métricas + menciones del periodo/filtros);
// el backend responde con streaming (NDJSON) usando SOLO ese contexto.
// Expuesto como window.ECO_CHAT.ChatDrawer y montado por app.js.
(function () {
  const { useState, useEffect, useRef, useCallback } = React;
  const { Icons } = window;

  // ---- Render de markdown ligero (negritas + viñetas), seguro (sin HTML) ----
  function inlineBold(s, kp) {
    const parts = String(s).split(/\*\*/);
    return parts.map((p, i) =>
      i % 2 === 1
        ? React.createElement('strong', { key: kp + '-b' + i }, p)
        : React.createElement(React.Fragment, { key: kp + '-t' + i }, p)
    );
  }
  function renderRich(text) {
    const lines = String(text || '').split('\n');
    const blocks = [];
    let list = null;
    let para = [];
    const flushPara = () => { if (para.length) { blocks.push({ type: 'p', text: para.join(' ') }); para = []; } };
    const flushList = () => { if (list) { blocks.push({ type: 'ul', items: list }); list = null; } };
    for (const raw of lines) {
      const t = raw.trim();
      if (!t) { flushPara(); flushList(); continue; }
      if (/^[-*•]\s+/.test(t)) { flushPara(); if (!list) list = []; list.push(t.replace(/^[-*•]\s+/, '')); }
      else { flushList(); para.push(t); }
    }
    flushPara(); flushList();
    return blocks.map((b, i) => {
      if (b.type === 'ul') {
        return React.createElement('ul', { key: 'ul' + i, style: { margin: '6px 0', paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' } },
          b.items.map((it, j) => React.createElement('li', { key: j, style: { lineHeight: 1.5 } }, inlineBold(it, 'li' + i + j))));
      }
      return React.createElement('p', { key: 'p' + i, style: { margin: '0 0 8px', lineHeight: 1.55 } }, inlineBold(b.text, 'p' + i));
    });
  }

  // ---- Snapshot de la vista actual para enviar como contexto ----
  function buildViewContext(props) {
    const D = (typeof window !== 'undefined' && window.ECO_DATA) || {};
    const list = D.AGENCIES_FULL || [];
    const ag = list.find((a) => a.key === props.agency);
    let from = null, to = null;
    try {
      if (props.period === 'custom') { from = localStorage.getItem('eco.from') || null; to = localStorage.getItem('eco.to') || null; }
    } catch (_) {}
    return {
      agencyName: ag ? ag.name : props.agency,
      agencySlug: props.agency,
      screen: props.screen,
      screenLabel: props.screenLabel,
      period: props.period,
      from, to,
      metrics: D.CURRENT_METRICS || null,
      sentiment: D.SENTIMENT_BREAKDOWN || null,
      topics: D.TOPICS || null,
      sources: D.TOP_SOURCES || null,
      municipalities: D.MUNICIPALITIES || null,
      emotions: D.EMOTIONS || null,
      mentions: Array.isArray(D.MENTIONS) ? D.MENTIONS.slice(0, 50) : null,
      filters: props.filters || null,
    };
  }

  const SUGGESTIONS = [
    '¿Cuál es el sentimiento general y qué lo explica?',
    '¿Qué tópico domina y qué dice la gente sobre él?',
    'Resume las menciones más relevantes del periodo.',
  ];

  // Parche sobre la última burbuja del asistente (campos del modo Asesor).
  function patchLast(patch) {
    return (ms) => {
      const copy = ms.slice();
      const last = copy[copy.length - 1];
      if (last && last.role === 'assistant') copy[copy.length - 1] = { ...last, ...patch };
      return copy;
    };
  }

  // Fila del servidor → burbuja. Las corridas del asesor se reconstruyen desde content_json.
  function fromRow(row) {
    const cj = row.contentJson || null;
    const base = { role: row.role, content: row.content };
    if (!cj || cj.mode !== 'advisor') return base;
    return { ...base, mode: 'advisor', camino: cj.camino, runId: cj.runId || undefined };
  }

  function Bubble({ m, actions }) {
    const isUser = m.role === 'user';
    return React.createElement('div', {
      style: { display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start' },
    },
      React.createElement('div', {
        style: {
          maxWidth: '88%', padding: '10px 13px', borderRadius: 'var(--r-xl)', fontSize: 'var(--fs-body-sm)',
          background: isUser ? 'var(--accent-fill)' : 'var(--canvas-2)',
          border: '1px solid var(--hairline)',
          color: 'var(--text)',
          whiteSpace: 'normal', wordBreak: 'break-word',
        },
      },
        isUser
          ? React.createElement('div', { style: { lineHeight: 1.5, whiteSpace: 'pre-wrap' } }, m.content)
          : (m.content
              ? renderRich(m.content)
              : (m.runId && !m.error ? null
                  : React.createElement('span', { style: { color: 'var(--text-3)', fontSize: 'var(--fs-caption)' } },
                      m.error ? m.error : 'Pensando…'))),
        !isUser && m.streaming && m.content
          ? React.createElement('span', { style: { display: 'inline-block', width: 7, height: 13, marginLeft: 2, background: 'var(--accent)', verticalAlign: 'text-bottom', animation: 'fadeIn 0.6s infinite alternate' } })
          : null,
        window.ECO_ADVISOR ? window.ECO_ADVISOR.renderExtras(m, actions) : null
      )
    );
  }

  function ChatDrawer(props) {
    const { open, onClose } = props;
    const [convos, setConvos] = useState([]);
    const [activeId, setActiveId] = useState(null);
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [streaming, setStreaming] = useState(false);
    const [listOpen, setListOpen] = useState(false);
    // 'descriptive' (chat actual) | 'advisor' (asesor de crisis, camino 1 en fase 0).
    const [mode, setMode] = useState('descriptive');
    const scrollRef = useRef(null);
    const taRef = useRef(null);
    const abortRef = useRef(null);

    const agencyQS = () => 'agency=' + encodeURIComponent(props.agency || '');

    const loadConvos = useCallback(() => {
      fetch('/api/chat/conversations?' + agencyQS(), { credentials: 'same-origin', cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : { conversations: [] }))
        .then((d) => setConvos(d.conversations || []))
        .catch(() => {});
    }, [props.agency]);

    // Cargar la lista al abrir (y al cambiar de agencia).
    useEffect(() => { if (open) loadConvos(); }, [open, loadConvos]);

    // Auto-scroll al final cuando llegan mensajes/tokens.
    useEffect(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }, [messages, open]);

    // ---- Modo Asesor: seguimiento de corridas (caminos 2 y 3, spec §3.2) ----
    const pollersRef = useRef(new Map());
    const stopPollers = useCallback(() => {
      pollersRef.current.forEach((e) => { e.stopped = true; if (e.timer) clearTimeout(e.timer); });
      pollersRef.current.clear();
    }, []);
    // Al cambiar de agencia o desmontar, se detienen los sondeos.
    useEffect(() => stopPollers, [props.agency, stopPollers]);

    const startPoll = useCallback((runId) => {
      const A = window.ECO_ADVISOR;
      if (!A || pollersRef.current.has(runId)) return;
      const qs = 'agency=' + encodeURIComponent(props.agency || '');
      const entry = { timer: null, stopped: false };
      pollersRef.current.set(runId, entry);
      let after = 0;
      let failures = 0;
      const patchRun = (fn) => setMessages((ms) => ms.map((m) => (m.runId === runId ? fn(m) : m)));
      const stop = () => {
        entry.stopped = true;
        if (pollersRef.current.get(runId) === entry) pollersRef.current.delete(runId);
      };
      const tick = async () => {
        entry.timer = null;
        if (entry.stopped) return;
        let again = A.POLL_MS;
        try {
          const ev = await A.fetchEvents(qs, runId, after);
          if (entry.stopped) return;
          failures = 0;
          const list = ev.events || [];
          if (list.length) {
            after = list[list.length - 1].seq;
            patchRun((m) => A.applyEvents(m, list));
          }
          if (list.length >= A.EVENTS_PAGE) {
            again = 0; // página llena: hay más eventos, se sigue sin esperar
          } else if (ev.done) {
            const run = await A.fetchRun(qs, runId);
            if (entry.stopped) return;
            patchRun((m) => A.applyRun(m, run));
            if (A.isTerminal(run.status)) {
              stop();
              A.trackRunDone(run);
              return;
            }
          }
        } catch (err) {
          if (entry.stopped) return;
          failures += 1;
          if (failures >= 5 || (err && (err.status === 401 || err.status === 404))) {
            stop();
            patchRun((m) => ({ ...m, pollError: (err && err.message) || 'Error de red.' }));
            return;
          }
        }
        if (!entry.stopped) entry.timer = setTimeout(tick, again);
      };
      tick();
    }, [props.agency]);

    // Mensajes de corridas no terminadas (en vivo o recuperadas al abrir) reciben sondeo.
    useEffect(() => {
      if (!window.ECO_ADVISOR) return;
      messages.forEach((m) => {
        if (m.runId && m.camino !== 1 && !window.ECO_ADVISOR.isTerminal(m.runStatus) && !m.pollError) startPoll(m.runId);
      });
    }, [messages, startPoll]);

    const cancelRun = useCallback((m) => {
      const A = window.ECO_ADVISOR;
      if (!A || !m.runId) return;
      const runId = m.runId;
      const qs = 'agency=' + encodeURIComponent(props.agency || '');
      A.track('advisor_cancel', { advisor_path: m.camino });
      setMessages((ms) => ms.map((x) => (x.runId === runId ? { ...x, cancelRequested: true } : x)));
      A.postJSON('/api/chat/advisor/runs/' + encodeURIComponent(runId) + '/cancel?' + qs, {})
        .catch(() => setMessages((ms) => ms.map((x) => (x.runId === runId ? { ...x, cancelRequested: false } : x))));
    }, [props.agency]);

    const chooseRun = useCallback((m, choice, note) => {
      const A = window.ECO_ADVISOR;
      const runId = m.runId;
      const qs = 'agency=' + encodeURIComponent(props.agency || '');
      return A.postJSON('/api/chat/advisor/runs/' + encodeURIComponent(runId) + '/choice?' + qs,
        { choice, note: note || undefined })
        .then(() => {
          A.track('advisor_choice', { advisor_choice: choice });
          setMessages((ms) => ms.map((x) => (x.runId === runId
            ? { ...x, run: { ...(x.run || {}), choice, choiceNote: note || null } } : x)));
        });
    }, [props.agency]);

    const actions = { cancel: cancelRun, choose: chooseRun };

    const newChat = useCallback(() => {
      if (abortRef.current) { try { abortRef.current.abort(); } catch (_) {} }
      stopPollers();
      setActiveId(null); setMessages([]); setInput(''); setStreaming(false); setListOpen(false);
      if (taRef.current) taRef.current.focus();
    }, []);

    const openConvo = useCallback((id) => {
      setListOpen(false);
      if (id === activeId) return;
      // Abortar cualquier stream en curso antes de cambiar de hilo: si no, sus
      // deltas seguirían appendeándose a la última burbuja del hilo recién
      // cargado (corrupción) y dejaría streaming=true en la conversación ajena.
      if (abortRef.current) { try { abortRef.current.abort(); } catch (_) {} }
      setStreaming(false);
      stopPollers();
      setActiveId(id); setMessages([]);
      fetch('/api/chat/conversations/' + id + '?' + agencyQS(), { credentials: 'same-origin', cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : { messages: [] }))
        .then((d) => {
          const rows = (d.messages || []).map(fromRow);
          setMessages(rows);
          // Una conversación del asesor se reabre en su modo.
          if (rows.some((r) => r.mode === 'advisor')) setMode('advisor');
        })
        .catch(() => {});
    }, [activeId, props.agency]);

    const deleteConvo = useCallback((id, e) => {
      if (e) e.stopPropagation();
      fetch('/api/chat/conversations/' + id + '?' + agencyQS(), { method: 'DELETE', credentials: 'same-origin' })
        .then(() => {
          if (window.ecoTrack) window.ecoTrack('chat_conversation_delete');
          setConvos((cs) => cs.filter((c) => c.id !== id));
          if (id === activeId) newChat();
        })
        .catch(() => {});
    }, [activeId, props.agency, newChat]);

    const send = useCallback(async (text, force) => {
      const q = (text != null ? text : input).trim();
      if (!q || streaming) return;
      setInput('');
      if (taRef.current) taRef.current.style.height = 'auto';
      const advising = mode === 'advisor' && !!window.ECO_ADVISOR;
      const forced = advising && (force === 'council' || force === 'quick') ? force : null;
      const startedAt = Date.now();
      const viewContext = buildViewContext(props);
      // Solo la forma del mensaje (largo, si fue sugerencia): el texto puede
      // traer nombres y no debe salir hacia GA4.
      if (window.ecoTrack) window.ecoTrack('chat_message_send', {
        prompt_type: text != null ? 'suggestion' : 'typed',
        message_length: q.length,
        is_new_conversation: !activeId,
      });
      // Burbuja del usuario + burbuja del asistente en progreso.
      if (advising) window.ECO_ADVISOR.track('advisor_ask', { advisor_path_forced: forced ? 'sí' : 'no' });
      setMessages((ms) => [...ms, { role: 'user', content: q }, { role: 'assistant', content: '', streaming: true, ...(advising ? { mode: 'advisor' } : {}) }]);
      setStreaming(true);

      const ctrl = new AbortController();
      abortRef.current = ctrl;
      let convId = activeId;
      try {
        const resp = await fetch((advising ? '/api/chat/advisor?' : '/api/chat/stream?') + agencyQS(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          signal: ctrl.signal,
          body: JSON.stringify(advising
            ? { conversationId: activeId || undefined, message: q, ...(forced ? { force: forced } : {}) }
            : { conversationId: activeId || undefined, message: q, viewContext }),
        });
        if (!resp.ok || !resp.body) {
          if (advising) {
            const body = await resp.json().catch(() => null);
            throw new Error(window.ECO_ADVISOR.httpErrorText(resp.status, body));
          }
          throw new Error(resp.status === 401 ? 'Sesión expirada. Recarga la página.' : 'Error ' + resp.status);
        }
        const reader = resp.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, idx); buf = buf.slice(idx + 1);
            if (!line.trim()) continue;
            let evt; try { evt = JSON.parse(line); } catch (_) { continue; }
            if (evt.type === 'meta') {
              convId = evt.conversationId;
              if (evt.isNew) {
                setActiveId(evt.conversationId);
                setConvos((cs) => [{ id: evt.conversationId, title: evt.title, status: 'active', updatedAt: new Date().toISOString() }, ...cs]);
              }
            } else if (evt.type === 'triage' && advising) {
              window.ECO_ADVISOR.track('advisor_triage', { advisor_path: evt.camino, advisor_floor: evt.piso });
              setMessages(patchLast({ triage: evt }));
            } else if (evt.type === 'run' && advising) {
              setMessages(patchLast({ runId: evt.runId, camino: evt.camino, runStatus: 'queued' }));
            } else if (evt.type === 'delta') {
              setMessages((ms) => {
                const copy = ms.slice();
                const last = copy[copy.length - 1];
                if (last && last.role === 'assistant') copy[copy.length - 1] = { ...last, content: last.content + evt.text };
                return copy;
              });
            } else if (evt.type === 'status' && advising) {
              // Notas de progreso del camino 1: se muestran hasta que llega el texto.
              setMessages((ms) => {
                const copy = ms.slice();
                const last = copy[copy.length - 1];
                if (last && last.role === 'assistant') copy[copy.length - 1] = { ...last, progress: [...(last.progress || []), evt.texto] };
                return copy;
              });
            } else if (evt.type === 'done' && advising) {
              window.ECO_ADVISOR.track('advisor_run_done', {
                advisor_path: 1, advisor_status: 'done',
                duration_bucket: window.ECO_ADVISOR.durationBucket(Date.now() - startedAt),
              });
              setMessages((ms) => {
                const copy = ms.slice();
                const last = copy[copy.length - 1];
                if (last && last.role === 'assistant') copy[copy.length - 1] = { ...last, meta: { citations: evt.citations, revision: evt.revision }, ...(evt.runId ? { runId: evt.runId, camino: 1 } : {}) };
                return copy;
              });
            } else if (evt.type === 'error') {
              if (window.ecoTrack) window.ecoTrack('chat_error', { error_message: evt.message || 'stream_error' });
              setMessages((ms) => {
                const copy = ms.slice();
                const last = copy[copy.length - 1];
                if (last && last.role === 'assistant') copy[copy.length - 1] = { ...last, streaming: false, error: evt.message || 'Error al generar.' };
                return copy;
              });
            }
          }
        }
      } catch (err) {
        const msg = err && err.name === 'AbortError' ? null : (err && err.message) || 'Error de red.';
        if (msg && window.ecoTrack) window.ecoTrack('chat_error', { error_message: msg });
        if (msg) {
          setMessages((ms) => {
            const copy = ms.slice();
            const last = copy[copy.length - 1];
            if (last && last.role === 'assistant') copy[copy.length - 1] = { ...last, streaming: false, error: last.content ? null : msg };
            return copy;
          });
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
        setMessages((ms) => {
          const copy = ms.slice();
          const last = copy[copy.length - 1];
          if (last && last.role === 'assistant' && last.streaming) copy[copy.length - 1] = { ...last, streaming: false };
          return copy;
        });
        // Refrescar orden de la lista (updatedAt) tras responder.
        loadConvos();
      }
    }, [input, streaming, activeId, props, loadConvos, mode]);

    const onKeyDown = (e) => {
      // Enter (con o sin ⌘/Ctrl) envía; Shift+Enter hace salto de línea.
      // stopPropagation evita que el handler global de la App interprete
      // ⌘+Enter como "toggle chat" (cerraría el drawer al enviar).
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); send(); }
    };
    const onInput = (e) => {
      setInput(e.target.value);
      const el = taRef.current;
      if (el) { el.style.height = 'auto'; el.style.height = Math.min(140, el.scrollHeight) + 'px'; }
    };

    if (!open) return null;

    const activeTitle = (convos.find((c) => c.id === activeId) || {}).title || 'Nueva conversación';

    return React.createElement('aside', { className: 'chat-drawer', role: 'complementary', 'aria-label': 'Asistente contextual' }, [
      // ---- Cabecera ----
      React.createElement('div', { key: 'head', className: 'chat-head' }, [
        React.createElement('div', { key: 'l', style: { display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', minWidth: 0, flex: 1 } }, [
          React.createElement(Icons.Sparkles, { key: 'i', size: 15, color: 'var(--accent)' }),
          React.createElement('button', {
            key: 'sw', className: 'chat-title-btn', onClick: () => setListOpen((v) => !v), title: 'Conversaciones',
          }, [
            React.createElement('span', { key: 't', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, activeTitle),
            React.createElement(Icons.ChevronDown, { key: 'c', size: 13 }),
          ]),
          window.ECO_ADVISOR && window.ECO_ADVISOR.canAdvise()
            ? React.createElement(window.ECO_ADVISOR.ModeSelector, {
                key: 'm', mode,
                onChange: (m) => {
                  if (streaming || m === mode) return;
                  setMode(m);
                  window.ECO_ADVISOR.track('advisor_mode_toggle', { mode: m });
                },
              })
            : null,
        ]),
        React.createElement('button', { key: 'new', className: 'btn', onClick: newChat, title: 'Nueva conversación' },
          React.createElement(Icons.Plus, { size: 14 })),
        React.createElement('button', { key: 'x', className: 'btn', onClick: onClose, title: 'Cerrar (Esc)' },
          React.createElement(Icons.Close, { size: 14 })),
      ]),

      // ---- Lista de conversaciones (desplegable) ----
      listOpen ? React.createElement('div', { key: 'list', className: 'chat-list' },
        convos.length === 0
          ? React.createElement('div', { style: { padding: '12px 14px', fontSize: 'var(--fs-caption)', color: 'var(--text-3)' } }, 'Sin conversaciones previas.')
          : convos.map((c) => React.createElement('div', {
              key: c.id, className: 'chat-list-item' + (c.id === activeId ? ' active' : ''), onClick: () => openConvo(c.id),
            }, [
              React.createElement(Icons.MessageSquare, { key: 'i', size: 13, color: 'var(--text-3)' }),
              React.createElement('span', { key: 't', style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, c.title),
              React.createElement('button', { key: 'd', className: 'chat-del', title: 'Borrar', onClick: (e) => deleteConvo(c.id, e) },
                React.createElement(Icons.Trash, { size: 12 })),
            ]))
      ) : null,

      // ---- Mensajes ----
      React.createElement('div', { key: 'msgs', className: 'chat-msgs', ref: scrollRef },
        messages.length === 0
          ? React.createElement('div', { key: 'empty', className: 'chat-empty' }, [
              React.createElement('div', { key: 'h', style: { fontSize: 'var(--fs-body)', fontWeight: 700, fontFamily: 'var(--ff-display)', marginBottom: 'var(--sp-1)' } }, 'Pregúntale a tus datos'),
              React.createElement('div', { key: 's', style: { fontSize: 'var(--fs-caption)', color: 'var(--text-2)', lineHeight: 1.5, marginBottom: 'var(--sp-4)' } },
                'Responde sobre la vista actual — ' + (props.screenLabel || props.screen || '') + ', periodo ' + (props.period || '') + '. Si algo no está en estos datos, te lo dirá.'),
              React.createElement('div', { key: 'sg', style: { display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' } },
                SUGGESTIONS.map((s, i) => React.createElement('button', {
                  key: i, className: 'chat-suggest', onClick: () => send(s),
                }, s))),
            ])
          : messages.map((m, i) => React.createElement(Bubble, { key: i, m, actions }))
      ),

      // ---- Composer ----
      React.createElement('div', { key: 'composer', className: 'chat-composer' }, [
        React.createElement('textarea', {
          key: 'ta', ref: taRef, className: 'chat-input', rows: 1,
          placeholder: 'Pregunta sobre lo que ves…',
          value: input, onChange: onInput, onKeyDown,
          disabled: streaming,
        }),
        (mode === 'advisor' && window.ECO_ADVISOR)
          ? React.createElement(window.ECO_ADVISOR.ForceButtons, {
              key: 'force', disabled: streaming || !input.trim(), onForce: (f) => send(undefined, f),
            })
          : null,
        React.createElement('button', {
          key: 'send', className: 'chat-send', onClick: () => send(), disabled: streaming || !input.trim(),
          title: 'Enviar (Enter)',
        }, React.createElement(streaming ? Icons.Circle : Icons.ArrowUp, { size: 16 })),
      ]),
    ]);
  }

  window.ECO_CHAT = { ChatDrawer };
})();
