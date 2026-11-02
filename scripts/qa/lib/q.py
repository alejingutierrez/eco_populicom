#!/usr/bin/env python3
"""Consulta SOLO LECTURA a la base de producción vía el lambda eco-migration (acción custom-query).

Uso:
  python3 scripts/qa/lib/q.py "SELECT ..."                 # imprime una fila JSON por línea
  python3 scripts/qa/lib/q.py - < consulta.sql             # SQL por stdin
  python3 scripts/qa/lib/q.py "SELECT ..." --out f.json    # guarda TODAS las filas en f.json
  python3 scripts/qa/lib/q.py "SELECT ..." --max 30000     # tope de caracteres impresos (default 15000)

Reglas (del validador del lambda y de la memoria del proyecto):
  - la consulta debe EMPEZAR con SELECT; un CTE se envuelve: SELECT * FROM ( WITH x AS (...) SELECT ... ) z
  - una sola sentencia; este script rechaza además cualquier palabra de escritura (INSERT, UPDATE, DELETE, DROP, ALTER, ...).
  - SIEMPRE acota: LIMIT y rango de fechas. Una lectura larga sobre `mentions` bloqueó un ALTER en el incidente de la
    investigación (riesgo R5 del spec). Esta herramienta no impone el límite: eres tú.
Credenciales: las del .env (REPO_ENV o <repo>/.env o el del checkout principal); nunca se imprimen.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import qa_common as qc  # noqa: E402

WRITE_RE = re.compile(r'\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|copy|call|do|vacuum|reindex)\b', re.I)


def check_select_only(sql):
    body = re.sub(r"'(?:[^']|'')*'", "''", sql)  # ignora literales de texto
    body = re.sub(r'--[^\n]*', '', body)
    if body.count(';') > (1 if body.rstrip().endswith(';') else 0):
        raise SystemExit('solo una sentencia por consulta')
    m = WRITE_RE.search(body)
    if m:
        raise SystemExit(f'consulta rechazada: contiene «{m.group(1)}»; este arnés solo lee')


def select(sql, timeout=600):
    """Ejecuta un SELECT y devuelve la lista de filas (dicts). Lanza SystemExit con el motivo si falla."""
    sql = sql.strip().rstrip(';')
    if not re.match(r'^\s*select\b', sql, re.I):
        sql = f'SELECT * FROM ( {sql} ) z'  # el lambda exige que empiece con SELECT
    check_select_only(sql)
    qc.load_env()
    payload = json.dumps({'action': 'custom-query', 'query': sql})
    with tempfile.TemporaryDirectory(prefix='ecoqa-') as td:
        out = os.path.join(td, 'out.json')
        r = subprocess.run(['aws', 'lambda', 'invoke', '--function-name', 'eco-migration', '--payload', payload,
                            '--cli-binary-format', 'raw-in-base64-out', '--cli-read-timeout', str(timeout),
                            '--cli-connect-timeout', '10', out], capture_output=True, text=True)
        if r.returncode != 0:
            raise SystemExit('AWS CLI error: ' + r.stderr[:500])
        d = qc.load_json(out)
    if 'errorMessage' in d:
        raise SystemExit('LAMBDA ERROR: ' + d['errorMessage'][:500])
    body = d.get('body')
    res = json.loads(body) if isinstance(body, str) else d
    if isinstance(res, dict) and res.get('error'):
        raise SystemExit('QUERY ERROR: ' + json.dumps(res)[:500])
    return res.get('rows', res) if isinstance(res, dict) else res


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('sql')
    ap.add_argument('--out')
    ap.add_argument('--max', type=int, default=15000)
    a = ap.parse_args()
    sql = sys.stdin.read() if a.sql == '-' else a.sql
    rows = select(sql)
    if a.out:
        qc.save_json(rows, a.out)
        print(f'[{len(rows)} filas guardadas en {a.out}]')
    total = 0
    for row in rows:
        line = json.dumps(row, ensure_ascii=False, default=str)
        total += len(line) + 1
        if total > a.max:
            print(f'… (truncado a {a.max} caracteres; {len(rows)} filas en total — usa --out o LIMIT)')
            break
        print(line)
    if not rows:
        print('(0 filas)')


if __name__ == '__main__':
    main()
