# Integración con el shell de ECO — contrato para re-skin de los mockups

Objetivo: que el mockup **se vea como una pantalla dentro del dashboard real de ECO**
(tema **mando · oscuro**, con la barra lateral y el header reales). Esto elimina el
"ruido" de marca. Lee `shell.css` y `shell.js` (definen `window.ECOShell`), `tokens.css`
y tu archivo actual.

## Pasos obligatorios

1. **Tema:** `<html lang="es" data-theme="mando" data-mode="dark">` (negro #060A10, acento
   naranja #FF6A3D, IBM Plex). Sin excepción.

2. **Enlaces en `<head>`** (en este orden):
   ```html
   <link rel="stylesheet" href="tokens.css" />
   <link rel="stylesheet" href="shell.css" />
   <style> /* tus estilos propios del contenido */ </style>
   ```
   Y antes de tu script de render:
   ```html
   <script src="data.js"></script>
   <script src="shell.js"></script>
   <script> /* tu render */ </script>
   ```

3. **Envuelve tu contenido en el shell.** Reemplaza tu barra superior propia y tu
   footer/disclaimer por el shell. Tu render queda:
   ```js
   const content = `...SOLO el cuerpo de tu propuesta (cards/tabla/matriz/columnas)...`;
   document.getElementById('app').innerHTML = ECOShell.frame({
     active: 'gobierno',
     title: '<título>',
     eyebrow: '<eyebrow>',
     period: '7D',
     content,
   });
   ```
   `ECOShell.frame()` ya pinta: sidebar (con "Gobierno PR" activo), header (eyebrow +
   "En vivo" + título; selector "Todas las agencias · 13"; bolsa de periodos con 7D
   activo; Fechas/Buscar/modo; chip "Datos ilustrativos") y mete tu `content` dentro de
   `<main class="eco-page">` + una línea de disclaimer al pie. **No** dupliques nada de eso.

4. **`.eco-page` ya da el padding (20px 28px) y un `gap` vertical de 16px** entre hijos
   directos. Tu `content` debe ser una secuencia de secciones/cards (o un contenedor sin
   padding gigante propio). No añadas otra barra ni padding de página.

5. **Quita el fit a una pantalla.** Elimina `html,body{overflow:hidden}` y cualquier
   `height:100vh` que metía todo en un viewport. **La página hace scroll** dentro del
   shell, igual que el dashboard real. (Excepción: ver nota del Radar.)

6. **Auditoría de re-tema** (clave para que no se vea del tema viejo):
   - Usa SOLO `var(--…)`; reemplaza cualquier hex/valor claro suelto.
   - Si venías de **gaceta**: quita serifas y oros — mando usa sans (`var(--ff-display)`
     = IBM Plex) y acento **naranja** (`var(--accent)`). Los headers en serif italic
     deben pasar a sans. El "oro" pasa a `var(--accent)`.
   - Si venías de **costa**: el acento teal pasa a naranja automáticamente vía tokens;
     solo verifica que nada quedó hardcodeado en teal.
   - Verifica contraste sobre fondo oscuro (los tokens lo garantizan si usas variables).

7. **Conserva** tu contenido, la data de `window.MOCK`, las gráficas SVG y la lógica.
   No cambies los números ni la estructura informativa; solo el chrome y el tema.

## Resultado esperado
Abrir el archivo = ver el sidebar oscuro de ECO a la izquierda con "Gobierno PR" activo,
el header de ECO arriba, y tu propuesta como el contenido de la página, en mando oscuro,
indistinguible en estilo del dashboard real. No debe quedar ni rastro del tema anterior.
