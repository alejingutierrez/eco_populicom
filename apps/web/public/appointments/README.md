# Retratos de nombramientos

Fotos de las personas que salen en la ficha del correo `[Nombramiento]`.

**Por qué se sirven desde aquí y no se hotlinkean:** las `og:image` de los
medios de PR (elnuevodia, elcalce, elvocero…) vienen con token firmado
(`?auth=…`) que **expira**, así que el correo se vería con la imagen rota
semanas después de enviarse. Estas viven en el dominio del dashboard y no
caducan.

## Cómo añadir una

1. Guarda el retrato aquí como `<nombre-kebab>.jpg` (cuadrado, mínimo 184×184
   para que se vea nítido en pantallas retina; se renderiza a 92×92 circular).
2. Apunta la fila del nombramiento a la URL pública:

```sql
UPDATE agency_appointments
   SET photo_url = 'https://citizenecho.com/appointments/<nombre-kebab>.jpg'
 WHERE person_name = '<Nombre>';
```

3. La imagen se publica con el próximo deploy del web app (push a main → CI).

Sin `photo_url` el correo dibuja un **monograma con las iniciales** en violeta:
la ficha nunca depende de que exista la foto.

## Encuadre

Cuadradas y recortadas a **cabeza y hombros**, con el rostro a ~29% del borde
superior — no centrado. Si centras el rostro, el círculo del correo corta la
barbilla y deja aire de sobra arriba. 368×368 (4× el render de 92px) a JPEG
calidad 88 pesa ~40 KB, que es lo correcto para un correo.

## Inventario

| Archivo | Persona | Origen |
|---|---|---|
| `norma-burgos.jpg` | Norma E. Burgos Andújar | provista por el cliente (12-ago-2026) |

`placeholder.svg` es solo para el preview local (`scripts/preview-appointment-report.ts`).
