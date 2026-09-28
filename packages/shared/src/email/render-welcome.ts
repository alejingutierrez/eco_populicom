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
 * Cromo «Instrumento» desde sep 2026 (camino A del rediseño de correos): el
 * mismo documento que el resto de la familia, con la etiqueta BIENVENIDA en
 * texto plano (no es un estado ni un reporte). Las capturas en movimiento van
 * a sangre (600 px) sobre un paspartú grafito, porque los GIFs son oscuros.
 */

import { esc as escAttr } from './chrome';
import {
  INSTRUMENT as T,
  FONT_MONO,
  FONT_SANS,
  actionButton,
  instrumentDocument,
  sectionLabel,
  sectionRow,
} from './instrument';

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

const H2 = `margin:0;font-family:${FONT_SANS};font-size:18px;font-weight:600;line-height:1.3;color:${T.ink};`;
const P = `margin:10px 0 0 0;font-family:${FONT_SANS};font-size:15px;line-height:1.6;color:${T.ink2};`;
const NOTE = `margin:14px 0 0 0;padding-top:12px;border-top:1px solid ${T.line};font-family:${FONT_SANS};font-size:13px;line-height:1.55;color:${T.text2};`;

/** Un paso del recorrido: texto en su sección y la captura a sangre debajo. */
function tourStep(s: TourSection, imgBase: string): string {
  return sectionRow(`
              ${sectionLabel(`${s.n} · ${s.kicker}`)}
              <h2 style="${H2}">${s.title}</h2>
              <p style="${P}">${s.body}</p>`, { padding: '28px 32px 20px 32px', last: true }) + `
          <tr>
            <td style="padding:0;background:${T.ink};background-color:${T.ink};border-top:1px solid ${T.line};border-bottom:1px solid ${T.line};font-size:0;line-height:0;">
              <img src="${escAttr(imgBase + s.gif)}" width="600" alt="${escAttr(s.alt)}" style="display:block;width:100%;max-width:600px;height:auto;border:0;">
            </td>
          </tr>`;
}

export function renderWelcomeHtml(data: WelcomeRenderData): string {
  const agency = esc(data.agencyName);
  const imgBase = data.assetsBaseUrl.endsWith('/') ? data.assetsBaseUrl : `${data.assetsBaseUrl}/`;
  const art = articleFor(data.agencyName);
  const lead = `ECO —Escucha Ciudadana Online— reúne en un solo lugar lo que se dice en medios y redes sobre ${art} <strong>${agency}</strong>: cuánto se habla, en qué tono, sobre qué temas y qué está escalando antes de que se convierta en un problema.`;

  const account = sectionRow(`
              ${sectionLabel('Tu cuenta ya está activa')}
              <h2 style="${H2}">No hay nada más que configurar</h2>
              <p style="${P}">Entras siempre por <span style="font-family:${FONT_MONO};">citizenecho.com</span> con tu correo y la contraseña que acabas de crear. Guarda esta dirección: es la misma todos los días, desde computadora o teléfono.</p>
              <div style="margin-top:18px;">${actionButton(data.signInUrl, 'Entrar a ECO')}</div>
              <p style="${NOTE}">Si alguna vez olvidas la contraseña, usa «¿Olvidaste tu contraseña?» en esa misma pantalla y te llega un código nuevo a este correo.</p>`);

  const tourIntro = sectionRow(`
              ${sectionLabel('Cómo se usa')}
              <h2 style="${H2}">Tres cosas que vas a hacer casi todos los días</h2>
              <p style="${P}">Cada bloque de abajo es la pantalla real, en movimiento — no un dibujo.</p>`, { last: true });

  // Qué correo recibe DE VERDAD: sin lista de envío, el bloque no promete nada.
  const report = data.scheduledReport
    ? sectionRow(`
              ${sectionLabel('Sin que hagas nada')}
              <h2 style="${H2}">${esc(data.scheduledReport.title)}</h2>
              <p style="${P}">${data.scheduledReport.body}</p>
              <p style="${NOTE}">Si además quieres el pulso diario de cada mañana, o que te avisemos en el momento en que algo se sale de lo normal, responde a este correo y te lo activamos.</p>`, { bg: T.subtle })
    : sectionRow(`
              ${sectionLabel('Sin que hagas nada')}
              <h2 style="${H2}">Podemos avisarte por correo</h2>
              <p style="${P}">Hoy tu cuenta solo tiene acceso al panel: no te llega ningún correo automático. Si quieres el resumen semanal de los viernes, el pulso diario de cada mañana, o que te avisemos en el momento en que algo se sale de lo normal, responde a este correo y te lo activamos.</p>`, { bg: T.subtle });

  const lastThing = sectionRow(`
              ${sectionLabel('Una última cosa')}
              <p style="${P}margin-top:0;">Tu acceso está configurado para ${art} ${agency}. Si más adelante necesitas otra agencia, o que alguien más de tu equipo entre, responde a este correo y lo montamos.</p>`, { last: true });

  return instrumentDocument({
    title: welcomeSubject(data),
    preheader: PREHEADER,
    kind: 'welcome',
    heading: {
      kicker: `Cuenta activa · ${data.agencyShortName}`,
      title: `Ya estás dentro, ${data.firstName}.`,
      extraHtml: `<p style="margin:14px 0 0 0;font-family:${FONT_SANS};font-size:15px;line-height:1.6;color:${T.ink2};">${lead}</p>`,
    },
    contentRows: [account, tourIntro, ...TOUR.map((s) => tourStep(s, imgBase)), report, lastThing].join('\n'),
  });
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
