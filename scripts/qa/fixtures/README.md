# Fixtures del arnés de calidad (conjuntos de oro pseudonimizados)

Fotos del 2-nov-2026 del laboratorio de la investigación de interpretación. **No se editan a mano**: se regeneran con
`scripts/qa/tools/build-fixtures.py` desde el directorio del laboratorio (que no está en el repo). Todo está pseudonimizado:
los autores y las cuentas personales se reemplazan por `usuario_<6 hex>` (el mismo mapa en todos los archivos, de modo que las
atribuciones siguen consistentes); se conservan las páginas institucionales (agencias, gobierno, municipios) y los medios.
El texto de las menciones es público y se conserva. No hay correos, teléfonos ni llaves.

| Ruta | Contenido | Quién lo usa |
|---|---|---|
| `ddec/sample208.json` | 208 menciones del DDEC (muestra estratificada por categoría) con las etiquetas de producción (`nlp_sentiment`, `nlp_pertinence`) | `classify-lab.py`, `eval-classification.py` |
| `ddec/judge208.json` | Veredicto del juez Opus por mención: `tone`, `stance_ddec`, `target`, `intent`, `about_ddec_strict`, `pertinence` | `eval-classification.py`, `human-kappa.py` |
| `ddec/pop867.json` | Semana completa del DDEC (25-oct a 1-nov, 867 menciones no duplicadas) con etiquetas de producción y veredicto del juez Sonnet | `classify-lab.py` (`ddec867`) |
| `ddec/topics.json` | Menú de tópicos del DDEC que entra al prompt | `lib/lab_prompts.py` |
| `df/census404.json` | 404 menciones del Departamento de la Familia (24-oct a 1-nov) con texto completo y etiquetas de producción | `classify-lab.py` |
| `df/judge397.json` | Juez Sonnet sobre 397 de ellas: `sentimiento_hacia_df`, `hecho_malo_para_df`, `pertinencia`, `tipo_texto`, `objeto_de_la_critica` | `eval-classification.py` |
| `df/judge162.json` | Juez Opus sobre una submuestra de 162 (lecturas ciegas incluidas) | `eval-classification.py` (`df162`) |
| `df/prompt-template.txt` | Prompt de producción del DF (contexto de la agencia, tópicos, reglas de ruteo) con `{{MENTION_BLOCK}}` | `lib/lab_prompts.py` |
| `refs/*.json` + `*.meta.json` | Corridas de referencia de la rúbrica v2 del laboratorio (solo `id`, `sentiment`, `adverse_fact`, `pertinence`). `ddec208.b.json` es la segunda corrida (estabilidad) | `--cached`, `human-kappa.py` |
| `refs/windows/<ventana>/judge_{team,base}.json` | Veredictos del juez Opus sobre los textos de cada ventana | `compose-judge.py --cached` |
| `windows/<ventana>/window.json` | Ventana reproducible del correo diario (totales, serie diaria, tópicos, agregados, muestras) construida con `repro.ts` | `compose-judge.py` |
| `windows/<ventana>/samples.json` | Muestras anotadas (tipo, día, publicación original y antigüedad del comentario) | `compose-judge.py` |
| `windows/<ventana>/facts.json` | Lista de hechos numéricos de la ventana (única fuente de cifras permitidas) | `compose-judge.py` |
| `windows/<ventana>/text.base.json` | Texto del correo con el modelo único de producción (línea base) | `compose-judge.py` |
| `windows/<ventana>/text.team.json` | Texto del prototipo de equipo de agentes (analista, redactor, QA, corrector, red de seguridad) | `compose-judge.py` |
| `claims/claims_ledger.json` | Libro de 127 afirmaciones de 4 textos, verificadas a mano contra la base (veredicto V/VE/EX/MF/SR/F, mecanismo M1 a M11, evidencia) | `compose-judge.py --ledger` |
| `human-review/hoja_revision_ciega.md` + `hoja_clave_ids.json` + `respuestas-plantilla.csv` | Hoja de 48 menciones (24 DDEC, 24 DF) para clasificar sin ver al sistema; la clave lleva solo los ids | `human-kappa.py` |
| `human-review/hoja_textos_correo.md` + `hoja_textos_clave.json` | 12 textos de correo mezclados (6 ventanas × base/equipo) para revisión humana a ciegas | revisión manual (spec 13.5) |

Las 6 ventanas: `ddecpr_20261022`, `ddecpr_20261031`, `ddecpr_20261101` (DDEC) y `df_20261026`, `df_20261030`, `df_20261101` (DF).
El sufijo es el **último día cerrado** de la ventana de 7 días PR: el correo enviado el 1-nov a las 6 AM es `--end 2026-10-31`.

## Cosas que debes saber antes de confiar en un número

- **Son fotos.** Las ventanas se reconstruyeron con datos del 2-nov; hoy la base puede traer llegadas tardías o reclasificaciones
  (`repro-check.py` mide cuánto cambió).
- **Los jueces y los textos del equipo son de la misma familia de modelos** que el sistema evaluado (riesgo R1 del spec).
  La hoja humana existe precisamente para eso.
- **`ddec/sample208.json` es estratificado**, no representativo: sirve para comparar sistemas, no para estimar el NSS.
- **Seudonimización, no anonimización.** La sal es pública (`build-fixtures.py`); un diccionario de nombres conocidos podría
  revertirla. Nombres de terceros dentro del texto de un comentario (p. ej. una etiqueta a un amigo) no se detectan.
- Las menciones de DF incluyen nombres de funcionarios públicos en el texto de notas de prensa (son públicas y se conservan).
