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

`placeholder.svg` es solo para el preview local (`scripts/preview-appointment-report.ts`).
