# Evaluación del asesor · pasos y quién los hace

Spec §13 y §15 (fase 2, puntos 4 y 5). El código está en `scripts/advisor-eval/` (ver su README). Aquí
están los pasos con personas. **Nada de lo de abajo está ejecutado.**

| # | Paso | Quién | Estado | Depende de |
|---|---|---|---|---|
| 1 | Elegir 20–30 episodios de DDEC, Gobernadora y DF (incluye la renuncia del DDEC de mayo de 2026 y el caso de Familia de octubre de 2026; el apagón de abril de 2025 si hay cobertura) y escribir 2–3 preguntas por episodio | Analista de Populicom | **Bloqueado: persona** | snapshots con `computed_at` de V5 |
| 2 | Verificar que los snapshots de cada episodio son de V5 y cargar los observados a 24/48/72 h | Analista | Bloqueado | 1 |
| 3 | Generar las hojas de hechos en modo congelado (una por caso) | Ingeniería | Bloqueado: falta el subcomando y acceso a la base | 1 |
| 4 | Confirmar la unidad de «15 puntos» (README de `scripts/advisor-eval`) y que los prompts piden rangos al 80 % | Dueño del producto | **Bloqueado: decisión** | — |
| 5 | Aprobar el gasto de las corridas reales y fijar `--max-usd` | Dueño del producto | **Bloqueado: aprobación** | precio verificado de Opus (hoy no hay) |
| 6 | Correr (a), (a′), (b), (c), 3 repeticiones, con control de nombres | Ingeniería | Bloqueado | 1, 3, 5 |
| 7 | Calificación por código (`grade`) y set de seguridad con modelo real | Ingeniería | Parte mecánica lista; con modelo, bloqueado | 5 |
| 8 | Sesión de consultores: calibración, calificación pareada a ciegas | Consultores de Populicom | **Bloqueado: personas** | 6 y `sesion-consultores.md` |
| 9 | Juez DEEP en los dos órdenes y kappa contra los consultores | Ingeniería | Bloqueado | 5, 8 |
| 10 | Aplicar la regla (`decide`) y escribir la decisión en `informe-evaluacion.md` | Dueño del producto | Bloqueado | 6–9 |

Entregables de esta carpeta: `sesion-consultores.md` (protocolo), `hoja-de-calificacion.csv` (solo el encabezado; `export-packet` genera la hoja con una fila por par) e `informe-evaluacion.md` (plantilla con la decisión en blanco).
