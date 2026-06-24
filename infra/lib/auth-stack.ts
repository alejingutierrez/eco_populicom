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

    // Correo de invitación (AdminCreateUser) y de verificación/recuperación.
    // Marca ECO; {username} = correo de la cuenta, {####} = contraseña temporal
    // (invitación) o código de un solo uso (verificación/recuperar contraseña).
    const SIGN_IN_URL = 'https://app.populicom.com/sign-in';
    const emailShell = (title: string, intro: string, code: string, codeLabel: string, outro: string) => `
<div style="margin:0;padding:0;background:#F4F7FA;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:480px;margin:0 auto;padding:24px;">
    <div style="background:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
      <div style="background:linear-gradient(135deg,#1B3A4B 0%,#3B82F6 100%);padding:28px 24px;text-align:center;">
        <span style="color:#FFFFFF;font-size:24px;font-weight:700;letter-spacing:1px;">ECO</span>
        <div style="color:#CBD5E1;font-size:12px;margin-top:4px;">Social Listening — Gobierno de Puerto Rico</div>
      </div>
      <div style="padding:28px 24px;color:#0E1E2C;">
        <h1 style="font-size:18px;margin:0 0 12px;">${title}</h1>
        <p style="font-size:14px;line-height:1.6;color:#334155;margin:0 0 18px;">${intro}</p>
        <div style="background:#F1F5F9;border:1px solid #E2E8F0;border-radius:8px;padding:16px;text-align:center;margin:0 0 18px;">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#64748B;margin-bottom:6px;">${codeLabel}</div>
          <div style="font-size:22px;font-weight:700;letter-spacing:2px;color:#0E1E2C;font-family:SFMono-Regular,Consolas,monospace;">${code}</div>
        </div>
        <p style="font-size:14px;line-height:1.6;color:#334155;margin:0 0 22px;">${outro}</p>
        <div style="text-align:center;">
          <a href="${SIGN_IN_URL}" style="display:inline-block;background:#1B3A4B;color:#FFFFFF;text-decoration:none;font-size:14px;font-weight:600;padding:12px 28px;border-radius:8px;">Iniciar sesión</a>
        </div>
      </div>
      <div style="padding:16px 24px;border-top:1px solid #EEF2F6;color:#94A3B8;font-size:11px;text-align:center;">
        ${SIGN_IN_URL} · Si no esperabas este correo, ignóralo.
      </div>
    </div>
  </div>
</div>`.trim();

    const invitationEmailBody = emailShell(
      'Tu acceso a ECO',
      'Se creó una cuenta para ti en el panel de ECO. Inicia sesión con tu correo (<strong>{username}</strong>) y la contraseña temporal de abajo. El sistema te pedirá crear tu propia contraseña en el primer ingreso.',
      '{####}',
      'Contraseña temporal',
      'La contraseña temporal vence pronto; úsala lo antes posible para activar tu cuenta.',
    );

    const verificationEmailBody = emailShell(
      'Recupera tu contraseña',
      'Recibimos una solicitud para restablecer la contraseña de tu cuenta de ECO. Ingresa este código en el panel para crear una nueva contraseña.',
      '{####}',
      'Código de verificación',
      'Si no solicitaste este cambio, puedes ignorar este correo; tu contraseña no se modificará.',
    );

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
