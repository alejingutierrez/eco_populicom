import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly userPoolId: string;
  public readonly userPoolClientId: string;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Correos de Cognito (invitación + verificación/recuperación). El diseño
    // replica la identidad de los correos de ECO (render-weekly-report /
    // render-crisis-alert en @eco/shared): tabla 600px, paleta de marca
    // (brand #0A7EA4 / accent #F4C300), wordmark "ECO Radar", compatible con
    // Gmail/Outlook/Apple Mail (inline styles + tablas + fixes [data-ogsc]).
    // Se mantiene como string estático aquí (sin import de @eco/shared) porque
    // la plantilla vive embebida en la config del pool y el bundling de CDK
    // desde un worktree no resuelve @eco/shared de forma fiable.
    // {username} = correo de la cuenta; {####} = contraseña temporal
    // (invitación) o código de un solo uso (recuperación).
    const SIGN_IN_URL = 'https://app.populicom.com/sign-in';
    const C = {
      page: '#F5F6F8', surface: '#FFFFFF', border: '#E6E8EC', borderSoft: '#EEF0F4',
      ink: '#0E1E2C', inkSoft: '#4A5563', inkMute: '#8A93A0',
      brand: '#0A7EA4', brandSoft: '#E6F1F7', brandBorder: '#CFE5EE',
    };
    const authEmail = (o: {
      eyebrow: string; title: string; intro: string;
      codeLabel: string; outro: string; ctaLabel: string; footerNote: string;
    }) => `<!doctype html>
<html lang="es" style="color-scheme:light only;supported-color-schemes:light only;">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light only">
  <title>${o.title} · ECO</title>
  <style>
    :root { color-scheme: light only; supported-color-schemes: light only; }
    body { margin: 0; padding: 0; background: ${C.page}; }
    a { text-decoration: none; }
    table, td, div, h1, p { font-family: Arial, Helvetica, sans-serif; }
    [data-ogsc] .force-bg-page { background-color: ${C.page} !important; }
    [data-ogsc] .force-bg-white { background-color: ${C.surface} !important; }
    [data-ogsc] .force-text-dark { color: ${C.ink} !important; }
    [data-ogsc] .force-text-mute { color: ${C.inkSoft} !important; }
    [data-ogsc] .force-text-soft { color: ${C.inkMute} !important; }
    u + .body .gmail-dark-fix { background: ${C.page} !important; }
    @media (max-width: 620px) {
      .container { width: 100% !important; border-radius: 0 !important; }
      .px-32 { padding-left: 20px !important; padding-right: 20px !important; }
      h1.headline { font-size: 22px !important; }
    }
  </style>
</head>
<body class="body" style="margin:0;padding:0;background:${C.page};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:${C.ink};-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${C.page};opacity:0;">${o.title} · ECO Radar</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="force-bg-page" style="background:${C.page};">
    <tr>
      <td align="center" style="padding:24px 16px;">
        <table role="presentation" class="container force-bg-white gmail-dark-fix" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.surface}" style="width:600px;max-width:600px;background:${C.surface};background-color:${C.surface};border-radius:10px;overflow:hidden;border:1px solid ${C.border};">
          <tr><td style="background:${C.brand};background-color:${C.brand};height:4px;line-height:4px;font-size:0;padding:0;">&nbsp;</td></tr>
          <tr>
            <td class="px-32" style="padding:18px 32px 14px 32px;border-bottom:1px solid ${C.borderSoft};">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
                <td align="left" valign="middle"><span style="font-size:15px;font-weight:700;letter-spacing:-0.01em;color:${C.ink};">ECO <span style="color:${C.brand};">Radar</span></span></td>
                <td align="right" valign="middle" class="force-text-soft" style="font-size:11.5px;color:${C.inkMute};letter-spacing:0.02em;font-weight:600;">Social Listening · Gobierno de PR</td>
              </tr></table>
            </td>
          </tr>
          <tr>
            <td class="px-32" style="padding:28px 32px 6px 32px;">
              <div class="force-text-soft" style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;font-weight:700;color:${C.brand};margin-bottom:10px;">${o.eyebrow}</div>
              <h1 class="headline force-text-dark" style="margin:0 0 14px 0;color:${C.ink};font-size:24px;line-height:1.3;font-weight:700;letter-spacing:-0.015em;">${o.title}</h1>
              <p class="force-text-mute" style="margin:0;font-size:14px;line-height:1.65;color:${C.inkSoft};">${o.intro}</p>
            </td>
          </tr>
          <tr>
            <td class="px-32" style="padding:18px 32px 6px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.brandSoft}" style="background:${C.brandSoft};background-color:${C.brandSoft};border:1px solid ${C.brandBorder};border-radius:8px;">
                <tr><td align="center" style="padding:18px;">
                  <div class="force-text-soft" style="font-size:10.5px;text-transform:uppercase;letter-spacing:0.1em;color:${C.inkMute};font-weight:700;margin-bottom:8px;">${o.codeLabel}</div>
                  <div class="force-text-dark" style="font-size:26px;font-weight:800;letter-spacing:3px;color:${C.ink};font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;">{####}</div>
                </td></tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="px-32" style="padding:14px 32px 4px 32px;">
              <p class="force-text-mute" style="margin:0;font-size:13px;line-height:1.65;color:${C.inkSoft};">${o.outro}</p>
            </td>
          </tr>
          <tr>
            <td class="px-32" align="center" style="padding:18px 32px 28px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                <td bgcolor="${C.ink}" style="background:${C.ink};background-color:${C.ink};border-radius:6px;">
                  <a href="${SIGN_IN_URL}" style="display:inline-block;padding:12px 26px;font-size:13px;font-weight:700;color:#FFFFFF;text-decoration:none;letter-spacing:0.02em;">${o.ctaLabel}</a>
                </td>
              </tr></table>
            </td>
          </tr>
          <tr>
            <td class="px-32" style="padding:18px 32px 22px 32px;border-top:1px solid ${C.borderSoft};" align="center">
              <div class="force-text-soft" style="color:${C.inkMute};font-size:11.5px;line-height:1.6;">ECO Radar &nbsp;·&nbsp; Populicom</div>
              <div class="force-text-soft" style="margin-top:6px;color:${C.inkMute};font-size:11px;line-height:1.5;">${o.footerNote}</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    const invitationEmailBody = authEmail({
      eyebrow: 'Acceso a la plataforma',
      title: 'Te damos acceso a ECO',
      intro: 'Se creó una cuenta para ti en el panel de ECO con el correo <strong>{username}</strong>. Usa la contraseña temporal de abajo para tu primer ingreso; el sistema te pedirá crear tu propia contraseña.',
      codeLabel: 'Contraseña temporal',
      outro: 'Por seguridad, esta contraseña temporal vence pronto. Úsala lo antes posible para activar tu cuenta.',
      ctaLabel: 'Iniciar sesión →',
      footerNote: 'Recibes este correo porque un administrador creó tu cuenta en ECO.',
    });

    const verificationEmailBody = authEmail({
      eyebrow: 'Seguridad de la cuenta',
      title: 'Recupera tu contraseña',
      intro: 'Recibimos una solicitud para restablecer la contraseña de tu cuenta de ECO. Ingresa el siguiente código en el panel para crear una nueva contraseña.',
      codeLabel: 'Código de verificación',
      outro: 'Si no solicitaste este cambio, ignora este correo; tu contraseña no se modificará.',
      ctaLabel: 'Ir a iniciar sesión →',
      footerNote: 'Por tu seguridad, nunca compartas este código con nadie.',
    });

    // Cognito User Pool
    this.userPool = new cognito.UserPool(this, 'EcoUserPool', {
      userPoolName: 'eco-users',
      // Envía la invitación y los códigos de recuperación por SES desde el
      // remitente verificado (el mismo del correo de alerta/diario), en vez del
      // correo default de Cognito (no-reply@verificationemail.com) que los
      // dominios Workspace como @populicom.com filtran como spam — causa real de
      // que la invitación no llegara. SES en sandbox solo entrega a destinatarios
      // verificados; los usuarios del panel son @populicom.com (verificados).
      email: cognito.UserPoolEmail.withSES({
        fromEmail: 'agutierrez@populicom.com',
        fromName: 'ECO — Populicom',
        replyTo: 'agutierrez@populicom.com',
        sesRegion: 'us-east-1',
      }),
      userInvitation: {
        emailSubject: 'Tu acceso a ECO — Social Listening',
        emailBody: invitationEmailBody,
      },
      userVerification: {
        emailSubject: 'ECO — Código de verificación',
        emailBody: verificationEmailBody,
        emailStyle: cognito.VerificationEmailStyle.CODE,
      },
      signInAliases: {
        email: true,
      },
      autoVerify: {
        email: true,
      },
      passwordPolicy: {
        minLength: 8,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
        requireLowercase: false,
      },
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: {
        sms: false,
        otp: true,
      },
      selfSignUpEnabled: true,
      // Routes the dashboard to the right tenant per-user. Without this the
      // JWT lacks `custom:agency_slug`, the API falls back to the default
      // agency, and different widgets can show different tenants — exactly
      // the bug seen on 2026-04-27 (chart aaa, drilldown ddecpr). Mutable
      // so an admin can move users between agencies without recreating the
      // account. Already added to the deployed pool via add-custom-attributes
      // on 2026-04-27; this declaration just makes future deploys idempotent.
      customAttributes: {
        agency_slug: new cognito.StringAttribute({ minLen: 1, maxLen: 50, mutable: true }),
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // User groups
    new cognito.CfnUserPoolGroup(this, 'AdminGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'admin',
      description: 'Administrator group',
    });

    new cognito.CfnUserPoolGroup(this, 'AnalystGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'analyst',
      description: 'Analyst group',
    });

    new cognito.CfnUserPoolGroup(this, 'ViewerGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'viewer',
      description: 'Viewer group',
    });

    // App client — SRP auth, no secret
    this.userPoolClient = new cognito.UserPoolClient(this, 'EcoUserPoolClient', {
      userPool: this.userPool,
      generateSecret: false,
      authFlows: {
        userSrp: true,
      },
    });

    this.userPoolId = this.userPool.userPoolId;
    this.userPoolClientId = this.userPoolClient.userPoolClientId;
  }
}
