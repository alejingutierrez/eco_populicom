"""Prompts del laboratorio de clasificación (rúbrica v2 de ECO) y definición de los conjuntos de oro.

Réplica del prompt de clasificación del processor tal como corría en producción el 2-nov-2026
(infra/lambda/processor/index.ts @ 3e5cfaa) con la sección «REGLAS DE SENTIMIENTO» sustituida por la
rúbrica v2 (spec sección 6 y anexo A): postura hacia la agencia + hecho adverso + pertinencia de comentarios.

Este módulo es el origen del laboratorio, NO el código de producción: cuando WP-1/WP-2 lleven la rúbrica v2 al
processor, la fuente de verdad pasa a ser ese código y este archivo queda como referencia congelada (ver README).
"""
import re

from qa_common import fx, load_json, by_id

NLP_TEXT_LIMIT = 8000

DDEC_NAME = 'el Departamento de Desarrollo Económico y Comercio (DDEC)'
DDEC_NAME_PLAIN = 'Departamento de Desarrollo Económico y Comercio'
DF_NAME = 'Departamento de la Familia'

DDEC_ROUTING_RULES = """- Si el post anuncia el NÚMERO DE EMPLEOS como hecho central → topic = empleo-fuerza-laboral. Si habla de la DECISIÓN/SECTOR corporativo → topic = inversion-extranjera.
- Misión comercial España: si centra en "empresas PR exportando" → comercio-exterior; si centra en "atraer capital ES a PR" → inversion-extranjera.
- Hotel boutique con créditos Ley 60: si la conversación es "caso de éxito turístico" → turismo-economia; si es "controversia Ley 60" → incentivos-economicos.
- Compañía Turismo separación: legislacion-economica (NO turismo-economia).
- OGPe / PC 1183 / inspecciones bomberos: si discute "permisos como sistema" → permisos-reforma; si discute "DDEC como agencia receptora/cedente de funciones" → legislacion-economica.
- Críticas dirigidas a la PERSONA del Secretario (credibilidad, gestión, viajes): topic = gestion-secretario con sentiment=negativo; reserva criticas-controversias para críticas al PROYECTO o al MODELO económico, no a la persona.
- FITUR: turismo-economia.fitur-y-promocion-internacional (NO comercio-exterior)."""

CLASSIFY_TOOL = {
    'name': 'classify_mention',
    'description': 'Registra la clasificación NLP de una mención.',
    'input_schema': {'type': 'object', 'properties': {
        'sentiment': {'type': 'string', 'enum': ['negativo', 'neutral', 'positivo']},
        'adverse_fact': {'type': 'boolean'},
        'emotions': {'type': 'array', 'maxItems': 3, 'items': {'type': 'string', 'enum': ['frustración', 'enojo', 'alivio', 'gratitud', 'preocupación', 'sarcasmo', 'indiferencia']}},
        'pertinence': {'type': 'string', 'enum': ['alta', 'media', 'baja']},
        'topics': {'type': 'array', 'maxItems': 3, 'items': {'type': 'object', 'properties': {'topic_slug': {'type': 'string'}, 'subtopic_slug': {'type': 'string'}, 'confidence': {'type': 'number'}}, 'required': ['topic_slug', 'confidence']}},
        'municipalities': {'type': 'array', 'items': {'type': 'string'}},
        'summary': {'type': 'string'}},
        'required': ['sentiment', 'adverse_fact', 'pertinence', 'summary']},
}


def _nn(v, default):
    """Equivale al `??` de JavaScript: solo null/None cae al valor por defecto (la cadena vacía se conserva)."""
    return default if v is None else v


# ---------------------------------------------------------------- rúbrica v2 (anexo A del spec)
def rubric(A, comments):
    com = ''
    if comments:
        com = f"""
COMENTARIOS A PUBLICACIONES DE {A}:
- En un comentario, «Título» es la publicación de {A} (contexto: NO lo escribió el usuario) y «Texto» es el comentario: clasifica SOLO el comentario.
- Un comentario que responde al contenido de la publicación (la elogia, la critica, pregunta por lo que ofrece o anuncia, pide información sobre el negocio, programa o servicio destacado) es pertinente: "media" como mínimo; "alta" si habla del programa, servicio o gestión de {A}. Solo es "baja" si es spam, un saludo o una conversación entre usuarios sin relación con la publicación.
"""
    return f"""SENTIMIENTO = POSTURA del autor/medio HACIA {A} (su contenido, programas, servicios, gestión, secretario/a o personal), en la VOZ del propio autor:
- "positivo": el autor elogia, agradece, defiende o celebra a {A}, o a sus programas, servicios o contenido. Una reacción breve de aplauso o elogio a una publicación de {A}, o a la iniciativa o negocio que {A} destaca en ella (por ejemplo «Excelente», «Bravo», «Qué chévere, mucho éxito»), cuenta como positivo hacia {A}.
- "negativo": el autor critica, culpa, acusa, reclama o se queja contra {A}, sus programas, servicios, contenido o gestión (incluye reclamos ciudadanos, preguntas retóricas de reclamo, y el reclamo de que una publicación de {A} omite información que el público necesita), o usa un encuadre acusatorio o burlón con juicios propios.
- "neutral": informa hechos, plazos, declaraciones o críticas ATRIBUIDAS a terceros sin sumarse a ellas (aunque el hecho sea malo para {A}); publicaciones propias de {A}; preguntas o respuestas prácticas (direcciones, teléfonos, etiquetas a amigos); opiniones sobre un tercero que NO son una reacción a la publicación de {A} (por ejemplo una experiencia personal con un negocio); y lo negativo dirigido a OTRO actor cuando {A} es solo contexto.
- No uses la pista de otras herramientas: decide solo por el texto. No hay un porcentaje esperado de ninguna categoría.

HECHO ADVERSO (campo adverse_fact):
- true si el HECHO que se reporta o discute es desfavorable para la reputación de {A} (escándalo, investigación, demanda, incumplimiento, fallo operativo, queja ciudadana sobre un servicio), con independencia del tono del autor. Una nota informativa sobre un escándalo es sentimiento "neutral" y adverse_fact=true.

PERTINENCIA:
- "alta" si {A}, una de sus administraciones, programas o su secretario/a es el tema principal. "media" si es una parte sustancial pero no el tema principal. "baja" si se menciona de paso o el texto trata de otra cosa.
{com}
"""


def transform(prompt, A, kind_block, comments):
    """Quita la pista de Brandwatch y reemplaza «REGLAS DE SENTIMIENTO … EMOTIONS:» por la rúbrica v2."""
    prompt = re.sub(r'\nSentimiento Brandwatch \(referencia\): \w+', '', prompt)
    i = prompt.find('REGLAS DE SENTIMIENTO')
    k = prompt.find('EMOTIONS:')
    assert 0 < i < k, 'el prompt base no tiene las secciones esperadas'
    prompt = prompt[:i] + rubric(A, comments) + prompt[k:]
    if kind_block:
        prompt = prompt.replace('\nLlama a la herramienta', '\n' + kind_block + '\nLlama a la herramienta', 1)
    return prompt


# ---------------------------------------------------------------- prompt base DDEC (sin pista de Brandwatch)
_TOPICS = None


def ddec_base_prompt(r):
    global _TOPICS
    if _TOPICS is None:
        _TOPICS = load_json(fx('ddec', 'topics.json'))
    topic_slugs = ', '.join(t['slug'] for t in _TOPICS)
    menu = '\n'.join(
        (f"  • {t['slug']} — {t['name']}:\n" + '\n'.join(f"      - {s['slug']} — {s['description']}" for s in t['subtopics'])) if t['subtopics']
        else f"  • {t['slug']} — {t['name']}: (sin subtopics)" for t in _TOPICS)
    full = r.get('full_text_8k')
    if full:
        texto = full[:NLP_TEXT_LIMIT] + ('\n[…texto recortado]' if len(full) > NLP_TEXT_LIMIT else '')
    else:
        texto = r.get('snippet') or '(sin texto)'
    source = f"{r.get('content_source_name') or r.get('domain')} ({r.get('domain')})"
    return f"""Eres un analista de social listening especializado en Puerto Rico.
Analiza esta mención sobre {DDEC_NAME_PLAIN}.

MENCIÓN:
Título: {r.get('title') or '(sin título)'}
Texto: {texto}
Fuente: {source}
Autor: {r.get('author') or 'Desconocido'}
Fecha: {r['published_at']}

Llama a la herramienta classify_mention con los campos correctos.

REGLAS DE SENTIMIENTO (muy importantes — los datos actuales tienen sesgo positivo):
- (reemplazadas por la rúbrica v2)

PERTINENCIA:
- "alta" si la mención TRATA sobre {DDEC_NAME_PLAIN}. "media" si {DDEC_NAME_PLAIN} es secundaria. "baja" si {DDEC_NAME_PLAIN} se menciona de paso.

EMOTIONS:
- del set [frustración, enojo, alivio, gratitud, preocupación, sarcasmo, indiferencia]. Máximo 3. Omite el campo si el texto es meramente factual.

TOPICS Y SUBTOPICS (menú jerárquico — el subtopic_slug DEBE pertenecer al topic_slug elegido):
{menu}

REGLAS DE TOPICS/SUBTOPICS:
- topic_slug obligatorio. Usa SOLO uno de: {topic_slugs}.
- subtopic_slug opcional pero MUY recomendado. Debe ser uno de los listados bajo el topic_slug elegido. NUNCA mezcles un subtopic de un topic con otro topic.
- Máximo 3 tópicos por mención. confidence: 0.0 a 1.0.

REGLAS DE ROUTING CROSS-TOPIC (cuando la mención toca varios temas, elige UNO primario):
{DDEC_ROUTING_RULES}

MUNICIPALITIES:
- Slugs de los 78 municipios de PR (ej: san-juan, ponce, bayamon, mayaguez).
- Incluye TODO municipio mencionado por nombre, barrio (Santurce→san-juan, Río Piedras→san-juan, Levittown→toa-baja, Condado→san-juan) o contexto geográfico claro.
- Si el texto menciona sólo "Puerto Rico" sin municipio, deja el array vacío."""


def ddec_prompt(r):
    k = ''
    if r['cat'] in ('fb_comment', 'ig_comment', 'li_comment'):
        k = 'TIPO DE MENCIÓN: COMENTARIO de un usuario en una publicación del propio DDEC.'
    elif r['cat'] == 'own_post':
        k = 'TIPO DE MENCIÓN: publicación propia del DDEC (el autor es el DDEC).'
    return transform(ddec_base_prompt(r), DDEC_NAME, k, True)


# ---------------------------------------------------------------- DF: plantilla del prompt de producción
_DF_TPL = None


def df_base_prompt(m):
    global _DF_TPL
    if _DF_TPL is None:
        _DF_TPL = open(fx('df', 'prompt-template.txt'), encoding='utf-8').read()
    full = m.get('full_text')
    if full:
        texto = full[:NLP_TEXT_LIMIT] + ('\n[…texto recortado]' if len(full) > NLP_TEXT_LIMIT else '')
    else:
        texto = _nn(m.get('snippet'), '(sin texto)')
    hint = f"\nSentimiento Brandwatch (referencia): {m['bw_sentiment']}" if m.get('bw_sentiment') else ''
    block = (f"MENCIÓN:\nTítulo: {_nn(m.get('title'), '(sin título)')}\nTexto: {texto}\n"
             f"Fuente: {_nn(m.get('content_source_name'), m.get('domain'))} ({m.get('domain')})\n"
             f"Autor: {_nn(m.get('author'), 'Desconocido')}\nFecha: {m['published_at']}{hint}\n\n")
    return _DF_TPL.replace('{{MENTION_BLOCK}}', block)


def df_prompt(m):
    return transform(df_base_prompt(m), DF_NAME, '', False)


# ---------------------------------------------------------------- conjuntos de oro
def load_sets():
    """name -> {rows, judge (id -> veredicto), prompt (fn), kind}. Se carga bajo demanda."""
    return {
        'ddec208': ('ddec', lambda: (load_json(fx('ddec', 'sample208.json')), by_id(load_json(fx('ddec', 'judge208.json'))), None)),
        'ddec867': ('ddec', lambda: (load_json(fx('ddec', 'pop867.json')), None, None)),
        'df397': ('df', lambda: (load_json(fx('df', 'census404.json')), by_id(load_json(fx('df', 'judge397.json'))), None)),
        'df162': ('df', lambda: (load_json(fx('df', 'census404.json')), by_id(load_json(fx('df', 'judge162.json'))), None)),
    }


def get_set(name):
    """Devuelve (rows_to_classify, judge, prompt_fn). df* solo clasifica los ids con juez."""
    kind, loader = load_sets()[name]
    rows, judge, _ = loader()
    if judge is not None:
        rows = [r for r in rows if r['id'] in judge]
    return rows, judge, (ddec_prompt if kind == 'ddec' else df_prompt)
