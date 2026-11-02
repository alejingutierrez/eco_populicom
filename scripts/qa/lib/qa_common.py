"""Utilidades comunes del arnés de calidad (scripts/qa). Solo biblioteca estándar de Python 3.

- Carga del .env SIN imprimir nada (REPO_ENV, <repo>/.env o el .env del checkout principal si estás en un worktree).
- Llamadas a Bedrock con la AWS CLI (misma vía que el laboratorio): herramienta forzada, reintentos ante throttling,
  contador de llamadas/tokens y tope duro de llamadas (ECO_QA_MAX_CALLS o --max-calls) para acotar el costo.
- Muestreo con semilla fija, pool de hilos y utilidades de tablas.
"""
import atexit
import concurrent.futures as cf
import json
import os
import random
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

QA_DIR = Path(__file__).resolve().parents[1]          # scripts/qa
REPO = QA_DIR.parents[1]                              # raíz del repo (o del worktree)
FIXTURES = QA_DIR / 'fixtures'

# Modelos: sonnet por defecto (jueces y clasificación masiva); opus solo bajo demanda.
MODELS = {
    'sonnet': os.environ.get('ECO_QA_SONNET_ID', 'us.anthropic.claude-sonnet-4-6'),
    'opus': os.environ.get('ECO_QA_OPUS_ID', 'us.anthropic.claude-opus-4-6-v1'),
}
DEFAULT_SEED = 20261102


def model_id(name):
    return MODELS.get(name, name)


# ---------------------------------------------------------------- entorno
def env_candidates():
    c = []
    if os.environ.get('REPO_ENV'):
        c.append(Path(os.environ['REPO_ENV']))
    c.append(REPO / '.env')
    try:  # en un worktree el .env vive en el checkout principal
        common = subprocess.run(['git', '-C', str(REPO), 'rev-parse', '--git-common-dir'], capture_output=True, text=True).stdout.strip()
        if common:
            c.append((Path(common) if os.path.isabs(common) else REPO / common).resolve().parent / '.env')
    except Exception:
        pass
    return c


def load_env(required=True):
    """Carga el .env en os.environ (sin sobrescribir lo ya definido). Devuelve la ruta usada. Nunca imprime valores."""
    for p in env_candidates():
        if p.is_file():
            for line in p.read_text(encoding='utf-8').splitlines():
                line = line.strip()
                if not line or line.startswith('#') or '=' not in line:
                    continue
                k, v = line.split('=', 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
            os.environ.setdefault('AWS_REGION', 'us-east-1')
            os.environ.setdefault('AWS_DEFAULT_REGION', os.environ['AWS_REGION'])
            return p
    if required:
        sys.exit('No encontré .env. Define REPO_ENV=/ruta/al/.env (credenciales AWS) o colócalo en la raíz del repo.')
    return None


# ---------------------------------------------------------------- E/S
def load_json(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def save_json(obj, path, indent=1):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, indent=indent)
        f.write('\n')


def fx(*parts):
    return FIXTURES.joinpath(*parts)


def by_id(rows, key='id'):
    return {r[key]: r for r in rows}


# ---------------------------------------------------------------- muestreo y paralelismo
def sample_ids(ids, limit=None, seed=DEFAULT_SEED):
    """Submuestra reproducible: mismo (ids, limit, seed) -> mismos ids, en orden estable."""
    ids = sorted(ids)
    if not limit or limit >= len(ids):
        return ids
    rng = random.Random(seed)
    pick = set(rng.sample(ids, limit))
    return [i for i in ids if i in pick]


def run_pool(fn, items, workers=5, every=20, label=''):
    """Aplica fn a cada item en paralelo; imprime avance. Devuelve resultados en orden."""
    out = [None] * len(items)
    done = 0
    t0 = time.time()
    with cf.ThreadPoolExecutor(max(1, workers)) as ex:
        futs = {ex.submit(fn, it): k for k, it in enumerate(items)}
        for fu in cf.as_completed(futs):
            out[futs[fu]] = fu.result()
            done += 1
            if done % every == 0 or done == len(items):
                print(f'  {label} {done}/{len(items)} ({int(time.time() - t0)} s)', flush=True)
    return out


# ---------------------------------------------------------------- Bedrock
class BudgetExceeded(RuntimeError):
    pass


class Usage:
    """Contador global de llamadas y tokens, con tope duro."""

    def __init__(self):
        self.lock = threading.Lock()
        self.calls = {}
        self.tokens = {}
        self.max_calls = int(os.environ['ECO_QA_MAX_CALLS']) if os.environ.get('ECO_QA_MAX_CALLS') else None

    def reserve(self, model):
        with self.lock:
            total = sum(self.calls.values())
            if self.max_calls is not None and total >= self.max_calls:
                raise BudgetExceeded(f'tope de {self.max_calls} llamadas a Bedrock alcanzado (--max-calls / ECO_QA_MAX_CALLS)')
            self.calls[model] = self.calls.get(model, 0) + 1

    def add_tokens(self, model, usage):
        with self.lock:
            t = self.tokens.setdefault(model, [0, 0])
            t[0] += int((usage or {}).get('input_tokens', 0))
            t[1] += int((usage or {}).get('output_tokens', 0))

    def summary(self):
        if not self.calls:
            return 'Bedrock: 0 llamadas.'
        parts = []
        for m, n in sorted(self.calls.items()):
            ti, to = self.tokens.get(m, [0, 0])
            parts.append(f'{m.split(".")[-1]}: {n} llamadas, {ti:,} tokens de entrada, {to:,} de salida')
        return 'Bedrock · ' + ' | '.join(parts)


USAGE = Usage()


def _dump_usage():
    """Si ECO_QA_USAGE_OUT está definido, deja el uso de este proceso en ese JSON (lo agrega run-all.sh)."""
    path = os.environ.get('ECO_QA_USAGE_OUT')
    if path and USAGE.calls:
        try:
            save_json({'calls': USAGE.calls, 'tokens': USAGE.tokens}, path)
        except OSError:
            pass


atexit.register(_dump_usage)


def bedrock_tool(model, user, tool, system=None, max_tokens=1024, temperature=0.0, retries=6, timeout=300):
    """Invoca un modelo de Bedrock forzando una herramienta; devuelve el `input` de la herramienta (dict).

    Lanza RuntimeError si tras los reintentos no hay tool_use. No imprime credenciales.
    """
    mid = model_id(model)
    USAGE.reserve(mid)
    body = {'anthropic_version': 'bedrock-2023-05-31', 'max_tokens': max_tokens, 'temperature': temperature,
            'messages': [{'role': 'user', 'content': user}], 'tools': [tool],
            'tool_choice': {'type': 'tool', 'name': tool['name']}}
    if system:
        body['system'] = system
    err = ''
    with tempfile.TemporaryDirectory(prefix='ecoqa-') as td:
        bp, op = os.path.join(td, 'in.json'), os.path.join(td, 'out.json')
        with open(bp, 'w', encoding='utf-8') as f:
            json.dump(body, f)
        for attempt in range(retries):
            r = subprocess.run(['aws', 'bedrock-runtime', 'invoke-model', '--model-id', mid, '--content-type', 'application/json',
                                '--accept', 'application/json', '--cli-binary-format', 'raw-in-base64-out',
                                '--cli-read-timeout', str(timeout), '--body', f'fileb://{bp}', op],
                               capture_output=True, text=True)
            if r.returncode == 0:
                resp = load_json(op)
                USAGE.add_tokens(mid, resp.get('usage'))
                tu = next((b for b in resp.get('content', []) if b.get('type') == 'tool_use'), None)
                if tu:
                    return dict(tu['input'])
                err = 'sin tool_use'
            else:
                err = r.stderr[-300:]
                if any(t in err for t in ('ExpiredToken', 'security token', 'UnrecognizedClient', 'AccessDenied', 'could not be found', 'Unable to locate credentials')):
                    break  # reintentar no ayuda
            time.sleep(min(5 * (attempt + 1), 30))
    raise RuntimeError(err or 'error desconocido de Bedrock')


# ---------------------------------------------------------------- impresión
def pct(a, b, nd=0):
    return f'{100 * a / b:.{nd}f} %' if b else '—'


def pctv(a, b):
    return 100 * a / b if b else None


def nss(c, n=None):
    n = n if n is not None else sum(c.values())
    return round(100 * (c.get('positivo', 0) - c.get('negativo', 0)) / n, 1) if n else None


def fmt_nss(v):
    return '—' if v is None else f'{v:+.1f}'.replace('-', '−')


def table(headers, rows, aligns=None):
    """Tabla de texto con barras (compatible con Markdown)."""
    rows = [[str(c) for c in r] for r in rows]
    w = [max(len(str(h)), *(len(r[i]) for r in rows)) if rows else len(str(h)) for i, h in enumerate(headers)]
    aligns = aligns or ['l'] * len(headers)

    def fmt(cells):
        return '| ' + ' | '.join(c.ljust(w[i]) if aligns[i] == 'l' else c.rjust(w[i]) for i, c in enumerate(cells)) + ' |'
    sep = '|' + '|'.join(('-' * (w[i] + 2)) if aligns[i] == 'l' else ('-' * (w[i] + 1) + ':') for i in range(len(headers))) + '|'
    return '\n'.join([fmt([str(h) for h in headers]), sep] + [fmt(r) for r in rows])
