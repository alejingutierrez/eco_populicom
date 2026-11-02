#!/usr/bin/env python3
"""Reconstruye scripts/qa/fixtures/ a partir del directorio de trabajo del laboratorio.

NO forma parte de run-all.sh: es la herramienta de PROCEDENCIA. Se usó una vez (2-nov-2026) para promover
los conjuntos de oro del laboratorio al repo, pseudonimizados. Se conserva para poder regenerarlos o
añadir conjuntos nuevos con la MISMA regla de seudónimos.

Uso:
  python3 scripts/qa/tools/build-fixtures.py --src <dir con E-clasif-ddec, F-clasif-df, K-rubrica-v2, K-agentes, I-afirmaciones>
                                              [--out scripts/qa/fixtures]

Qué hace:
  1. Recorta cada conjunto a los campos que el arnés usa (sin prompts de producción de 5 MB, sin llaves, sin correos).
  2. Pseudonimiza AUTORES y CUENTAS PERSONALES de forma estable: `usuario_<6 hex>` = sha1(sal + nombre).
     Se CONSERVAN las páginas institucionales (agencias, gobierno, municipios) y los medios (ver KEEP_* y ORG_RE).
     El mismo mapa se aplica a TODO texto (resúmenes, textos de correo, evidencias del libro de afirmaciones),
     de modo que las atribuciones siguen siendo consistentes ("según usuario_ab12cd").
  3. El TEXTO de las menciones se conserva (es público). Se enmascaran correos y teléfonos como red de seguridad.
  4. Las URL de redes se enmascaran salvo páginas de Facebook con id numérico; las de noticias se conservan.

Límites (documentados también en docs/tecnica/qa-interpretacion-v1.md):
  - La sal es pública: esto es seudonimización, no anonimización. Un diccionario de nombres conocidos podría revertirla.
  - Nombres de terceros que aparezcan DENTRO del texto de un comentario (p. ej. una etiqueta a un amigo) no se detectan.
"""
import argparse
import collections
import hashlib
import json
import os
import re
import sys

SALT = 'eco-qa-fixtures-v1'

# ---------------------------------------------------------------- qué autores se conservan
# Páginas institucionales y marcas propias del cliente (cuentas de organización, no personas).
KEEP_EXACT = {
    'Departamento de Desarrollo Económico y Comercio', 'desarrollopr', 'DDEC', 'Departamento de la Familia',
    'ADFAN - Departamento de la Familia', 'Gobierno de Puerto Rico', 'Senado Puerto Rico',
    'Negociado para el Manejo de Emergencias y Administración de Desastres-NMEAD',
    'Departamento de Recursos Naturales y Ambientales', 'Departamento de Salud de Puerto Rico',
    'Canóvanas es más', 'Cayey Ciudad Verde', 'Hecho en Puerto Rico', 'Puerto Rico Posts',
    # cuentas de negocios/marcas que destaca el DDEC (no son personas)
    'elhornodepane', 'gestionespr', 'baguettespr', 'compralealdeaqui', 'grupoguayacanpr', 'bayer4crops_pr',
    'hechoenptorico', 'laaranitapr',
    # negocios que el DDEC destaca y que se nombran en cientos de textos (no son «autores personales»)
    'El Horno de Pane', 'Monserrate Farm',
}
# Cuentas de PERSONAS conocidas (periodistas, comentaristas) que aparecen como «página pública»: se seudonimizan.
PERSONAL_PUBLIC = {
    'Jay Fonseca', 'jayfonsecapr', 'Julio Rivera-Saniel', 'julioriverasaniel', 'millymendezpr', 'Milly Méndez',
    'Sandra RodríguezCotto', 'Luis Sosa', 'jugandopelotadura', 'Jugando Pelota Dura', 'Walo HD', 'jomali',
    'Eliezer Molina', 'Rafael Lenín López', 'Zugey Lamela', 'jenniffergonzalezcolon', 'planetakike.bsky.social',
    'sandrarc.bsky.social', 'Rep. Pablo José Hernández Rivera',
}
# Páginas públicas (no comentarios de usuarios): medios, instituciones, agregadores.
PUBLIC_PAGE_TYPES = {'facebook_public', 'instagram_public', 'bluesky', 'twitter', 'tiktok', 'youtube'}
# Páginas de comentarios de usuarios: el autor es una persona salvo que esté en KEEP_EXACT.
USER_PAGE_TYPES = {'facebook', 'instagram', 'linkedin'}
# Firmas de noticias/blogs: se conserva si parece un medio u organización; si parece nombre de persona, se seudonimiza.
ORG_RE = re.compile(
    r'(Noticias|News|Notic|Radio|\bTV\b|Tele|Redacci|Peri[oó]dico|Vocero|Metro|Wapa|\.com|\.pr\b|Media|Newsroom|Staff|'
    r'Journal|Star|Digital|Blog|Cyber|Semana|Datos|Pensamiento|Comillas|Jagual|Streamline|Bot\b|Departamento|Gobierno|'
    r'Municipio|Oficina|C[aá]mara|Senado|Online|Editorial|Univisi|Primera Hora|Nuevo D[ií]a|Boricua|cb_usr|&eacute;|P&eacute;gate)',
    re.I)

EMAIL_RE = re.compile(r'[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}')
# Teléfono: con separadores (787-555-0123, (787) 555 0123, +1 787.555.0123) O corrido de 10 dígitos sin separadores (cualquier
# código de área 2-9xx, con 1 inicial opcional). El corrido exige que no lo rodeen dígitos ni letras/'_' (evita ids y hashes).
PHONE_RE = re.compile(
    r'(?<![\w])(?:\+?1[\s.\-]?)?(?:\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}|[2-9]\d{2}[2-9]\d{6})(?![\w])')
URL_RE = re.compile(r'https?://\S+')
SECRET_RE = re.compile(r'(AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._\-]{20,})')
SOCIAL_HOSTS = ('instagram.com', 'twitter.com', 'x.com', 'tiktok.com', 'linkedin.com', 'bsky.app', 'youtube.com')


def pseud(name):
    return 'usuario_' + hashlib.sha1((SALT + '|' + name).encode()).hexdigest()[:6]


class Scrubber:
    def __init__(self):
        self.authors = collections.defaultdict(set)  # nombre -> page_types vistos
        self.names = {}
        self.rx = None

    def see(self, name, page_type=None):
        if name and isinstance(name, str):
            self.authors[name].add(page_type or '')

    def keep(self, name):
        if name in KEEP_EXACT:
            return True
        if name in PERSONAL_PUBLIC:
            return False
        pts = self.authors[name]
        if pts & USER_PAGE_TYPES:
            return False
        if pts & {'news', 'blog', 'forum'}:
            return bool(ORG_RE.search(name))
        if pts & PUBLIC_PAGE_TYPES:
            return True
        # sin tipo conocido: se conserva solo si parece organización
        return bool(ORG_RE.search(name))

    def compile(self):
        self.names = {n: pseud(n) for n in self.authors if len(n) >= 4 and not self.keep(n)}
        alts = sorted(self.names, key=len, reverse=True)
        self.rx = re.compile(r'(?<![\w@])(@?)(' + '|'.join(re.escape(a) for a in alts) + r')(?![\w])') if alts else None
        return self

    def text(self, s):
        if not isinstance(s, str):
            return s
        if self.rx:
            s = self.rx.sub(lambda m: m.group(1) + self.names[m.group(2)], s)
        s = EMAIL_RE.sub('[correo]', s)
        s = SECRET_RE.sub('[secreto]', s)
        # los teléfonos se enmascaran fuera de las URL (los ids numéricos de las URL no son teléfonos)
        out, last = [], 0
        for m in URL_RE.finditer(s):
            out.append(PHONE_RE.sub('[teléfono]', s[last:m.start()]))
            out.append(m.group(0))
            last = m.end()
        out.append(PHONE_RE.sub('[teléfono]', s[last:]))
        return ''.join(out)

    def url(self, u, page_type=None):
        if not isinstance(u, str):
            return u
        m = re.match(r'^(https?://)(?:www\.)?([^/]+)(/[^?#]*)?(.*)$', u)
        if not m:
            return self.text(u)
        scheme, host, path, rest = m.groups()
        path = path or ''
        if host.endswith('facebook.com') and re.match(r'^/\d+', path or '/'):
            return self.text(u)
        if host.endswith('facebook.com') or any(host.endswith(h) for h in SOCIAL_HOSTS):
            frag = ''
            if '#channels_comment' in u:
                frag = '#channels_comment'
            elif '#' in u:
                frag = '#' + u.split('#', 1)[1][:16]
            h = hashlib.sha1((SALT + path).encode()).hexdigest()[:8]
            return f'{scheme}{host}/~{h}{frag}'
        return self.text(u)

    def deep(self, o):
        if isinstance(o, str):
            return self.text(o)
        if isinstance(o, list):
            return [self.deep(x) for x in o]
        if isinstance(o, dict):
            return {k: self.deep(v) for k, v in o.items()}
        return o


def load(p):
    with open(p, encoding='utf-8') as f:
        return json.load(f)


def dump(o, p, indent=None):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, 'w', encoding='utf-8') as f:
        json.dump(o, f, ensure_ascii=False, indent=indent, separators=(',', ':') if indent is None else None)
        f.write('\n')


def pick(d, keys):
    return {k: d.get(k) for k in keys if k in d}


def to_bool(v):
    if isinstance(v, str):
        return v.strip().lower() == 'true'
    return bool(v)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True)
    ap.add_argument('--out', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'fixtures'))
    a = ap.parse_args()
    S, O = a.src, os.path.abspath(a.out)
    E, F, K, KA, I = (os.path.join(S, x) for x in ('E-clasif-ddec', 'F-clasif-df', 'K-rubrica-v2', 'K-agentes', 'I-afirmaciones'))
    sc = Scrubber()

    # ------------------------------------------------ carga cruda
    sample = load(f'{E}/sample_full.json')
    pop = load(f'{E}/pop_judged.json')
    rest = {d['id']: d for d in load(f'{E}/rest_all.json')}
    judge208 = load(f'{E}/judge_opus.json')
    topics = load(f'{E}/ddec_topics.json')
    census_in = load(f'{F}/census_input.json')
    census_prod = {d['id']: d for f in ('census_social.json', 'census_news.json') for d in load(f'{F}/{f}')}
    j397 = load(f'{F}/judge_census.json')
    j162 = load(f'{F}/judge_opus162.json')
    ledger = load(f'{I}/claims_ledger.json')

    for r in sample + pop + list(rest.values()):
        sc.see(r.get('author'), r.get('page_type'))
    for r in census_in:
        sc.see(r.get('author'), census_prod.get(r['id'], {}).get('page_type'))
    for r in census_prod.values():
        sc.see(r.get('author'), r.get('page_type'))

    windows = sorted(f[:-5] for f in os.listdir(KA) if re.match(r'^(ddecpr|df)_\d{8}\.json$', f))
    wdata = {}
    for w in windows:
        d = load(f'{KA}/{w}.json')
        wdata[w] = d
        for k in ('negative', 'neutral', 'positive'):
            for s in d['samples'].get(k, []):
                sc.see(s.get('author'), s.get('pageType'))
        for s in d.get('todaySamples', []):
            sc.see(s.get('author'), s.get('_pageType'))
        for s in load(f'{KA}/out_{w}/samples.json'):
            sc.see(s.get('author')); sc.see(s.get('parent_author'))
        for t in d['aggregates'].get('topAuthors', []):
            sc.see(t.get('author'))
    sc.compile()
    print(f'autores vistos: {len(sc.authors)}; seudonimizados: {len(sc.names)}; conservados: {len(sc.authors) - len(sc.names)}')

    # ------------------------------------------------ DDEC
    DD = ['id', 'published_at', 'pub_type', 'page_type', 'author', 'content_source_name', 'domain', 'title', 'snippet',
          'full_text_8k', 'bw_sentiment', 'nlp_sentiment', 'nlp_pertinence', 'cat']
    s208 = []
    for r in sample:
        x = pick(r, DD)
        x['url'] = sc.url(r.get('url'))
        s208.append(x)
    jk = ['tone', 'stance_ddec', 'target', 'intent', 'about_ddec_strict', 'pertinence']
    j208 = [{'id': j['id'], **pick(j['verdict'], jk)} for j in judge208]
    pop_rows = []
    for r in pop:
        x = pick(r, ['id', 'published_at', 'pub_type', 'page_type', 'author', 'title', 'snippet', 'bw_sentiment', 'nlp_sentiment', 'nlp_pertinence', 'cat', 'grp'])
        rr = rest.get(r['id'], {})
        for k in ('full_text_8k', 'content_source_name', 'domain'):
            x[k] = r.get(k) if r.get(k) is not None else rr.get(k)
        x['judge'] = pick(r.get('judge') or {}, jk)
        pop_rows.append(x)
    dump(sc.deep(s208), f'{O}/ddec/sample208.json')
    dump(sc.deep(j208), f'{O}/ddec/judge208.json')
    dump(sc.deep(pop_rows), f'{O}/ddec/pop867.json')
    dump(topics, f'{O}/ddec/topics.json')

    # ------------------------------------------------ DF
    df_rows = []
    for r in census_in:
        p = census_prod.get(r['id'], {})
        x = pick(r, ['id', 'title', 'snippet', 'full_text', 'domain', 'content_source_name', 'author', 'published_at', 'bw_sentiment'])
        x['page_type'] = p.get('page_type')
        x['nlp_sentiment'] = p.get('nlp_sentiment')
        x['nlp_pertinence'] = p.get('nlp_pertinence')
        df_rows.append(x)
    dump(sc.deep(df_rows), f'{O}/df/census404.json')
    # plantilla del prompt de producción del DF: el prompt de la primera mención con el bloque «MENCIÓN» como marcador.
    # Se verifica que plantilla + bloque reproduce los 404 prompts de producción (build_prod_prompts.ts) carácter por carácter.
    prod_prompts = {d['id']: d['prompt'] for d in load(f'{F}/prompts_prod.json')}
    first = next(iter(prod_prompts.values()))
    tpl = first[:first.index('MENCIÓN:\n')] + '{{MENTION_BLOCK}}' + first[first.index('Llama a la herramienta'):]
    nn = lambda v, d: d if v is None else v
    bad = 0
    for m in census_in:
        full = m.get('full_text')
        texto = (full[:8000] + ('\n[…texto recortado]' if len(full) > 8000 else '')) if full else nn(m.get('snippet'), '(sin texto)')
        hint = f"\nSentimiento Brandwatch (referencia): {m['bw_sentiment']}" if m.get('bw_sentiment') else ''
        block = (f"MENCIÓN:\nTítulo: {nn(m.get('title'), '(sin título)')}\nTexto: {texto}\nFuente: {nn(m.get('content_source_name'), m.get('domain'))} ({m.get('domain')})\n"
                 f"Autor: {nn(m.get('author'), 'Desconocido')}\nFecha: {m['published_at']}{hint}\n\n")
        bad += tpl.replace('{{MENTION_BLOCK}}', block) != prod_prompts[m['id']]
    assert bad == 0, f'la plantilla del DF no reproduce {bad} prompts de producción'
    os.makedirs(f'{O}/df', exist_ok=True)
    with open(f'{O}/df/prompt-template.txt', 'w', encoding='utf-8') as f:
        f.write(tpl)
    dk = ['sentimiento_hacia_df', 'hecho_malo_para_df', 'pertinencia', 'tipo_texto', 'objeto_de_la_critica']
    dump(sc.deep([{'id': j['id'], **{k: (to_bool(j[k]) if k == 'hecho_malo_para_df' else j[k]) for k in dk}} for j in j397]), f'{O}/df/judge397.json')
    dump(sc.deep([{'id': j['id'], **{k: (to_bool(j[k]) if k == 'hecho_malo_para_df' else j[k]) for k in dk}} for j in j162]), f'{O}/df/judge162.json')

    # ------------------------------------------------ referencias (corridas del laboratorio del 2-nov, para --cached)
    def slim(path):
        out = []
        for d in load(path):
            if 'error' in d:
                continue
            out.append({'id': d['id'], 'sentiment': d['sentiment'], 'adverse_fact': to_bool(d.get('adverse_fact')), 'pertinence': d['pertinence']})
        return out
    refs = {'ddec208.json': 'ddec_opus_b.json', 'ddec208.b.json': 'ddec_opus_b2.json', 'ddec867.json': 'pop_sonnet_c.json',
            'df397.json': 'df_sonnet.json', 'df162.json': 'df_opus162_b.json'}
    ref_models = {'ddec208': 'us.anthropic.claude-opus-4-6-v1', 'ddec867': 'us.anthropic.claude-sonnet-4-6',
                  'df397': 'us.anthropic.claude-sonnet-4-6', 'df162': 'us.anthropic.claude-opus-4-6-v1'}
    for dst, src in refs.items():
        dump(slim(f'{K}/{src}'), f'{O}/refs/{dst}')
        if not dst.endswith('.b.json'):  # metadatos que lee eval-classification.py (modelo de la corrida de referencia)
            dump({'set': dst[:-5], 'model': ref_models[dst[:-5]], 'seed': None, 'limit': None, 'temperature': 0.1,
                  'note': 'corrida de referencia del laboratorio (2-nov-2026)'}, f'{O}/refs/{dst}.meta.json', indent=1)

    # ------------------------------------------------ ventanas de correo + textos
    for w in windows:
        d = wdata[w]
        od = f'{KA}/out_{w}'
        win = {k: d[k] for k in ('agency', 'window', 'totals', 'deltaVsPrev', 'dailySeries', 'topics', 'aggregates', 'samples', 'todaySamples')}
        for s in win['todaySamples']:
            s['_url'] = sc.url(s.get('_url'))
        for k in win['samples']:
            for s in win['samples'][k]:
                s['url'] = sc.url(s.get('url'))
        dump(sc.deep(win), f'{O}/windows/{w}/window.json')
        samples = load(f'{od}/samples.json')
        dump(sc.deep(samples), f'{O}/windows/{w}/samples.json')
        dump(sc.deep(load(f'{od}/facts.json')), f'{O}/windows/{w}/facts.json')
        base = {'headline': d['llm']['daily']['headline'], 'paragraph': d['llm']['daily']['paragraph'],
                'highlights': d['llm']['daily']['highlights'], 'insights': d['llm']['insights']}
        dump(sc.deep(base), f'{O}/windows/{w}/text.base.json', indent=1)
        dump(sc.deep(load(f'{od}/final.json')['final']), f'{O}/windows/{w}/text.team.json', indent=1)
        for nm in ('base', 'equipo'):
            dump(sc.deep(load(f'{od}/judge_{nm}.json')), f'{O}/refs/windows/{w}/judge_{"team" if nm == "equipo" else nm}.json', indent=1)

    # ------------------------------------------------ libro de afirmaciones
    dump(sc.deep(ledger), f'{O}/claims/claims_ledger.json', indent=1)

    # ------------------------------------------------ hoja de revisión humana a ciegas
    hr = f'{K}/hoja_revision_ciega.md'
    with open(hr, encoding='utf-8') as f:
        sheet = f.read()
    os.makedirs(f'{O}/human-review', exist_ok=True)
    with open(f'{O}/human-review/hoja_revision_ciega.md', 'w', encoding='utf-8') as f:
        f.write(sc.text(sheet))
    key = load(f'{K}/hoja_clave_ids.json')
    dump(key, f'{O}/human-review/hoja_clave_ids.json', indent=1)
    with open(f'{O}/human-review/respuestas-plantilla.csv', 'w', encoding='utf-8') as f:  # alternativa a rellenar el .md
        f.write('n,S,H,P\n' + ''.join(f"{k['n']},,,\n" for k in key))
    import subprocess  # hoja ciega de 12 textos de correo (usa los fixtures recién escritos)
    subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'make-text-sheet.py')], check=True)
    print('listo ->', O)


if __name__ == '__main__':
    main()
