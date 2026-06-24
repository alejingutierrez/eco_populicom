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
        return React.createElement('ul', { key: 'ul' + i, style: { margin: '6px 0', paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 } },
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

  function Bubble({ m }) {
    const isUser = m.role === 'user';
    return React.createElement('div', {
      style: { display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start' },
    },
      React.createElement('div', {
        style: {
          maxWidth: '88%', padding: '10px 13px', borderRadius: 12, fontSize: 13,
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
              : React.createElement('span', { style: { color: 'var(--text-3)', fontSize: 12 } },
                  m.error ? m.error : 'Pensando…')),
        !isUser && m.streaming && m.content
          ? React.createElement('span', { style: { display: 'inline-block', width: 7, height: 13, marginLeft: 2, background: 'var(--accent)', verticalAlign: 'text-bottom', animation: 'fadeIn 0.6s infinite alternate' } })
          : null
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

    const newChat = useCallback(() => {
      if (abortRef.current) { try { abortRef.current.abort(); } catch (_) {} }
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
      setActiveId(id); setMessages([]);
      fetch('/api/chat/conversations/' + id + '?' + agencyQS(), { credentials: 'same-origin', cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : { messages: [] }))
        .then((d) => setMessages((d.messages || []).map((m) => ({ role: m.role, content: m.content }))))
        .catch(() => {});
    }, [activeId, props.agency]);

    const deleteConvo = useCallback((id, e) => {
      if (e) e.stopPropagation();
      fetch('/api/chat/conversations/' + id + '?' + agencyQS(), { method: 'DELETE', credentials: 'same-origin' })
        .then(() => {
          setConvos((cs) => cs.filter((c) => c.id !== id));
          if (id === activeId) newChat();
        })
        .catch(() => {});
    }, [activeId, props.agency, newChat]);

    const send = useCallback(async (text) => {
      const q = (text != null ? text : input).trim();
      if (!q || streaming) return;
      setInput('');
      if (taRef.current) taRef.current.style.height = 'auto';
      const viewContext = buildViewContext(props);
      // Burbuja del usuario + burbuja del asistente en progreso.
      setMessages((ms) => [...ms, { role: 'user', content: q }, { role: 'assistant', content: '', streaming: true }]);
      setStreaming(true);

      const ctrl = new AbortController();
      abortRef.current = ctrl;
      let convId = activeId;
      try {
        const resp = await fetch('/api/chat/stream?' + agencyQS(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          signal: ctrl.signal,
          body: JSON.stringify({ conversationId: activeId || undefined, message: q, viewContext }),
        });
        if (!resp.ok || !resp.body) {
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
            } else if (evt.type === 'delta') {
              setMessages((ms) => {
                const copy = ms.slice();
                const last = copy[copy.length - 1];
                if (last && last.role === 'assistant') copy[copy.length - 1] = { ...last, content: last.content + evt.text };
                return copy;
              });
            } else if (evt.type === 'error') {
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
    }, [input, streaming, activeId, props, loadConvos]);

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
        React.createElement('div', { key: 'l', style: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 } }, [
          React.createElement(Icons.Sparkles, { key: 'i', size: 15, color: 'var(--accent)' }),
          React.createElement('button', {
            key: 'sw', className: 'chat-title-btn', onClick: () => setListOpen((v) => !v), title: 'Conversaciones',
          }, [
            React.createElement('span', { key: 't', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, activeTitle),
            React.createElement(Icons.ChevronDown, { key: 'c', size: 13 }),
          ]),
        ]),
        React.createElement('button', { key: 'new', className: 'btn', onClick: newChat, title: 'Nueva conversación' },
          React.createElement(Icons.Plus, { size: 14 })),
        React.createElement('button', { key: 'x', className: 'btn', onClick: onClose, title: 'Cerrar (Esc)' },
          React.createElement(Icons.Close, { size: 14 })),
      ]),

      // ---- Lista de conversaciones (desplegable) ----
      listOpen ? React.createElement('div', { key: 'list', className: 'chat-list' },
        convos.length === 0
          ? React.createElement('div', { style: { padding: '12px 14px', fontSize: 12, color: 'var(--text-3)' } }, 'Sin conversaciones previas.')
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
              React.createElement('div', { key: 'h', style: { fontSize: 14, fontWeight: 700, fontFamily: 'var(--ff-display)', marginBottom: 4 } }, 'Pregúntale a tus datos'),
              React.createElement('div', { key: 's', style: { fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5, marginBottom: 14 } },
                'Responde sobre la vista actual — ' + (props.screenLabel || props.screen || '') + ', periodo ' + (props.period || '') + '. Si algo no está en estos datos, te lo dirá.'),
              React.createElement('div', { key: 'sg', style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                SUGGESTIONS.map((s, i) => React.createElement('button', {
                  key: i, className: 'chat-suggest', onClick: () => send(s),
                }, s))),
            ])
          : messages.map((m, i) => React.createElement(Bubble, { key: i, m }))
      ),

      // ---- Composer ----
      React.createElement('div', { key: 'composer', className: 'chat-composer' }, [
        React.createElement('textarea', {
          key: 'ta', ref: taRef, className: 'chat-input', rows: 1,
          placeholder: 'Pregunta sobre lo que ves…',
          value: input, onChange: onInput, onKeyDown,
          disabled: streaming,
        }),
        React.createElement('button', {
          key: 'send', className: 'chat-send', onClick: () => send(), disabled: streaming || !input.trim(),
          title: 'Enviar (Enter)',
        }, React.createElement(streaming ? Icons.Circle : Icons.ArrowUp, { size: 16 })),
      ]),
    ]);
  }

  window.ECO_CHAT = { ChatDrawer };
})();
