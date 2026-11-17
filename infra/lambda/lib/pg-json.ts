/**
 * JSON listo para una columna `jsonb` de PostgreSQL.
 *
 * `JSON.stringify` acepta cadenas que PostgreSQL rechaza con «invalid input
 * syntax for type json»: un sustituto UTF-16 suelto (medio emoji, que queda al
 * recortar un texto por número de caracteres) sale como `\ud83d`, y el
 * carácter nulo como `\u0000`. Con uno solo de esos en una muestra, la
 * composición entera del correo no se podía archivar (Diario de DDEC del
 * 17-nov-2026: el correo salió, pero sin archivo en `report_compositions` ni
 * en `report_send_log`).
 *
 * Aquí cada cadena se vuelve bien formada (el sustituto suelto pasa a U+FFFD)
 * y pierde los nulos antes de serializar. El resto del valor no cambia.
 */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** Cadena sin sustitutos sueltos ni caracteres nulos. */
export function pgSafeString(s: string): string {
  return s.replace(LONE_SURROGATE, '�').replace(/\u0000/g, '');
}

/** `JSON.stringify` con todas las cadenas (valores y claves) aptas para `jsonb`. */
export function pgJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) => {
    if (typeof v === 'string') return pgSafeString(v);
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const keys = Object.keys(v as object);
      if (keys.some((k) => pgSafeString(k) !== k)) {
        return Object.fromEntries(keys.map((k) => [pgSafeString(k), (v as Record<string, unknown>)[k]]));
      }
    }
    return v;
  });
}
