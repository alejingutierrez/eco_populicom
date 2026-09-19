/**
 * Correo de BIENVENIDA — llega una sola vez, cuando la persona ACTIVA su
 * cuenta (primer ingreso exitoso), no cuando se la invita.
 *
 * Son dos correos distintos y en ese orden:
 *   1. Invitación (la manda Cognito con la contraseña temporal).
 *   2. Bienvenida (este) — ya entró, ya tiene contraseña propia: el correo no
 *      le explica cómo activarse, le enseña a USAR el producto.
 *
 * Origen: el correo que se escribió a mano en ago-2026 para la primera usuaria
 * externa (.claude/design-canvas/welcome). Aquí se porta parametrizado —
 * nombre, agencia y si recibe o no el reporte semanal — para que cualquier
 * usuario nuevo lo reciba solo, con su contexto y sin promesas falsas.
 *
 * Tipografía y estructura propias (no usa emailDocument de chrome.ts): este
 * correo es un recorrido con capturas en movimiento, no un reporte de tablas.
 * La PALETA sí sale de chrome.ts para que la familia no se abra en dos.
 */

import { EMAIL_COLORS } from './chrome';

const T = {
  page: EMAIL_COLORS.page,
  surface: EMAIL_COLORS.surface,
  /** Cajas destacadas — un peldaño sobre `surface`, propio de este correo. */
  raised: '#F7F9FB',
  border: EMAIL_COLORS.border,
  borderSoft: EMAIL_COLORS.borderSoft,
  ink: EMAIL_COLORS.ink,
  ink2: EMAIL_COLORS.inkSoft,
  ink3: EMAIL_COLORS.inkMute,
  accent: EMAIL_COLORS.brand,
  accentSoft: EMAIL_COLORS.brandSoft,
  onAccent: '#FFFFFF',
  /** Fondo tras las capturas: el grafito de la consola, para que el GIF
   *  (que es oscuro) no flote sobre blanco con un borde duro. */
  screenMat: '#0A111A',
  display: "'Besley','Iowan Old Style',Georgia,serif",
  sans: "'Krub',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif",
};

const FONT_LINK =
  '<link href="https://fonts.googleapis.com/css2?family=Besley:wght@400;600;700&family=Krub:wght@300;400;500;600;700&display=swap" rel="stylesheet">';

export interface WelcomeRenderData {
  /** Nombre de pila para el saludo. */
  firstName: string;
  /** Nombre completo de la agencia: "Departamento de Desarrollo Económico…". */
  agencyName: string;
  /** Siglas para el asunto y el overline: "DDEC". */
  agencyShortName: string;
  /** Pantalla de ingreso, p.ej. https://citizenecho.com/sign-in */
  signInUrl: string;
  /** Base de los GIFs servidos por la app, con barra final. */
  assetsBaseUrl: string;
  /**
   * Reporte que la persona recibe por correo sin hacer nada. `null` cuando no
   * está en ninguna lista de envío: entonces el bloque NO se pinta. Prometer un
   * correo que no llega es el fallo que ya costó una corrección en ago-2026.
   */
  scheduledReport: { title: string; body: string } | null;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Artículo del nombre de la agencia: "sobre EL Departamento…", "sobre LA
 * Autoridad…". Regla por la terminación de la primera palabra, que acierta en
 * todas las agencias monitoreadas (Departamento, Autoridad, Secretaría,
 * Gobernadora). Sin esto el correo dice "sobre Departamento de…".
 */
function articleFor(agencyName: string): string {
  const first = agencyName.trim().split(/\s+/)[0] ?? '';
  return /a$/i.test(first) ? 'la' : 'el';
}

/** Asunto tipado de la familia: "[Bienvenida] DDEC · detalle". */
export function welcomeSubject(data: WelcomeRenderData): string {
  return `[Bienvenida] ${data.agencyShortName} · Tu cuenta quedó activa — así se usa ECO`;
}

const PREHEADER = 'Ya puedes entrar cuando quieras. Mira en un minuto cómo se usa.';

interface TourSection {
  n: string;
  kicker: string;
  title: string;
  body: string;
  gif: string;
  alt: string;
}

/** El recorrido es el mismo para todos: son las tres cosas que hace cualquiera
 *  casi todos los días, y los GIFs son del producto real, no ilustraciones. */
const TOUR: TourSection[] = [
  {
    n: '01',
    kicker: 'El pulso, en un vistazo',
    title: 'Abres y ya sabes cómo está la semana',
    body: 'Cuántas menciones, con qué tono y si el riesgo de crisis subió. Cambias el rango —7 días, 30 días, lo que necesites— y todo se recalcula sobre la marcha.',
    gif: 'gif1.gif',
    alt: 'El dashboard de ECO cambiando de 7 a 30 días: el total de menciones, los indicadores de tono y el riesgo de crisis se recalculan.',
  },
  {
    n: '02',
    kicker: 'De la cifra a la conversación',
    title: 'Ningún número es un callejón sin salida',
    body: 'Haces clic en «4 negativas» y ves las cuatro: quién lo dijo, en qué medio, cuándo y bajo qué tema quedó clasificada. Y el camino es el mismo desde cualquier cifra del tablero.',
    gif: 'gif2.gif',
    alt: 'Clic sobre el indicador de menciones negativas: se abre la lista con las menciones reales, su medio, su fecha y su tópico.',
  },
  {
    n: '03',
    kicker: 'Pregúntale a tus datos',
    title: 'Si prefieres preguntar, pregunta',
    body: 'Escribe en español lo que quieres saber. ECO responde sobre lo que tienes en pantalla —la agencia y el periodo que estés viendo— y te dice en qué menciones se basa.',
    gif: 'gif3.gif',
    alt: 'El chat de ECO respondiendo en español a una pregunta sobre qué preocupa más a la gente esta semana.',
  },
];

function styles(): string {
  return `
    :root { color-scheme: light only; supported-color-schemes: light only; }
    body { margin:0; padding:0; background:${T.page}; }
    a { text-decoration:none; }
    img { -ms-interpolation-mode:bicubic; border:0; outline:none; display:block; }
    [data-ogsc] .f-page { background-color:${T.page} !important; }
    [data-ogsc] .f-surface { background-color:${T.surface} !important; }
    [data-ogsc] .f-raised { background-color:${T.raised} !important; }
    [data-ogsc] .f-ink { color:${T.ink} !important; }
    [data-ogsc] .f-ink2 { color:${T.ink2} !important; }
    [data-ogsc] .f-ink3 { color:${T.ink3} !important; }
    [data-ogsc] .f-border { border-color:${T.border} !important; }
    u + .body .gmail-fix { background:${T.page} !important; }
    @media (max-width:620px) {
      .container { width:100% !important; border-radius:0 !important; }
      .px-32 { padding-left:20px !important; padding-right:20px !important; }
      h1.headline { font-size:26px !important; line-height:1.15 !important; }
      .h2 { font-size:18px !important; }
      .cta a { display:block !important; }
    }`;
}

const overline = (txt: string, color: string) =>
  `<div style="font-family:${T.sans};font-size:11px;font-weight:700;letter-spacing:0.09em;text-transform:uppercase;color:${color};margin:0 0 8px 0;">${txt}</div>`;

function blockDivider(num: string, title: string, sub: string): string {
  return `
          <tr>
            <td class="px-32" style="padding:34px 32px 0 32px;">
              <div style="height:1px;background:${T.border};font-size:0;line-height:0;">&nbsp;</div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px;">
                <tr>
                  <td valign="middle" style="width:1px;white-space:nowrap;">
                    <span style="display:inline-block;background:${T.accent};background-color:${T.accent};color:${T.onAccent};font-family:${T.sans};font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;padding:5px 10px;border-radius:4px;">${num}</span>
                  </td>
                  <td valign="middle" style="padding-left:12px;">
                    <div class="f-ink h2" style="font-family:${T.display};font-size:21px;font-weight:600;color:${T.ink};letter-spacing:-0.015em;line-height:1.2;">${title}</div>
                  </td>
                </tr>
              </table>
              <div class="f-ink3" style="font-family:${T.sans};margin-top:8px;font-size:13px;color:${T.ink3};line-height:1.5;">${sub}</div>
            </td>
          </tr>`;
}

function section(s: TourSection, imgBase: string): string {
  return `
          <tr>
            <td class="px-32" style="padding:26px 32px 14px 32px;">
              ${overline(`<span style="color:${T.accent};">${s.n}</span> &nbsp;·&nbsp; ${s.kicker}`, T.ink3)}
              <div class="f-ink h2" style="font-family:${T.display};font-size:19px;font-weight:600;color:${T.ink};letter-spacing:-0.01em;line-height:1.3;">${s.title}</div>
              <div class="f-ink2" style="font-family:${T.sans};margin-top:9px;font-size:14.5px;color:${T.ink2};line-height:1.62;">${s.body}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:6px 0 0 0;background:${T.screenMat};background-color:${T.screenMat};border-top:1px solid ${T.border};border-bottom:1px solid ${T.border};font-size:0;line-height:0;">
              <img src="${imgBase}${s.gif}" width="600" alt="${esc(s.alt)}" style="width:100%;max-width:600px;height:auto;display:block;">
            </td>
          </tr>`;
}

function card(kicker: string, title: string, bodyHtml: string, noteHtml: string | null): string {
  return `
          <tr>
            <td class="px-32" style="padding:26px 32px 0 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${T.raised}" style="background:${T.raised};background-color:${T.raised};border:1px solid ${T.border};border-radius:10px;">
                <tr>
                  <td style="padding:20px;">
                    ${overline(kicker, T.accent)}
                    <div class="f-ink h2" style="font-family:${T.display};font-size:20px;font-weight:600;color:${T.ink};letter-spacing:-0.015em;line-height:1.25;">${title}</div>
                    <div class="f-ink2" style="font-family:${T.sans};margin-top:10px;font-size:14.5px;color:${T.ink2};line-height:1.62;">${bodyHtml}</div>
                    ${noteHtml ? `<div class="f-ink3" style="font-family:${T.sans};margin-top:14px;padding-top:13px;border-top:1px solid ${T.borderSoft};font-size:12.5px;color:${T.ink3};line-height:1.55;">${noteHtml}</div>` : ''}
                  </td>
                </tr>
              </table>
            </td>
          </tr>`;
}

export function renderWelcomeHtml(data: WelcomeRenderData): string {
  const name = esc(data.firstName);
  const agency = esc(data.agencyName);
  const imgBase = data.assetsBaseUrl.endsWith('/') ? data.assetsBaseUrl : `${data.assetsBaseUrl}/`;

  const art = articleFor(data.agencyName);
  const lead = `ECO —Escucha Ciudadana Online— reúne en un solo lugar lo que se dice en medios y redes sobre ${art} <strong>${agency}</strong>: cuánto se habla, en qué tono, sobre qué temas y qué está escalando antes de que se convierta en un problema.`;

  const entrar = `
          <tr>
            <td class="px-32" style="padding:24px 32px 0 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${T.raised}" style="background:${T.raised};background-color:${T.raised};border:1px solid ${T.border};border-radius:10px;">
                <tr>
                  <td style="padding:20px;">
                    ${overline('Tu cuenta ya está activa', T.accent)}
                    <div class="f-ink h2" style="font-family:${T.display};font-size:20px;font-weight:600;color:${T.ink};letter-spacing:-0.015em;line-height:1.25;">No hay nada más que configurar</div>
                    <div class="f-ink2" style="font-family:${T.sans};margin-top:10px;font-size:14.5px;color:${T.ink2};line-height:1.62;">Entras siempre por <strong>citizenecho.com</strong> con tu correo y la contraseña que acabas de crear. Guarda esta dirección: es la misma todos los días, desde computadora o teléfono.</div>
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" class="cta" style="margin-top:16px;">
                      <tr>
                        <td bgcolor="${T.accent}" style="background:${T.accent};background-color:${T.accent};border-radius:8px;">
                          <a href="${data.signInUrl}" style="display:inline-block;padding:13px 26px;font-family:${T.sans};font-size:14px;font-weight:700;color:${T.onAccent};text-decoration:none;letter-spacing:0.01em;">Entrar a ECO &nbsp;→</a>
                        </td>
                      </tr>
                    </table>
                    <div class="f-ink3" style="font-family:${T.sans};margin-top:14px;padding-top:13px;border-top:1px solid ${T.borderSoft};font-size:12.5px;color:${T.ink3};line-height:1.55;">Si alguna vez olvidas la contraseña, usa «¿Olvidaste tu contraseña?» en esa misma pantalla y te llega un código nuevo a este correo.</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`;

  const reportCard = data.scheduledReport
    ? card(
        'Sin que hagas nada',
        esc(data.scheduledReport.title),
        data.scheduledReport.body,
        'Si además quieres el pulso diario de cada mañana, o que te avisemos en el momento en que algo se sale de lo normal, responde a este correo y te lo activamos.',
      )
    : card(
        'Sin que hagas nada',
        'Podemos avisarte por correo',
        'Hoy tu cuenta solo tiene acceso al panel: no te llega ningún correo automático. Si quieres el resumen semanal de los viernes, el pulso diario de cada mañana, o que te avisemos en el momento en que algo se sale de lo normal, responde a este correo y te lo activamos.',
        null,
      );

  const contentRows = `
          <tr><td style="background:${T.accent};background-color:${T.accent};height:4px;line-height:4px;font-size:0;padding:0;">&nbsp;</td></tr>

          <tr>
            <td class="px-32" style="padding:18px 32px 16px 32px;border-bottom:1px solid ${T.borderSoft};">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="left" valign="middle">
                    <span class="f-ink" style="font-family:${T.display};font-size:18px;font-weight:700;letter-spacing:-0.01em;color:${T.ink};">ECO <span style="color:${T.accent};">Radar</span></span>
                  </td>
                  <td align="right" valign="middle">
                    <span style="display:inline-block;background:${T.accent};background-color:${T.accent};color:${T.onAccent};font-family:${T.sans};font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;padding:4px 10px;border-radius:4px;">Bienvenida</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td class="px-32" style="padding:32px 32px 0 32px;">
              ${overline(`Cuenta activa · ${esc(data.agencyShortName)}`, T.accent)}
              <h1 class="headline f-ink" style="margin:0;font-family:${T.display};font-size:32px;line-height:1.12;font-weight:600;letter-spacing:-0.02em;color:${T.ink};">Ya estás dentro, ${name}.</h1>
              <div class="f-ink2" style="font-family:${T.sans};margin-top:14px;font-size:15px;color:${T.ink2};line-height:1.65;">${lead}</div>
            </td>
          </tr>
${entrar}
${blockDivider('Cómo se usa', 'Tres cosas que vas a hacer casi todos los días.', 'Cada bloque de abajo es la pantalla real, en movimiento — no un dibujo.')}
${TOUR.map((s) => section(s, imgBase)).join('')}
${reportCard}

          <tr>
            <td class="px-32" style="padding:30px 32px 0 32px;">
              <div class="f-ink h2" style="font-family:${T.display};font-size:19px;font-weight:600;color:${T.ink};letter-spacing:-0.01em;">Una última cosa</div>
              <div class="f-ink2" style="font-family:${T.sans};margin-top:9px;font-size:14.5px;color:${T.ink2};line-height:1.62;">Tu acceso está configurado para ${art} ${agency}. Si más adelante necesitas otra agencia, o que alguien más de tu equipo entre, responde a este correo y lo montamos.</div>
            </td>
          </tr>

          <tr>
            <td class="px-32" align="center" style="padding:26px 32px 24px 32px;">
              <div style="height:1px;background:${T.borderSoft};font-size:0;line-height:0;margin-bottom:18px;">&nbsp;</div>
              <div class="f-ink3" style="font-family:${T.sans};color:${T.ink3};font-size:11.5px;line-height:1.6;letter-spacing:0.02em;">ECO Radar · Escucha Ciudadana Online</div>
              <div class="f-ink3" style="font-family:${T.sans};margin-top:6px;color:${T.ink3};font-size:11px;line-height:1.55;">Recibes este correo una sola vez, porque acabas de activar tu cuenta en ECO. Si crees que es un error, respóndelo y lo atendemos.</div>
            </td>
          </tr>`;

  return `<!doctype html>
<html lang="es" style="color-scheme:light only;supported-color-schemes:light only;">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light only">
  <title>${esc(welcomeSubject(data))}</title>
  ${FONT_LINK}
  <!--[if mso]>
  <style type="text/css">table,td,div,h1,p,span,a{font-family:Georgia,'Times New Roman',serif !important;}</style>
  <![endif]-->
  <style>${styles()}</style>
</head>
<body class="body" style="margin:0;padding:0;background:${T.page};font-family:${T.sans};color:${T.ink};-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${T.page};opacity:0;">${PREHEADER}</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="f-page" style="background:${T.page};background-color:${T.page};">
    <tr>
      <td align="center" style="padding:28px 16px;">
        <table role="presentation" class="container f-surface gmail-fix" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="${T.surface}" style="width:600px;max-width:600px;background:${T.surface};background-color:${T.surface};border-radius:12px;overflow:hidden;border:1px solid ${T.border};">
${contentRows}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Versión de texto plano — mismo contenido, para el multipart de SES. */
export function renderWelcomeText(data: WelcomeRenderData): string {
  const strip = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  const wrap = (s: string, w = 74) => {
    const out: string[] = [];
    for (const para of s.split('\n')) {
      let line = '';
      for (const word of para.split(' ')) {
        if ((line + ' ' + word).trim().length > w) { out.push(line.trim()); line = word; }
        else line += ' ' + word;
      }
      out.push(line.trim());
    }
    return out.join('\n');
  };
  const rule = '─'.repeat(62);

  const parts = [
    `Ya estás dentro, ${data.firstName}.`,
    '',
    wrap(`ECO —Escucha Ciudadana Online— reúne en un solo lugar lo que se dice en medios y redes sobre ${articleFor(data.agencyName)} ${data.agencyName}: cuánto se habla, en qué tono, sobre qué temas y qué está escalando antes de que se convierta en un problema.`),
    '',
    rule,
    'NO HAY NADA MÁS QUE CONFIGURAR',
    '',
    wrap('Entras siempre por citizenecho.com con tu correo y la contraseña que acabas de crear. Guarda esta dirección: es la misma todos los días, desde computadora o teléfono.'),
    '',
    `→ ${data.signInUrl}`,
    '',
    wrap('Si alguna vez olvidas la contraseña, usa «¿Olvidaste tu contraseña?» en esa misma pantalla y te llega un código nuevo a este correo.'),
    '',
    rule,
    'CÓMO SE USA',
    wrap('Tres cosas que vas a hacer casi todos los días.'),
    '',
    ...TOUR.flatMap((s) => [`${s.n} · ${s.kicker.toUpperCase()}`, s.title, wrap(strip(s.body)), '']),
    rule,
  ];

  if (data.scheduledReport) {
    parts.push(
      data.scheduledReport.title.toUpperCase(),
      '',
      wrap(strip(data.scheduledReport.body)),
      '',
      wrap('Si además quieres el pulso diario de cada mañana, o que te avisemos en el momento en que algo se sale de lo normal, responde a este correo y te lo activamos.'),
    );
  } else {
    parts.push(
      'PODEMOS AVISARTE POR CORREO',
      '',
      wrap('Hoy tu cuenta solo tiene acceso al panel: no te llega ningún correo automático. Si quieres el resumen semanal de los viernes, el pulso diario de cada mañana, o que te avisemos en el momento en que algo se sale de lo normal, responde a este correo y te lo activamos.'),
    );
  }

  parts.push(
    '',
    rule,
    'UNA ÚLTIMA COSA',
    '',
    wrap(`Tu acceso está configurado para ${articleFor(data.agencyName)} ${data.agencyName}. Si más adelante necesitas otra agencia, o que alguien más de tu equipo entre, responde a este correo y lo montamos.`),
    '',
    rule,
    'ECO Radar · Escucha Ciudadana Online',
    wrap('Recibes este correo una sola vez, porque acabas de activar tu cuenta en ECO. Si crees que es un error, respóndelo y lo atendemos.'),
  );

  return parts.join('\n');
}
