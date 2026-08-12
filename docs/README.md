# Documentación ECO

Esta carpeta es la **fuente de verdad** de la documentación de ECO. Está escrita en
Markdown, en español, y organizada para publicarse en Notion (el montaje en Notion se
hace aparte; el contenido vive versionado aquí, junto al código).

## Para quién es cada cosa

La documentación está organizada en **cuatro espacios**: uno transversal (Fundamentos)
y tres por público. Lo compartido vive una sola vez en Fundamentos y el resto enlaza a
él para no duplicar definiciones.

| Espacio | Carpeta | Público | Qué contiene |
|---|---|---|---|
| 📘 **Fundamentos** | [`fundamentos/`](fundamentos/README.md) | Todos | Qué es ECO, glosario, conceptos clave y metodología de métricas en lenguaje claro |
| 👤 **Guía de Usuario** | [`guia-usuario/`](guia-usuario/README.md) | Usuarios de la herramienta | Cómo usar cada pantalla, leer las métricas, configurar reportes y alertas |
| 💼 **Playbook Comercial** | [`playbook-comercial/`](playbook-comercial/README.md) | Equipo de ventas | Propuesta de valor, casos de uso gobierno/marcas, guion de demo, objeciones |
| 🛠️ **Documentación Técnica** | [`tecnica/`](tecnica/README.md) | Desarrolladores y analistas | Arquitectura, pipeline, Lambdas, modelo de datos, fórmulas, narrativas, despliegue |

## Convenciones

- **Idioma:** español.
- **Formato:** Markdown limpio (títulos, tablas, listas, bloques de código). Sin
  *frontmatter* YAML, para que la importación a Notion quede limpia.
- **Enlaces internos:** relativos entre archivos (`../fundamentos/glosario.md`). Al
  importar a Notion se reconvierten en enlaces entre páginas.
- **Una idea, un lugar:** los términos y conceptos se definen en Fundamentos; los demás
  espacios enlazan en vez de redefinir.

## Estado

| Espacio | Estado |
|---|---|
| Fundamentos | Completo |
| Guía de Usuario | Completo |
| Playbook Comercial | Completo |
| Documentación Técnica | Completo |
| Publicación en Notion | Pendiente (la monta el equipo) |
