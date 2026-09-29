/**
 * GET /media/<clave> — copias propias de imágenes que caducan.
 *
 * El processor copia a S3 (`media/` del bucket crudo) las imágenes del CDN de
 * Facebook/Instagram, que vencen a los ~5 días de publicadas, y la mención
 * pasa a apuntar aquí. Así las miniaturas del dashboard y de los correos ya
 * enviados siguen cargando. Ver `@eco/shared/media-mirror`.
 *
 * PÚBLICA a propósito: los clientes de correo piden la imagen sin sesión.
 * Por eso la ruta está fuera del matcher del middleware y solo acepta claves
 * con la forma exacta del hash (`MEDIA_KEY_RE`), que no permite salir de
 * `media/`. El contenido ya era público en su origen.
 */
import { GetObjectCommand, NoSuchKey, S3Client } from '@aws-sdk/client-s3';
import { MEDIA_KEY_RE } from '@eco/shared/src/media-mirror';

const s3 = new S3Client({});

export async function GET(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const bucket = process.env.RAW_BUCKET;
  if (!bucket || !MEDIA_KEY_RE.test(key)) {
    return new Response('Not found', { status: 404 });
  }
  try {
    const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: `media/${key}` }));
    const body = await obj.Body?.transformToByteArray();
    if (!body) return new Response('Not found', { status: 404 });
    // transformToByteArray devuelve Uint8Array<ArrayBufferLike>; Response pide
    // un buffer no compartido, que es lo que el SDK entrega en la práctica.
    return new Response(body as Uint8Array<ArrayBuffer>, {
      status: 200,
      headers: {
        'Content-Type': obj.ContentType ?? 'application/octet-stream',
        // La clave es el hash de la URL de origen: el contenido no cambia.
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    if (err instanceof NoSuchKey || (err as { name?: string })?.name === 'NoSuchKey') {
      return new Response('Not found', { status: 404 });
    }
    console.error('[media] GetObject failed', key, err);
    return new Response('Error', { status: 502 });
  }
}
