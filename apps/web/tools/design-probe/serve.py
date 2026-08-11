#!/usr/bin/env python3
"""Servidor del harness de auditoría de diseño.

Sirve la SPA de `apps/web/public/eco-prototype` sin Next.js, sin base de datos y
sin Cognito, para poder medirla con las sondas de `tools/design-probe`.

Por qué existe: verificar el diseño "dentro del marco del dashboard" exige la App
COMPLETA (tema real, cabecera real, rail real). Montar un componente aislado es
diseño paralelo y engaña. Pero la App real necesita VPC + RDS + Cognito, así que
este servidor sustituye SÓLO la frontera de red:

  · Los datos de la mayoría de pantallas ya salen de `_mocks` en data.js, así que
    basta servir los estáticos.
  · Las pantallas que hacen fetch en vivo (Narrativas, la nube de Menciones, el
    historial de Alertas) reciben los JSON de `fixtures/`.

Los fixtures llevan casos borde A PROPÓSITO — nulos, enums fuera de rango, listas
vacías — porque el defecto suele estar en el caso raro, no en el feliz.

Uso:
  python3 apps/web/tools/design-probe/serve.py [puerto]
"""
import http.server, json, os, socketserver, sys, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', 'public'))
FIX = os.path.join(HERE, 'fixtures')
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8822

# Las rutas de la SPA son client-side: cualquiera de ellas devuelve el index.
SPA_ROUTES = {
    '', 'overview', 'dashboard', 'mentions', 'sentiment', 'topics',
    'narrative', 'narratives', 'geography', 'alerts', 'settings', 'search',
}

# ruta de API -> archivo de fixture. El sufijo se resuelve por prefijo, así que
# /api/narrative/<id> y /api/narrative/<id>/day caen en el fixture correcto.
API = [
    ('/api/narrative/edges', 'narrative-edges.json'),
    ('/api/narrative/', 'narrative-detail.json'),   # incluye /day, ver abajo
    ('/api/narrative', 'narrative-list.json'),
    ('/api/eco-data', 'eco-data-remote.json'),
    ('/api/overview', 'overview.json'),
    ('/api/eco-terms', 'eco-terms.json'),
    ('/api/alerts/history', 'alerts-history.json'),
    ('/api/alerts/crisis-config', 'alerts-crisis-config.json'),
    ('/api/alerts', 'alerts.json'),
    ('/api/auth/me', 'auth-me.json'),
    ('/api/agencies', 'agencies.json'),
    ('/api/eco-insights', 'eco-insights.json'),
    ('/api/eco-topic-description', 'topic-description.json'),
    ('/api/eco-geo', 'eco-geo.json'),
]


def fixture_for(path):
    if path.startswith('/api/narrative/') and path.rstrip('/').endswith('/day'):
        return 'narrative-day.json'
    for prefix, name in API:
        if path.startswith(prefix):
            return name
    return None


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, *a):
        pass  # el ruido de acceso tapa la salida de las sondas

    def _json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        # Los POST del harness (chat, refresh) no se ejercitan: 204 vacío evita
        # que un fallo de red pinte un estado de error que no es el que se audita.
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path.startswith('/api/'):
            name = fixture_for(path)
            if name:
                p = os.path.join(FIX, name)
                if os.path.exists(p):
                    with open(p, encoding='utf-8') as f:
                        return self._json(json.load(f))
            return self._json({}, 200)
        seg = path.strip('/').split('/')[0]
        if seg in SPA_ROUTES and '.' not in seg:
            return self._index()
        return super().do_GET()

    def _index(self):
        """Sirve el index de la SPA para cualquier ruta client-side."""
        with open(os.path.join(ROOT, 'eco-prototype', 'index.html'), encoding='utf-8') as f:
            body = f.read().encode()
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)


class S(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == '__main__':
    with S(('127.0.0.1', PORT), H) as httpd:
        print(f'harness en http://localhost:{PORT}  (raíz {ROOT})')
        httpd.serve_forever()
