'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Form, Input, Button, Alert } from 'antd';
import type { CognitoUser } from 'amazon-cognito-identity-js';
import {
  signIn,
  completeNewPassword,
  forgotPassword,
  confirmForgotPassword,
  type AuthResult,
} from '@/lib/auth/cognito';

type Mode = 'signin' | 'newPassword' | 'forgotRequest' | 'forgotConfirm';

interface SignInFormValues {
  email: string;
  password: string;
}

// Política del pool: min 8, mayúscula y dígito (símbolos/minúscula opcionales).

// Las mismas tres reglas, a la vista mientras se escribe. Antes solo aparecían
// cuando fallaban, al enviar: la persona que activaba su cuenta las descubría
// una por una. Acromáticas a propósito («Instrumento»): la regla cumplida se
// marca con un check y pasa a --text, no se pinta de verde.
const PASSWORD_CHECKS: { label: string; test: (v: string) => boolean }[] = [
  { label: 'Al menos 8 caracteres', test: (v) => v.length >= 8 },
  { label: 'Una letra mayúscula', test: (v) => /[A-Z]/.test(v) },
  { label: 'Un número', test: (v) => /[0-9]/.test(v) },
];

// Una sola regla que junta las tres (se validan contra PASSWORD_CHECKS): la
// lista de requisitos de debajo ya dice cuál falta mientras se escribe, así que
// tres mensajes rojos repitiéndola por separado eran ruido.
const PASSWORD_RULES = [
  { required: true, message: 'Ingrese una contraseña' },
  {
    validator: (_: unknown, value: string) =>
      !value || PASSWORD_CHECKS.every((c) => c.test(value))
        ? Promise.resolve()
        : Promise.reject(new Error('La contraseña aún no cumple los requisitos de abajo')),
  },
];

function PasswordChecklist({ value }: { value: string }) {
  return (
    <ul aria-label="Requisitos de la contraseña" style={{ listStyle: 'none', margin: '-4px 0 20px', padding: 0, display: 'grid', gap: 4 }}>
      {PASSWORD_CHECKS.map((c) => {
        const ok = c.test(value || '');
        return (
          <li key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--fs-body-sm)', color: ok ? 'var(--text)' : 'var(--text-3)' }}>
            <span aria-hidden="true" style={{
              width: 16, height: 16, borderRadius: 'var(--r-circle)', flexShrink: 0,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              border: `1px solid ${ok ? 'var(--action)' : 'var(--hairline-strong)'}`,
              background: ok ? 'var(--action)' : 'transparent',
            }}>
              {ok && (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--on-fill)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5 9-10" /></svg>
              )}
            </span>
            <span>{c.label}</span>
            <span className="sr-only">{ok ? ' — cumplido' : ' — pendiente'}</span>
          </li>
        );
      })}
    </ul>
  );
}

// Marca de ECO: los arcos de eco del rail, en grafito. Decorativa; el nombre
// va en texto al lado.
function EcoMark({ size = 36 }: { size?: number }) {
  return (
    <span aria-hidden="true" style={{
      width: size, height: size, borderRadius: 'var(--r-md)', flexShrink: 0,
      background: 'var(--rail-bg)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24" fill="none">
        <path d="M 7 19 A 7 7 0 0 1 7 5" stroke="var(--rail-fg-active)" strokeWidth="1.8" strokeLinecap="round" opacity="0.35" />
        <path d="M 10 17 A 5 5 0 0 1 10 7" stroke="var(--rail-fg-active)" strokeWidth="1.8" strokeLinecap="round" opacity="0.6" />
        <path d="M 13 15 A 3 3 0 0 1 13 9" stroke="var(--rail-fg-active)" strokeWidth="1.8" strokeLinecap="round" opacity="0.9" />
        <circle cx="16.5" cy="12" r="1.9" fill="var(--rail-fg-active)" />
      </svg>
    </span>
  );
}

// Cabecera de cada paso: dónde estás (eyebrow), qué haces (título) y, si hace
// falta, una línea de contexto. Antes los cuatro modos compartían el mismo
// «ECO / Monitoreo de medios…» y solo cambiaba el formulario de abajo.
const STEP_COPY: Record<Mode, { eyebrow: string; title: string; lead?: string }> = {
  signin: { eyebrow: 'Acceso', title: 'Inicia sesión' },
  newPassword: { eyebrow: 'Activación · paso 2 de 2', title: 'Crea tu contraseña', lead: 'Es la que usarás desde ahora para entrar. La temporal del correo de invitación deja de servir.' },
  forgotRequest: { eyebrow: 'Recuperar acceso · paso 1 de 2', title: 'Restablece tu contraseña', lead: 'Te enviaremos un código de verificación a tu correo.' },
  forgotConfirm: { eyebrow: 'Recuperar acceso · paso 2 de 2', title: 'Ingresa el código', lead: 'Escribe el código que te llegó y elige una contraseña nueva.' },
};

export default function SignInPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: 'var(--bg)' }} />}>
      <SignInPageInner />
    </Suspense>
  );
}

function SignInPageInner() {
  const router = useRouter();
  const search = useSearchParams();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<Mode>('signin');
  // CognitoUser conservado entre el reto y la fijación de contraseña.
  const [pendingUser, setPendingUser] = useState<CognitoUser | null>(null);
  // Correo recordado entre "pedir código" y "confirmar código" de recuperación.
  const [forgotEmail, setForgotEmail] = useState('');
  // Correo de la cuenta que se está activando: se muestra en el paso 2 para que
  // la persona sepa QUÉ cuenta activa (la invitación pudo llegar a otra bandeja).
  const [activatingEmail, setActivatingEmail] = useState('');
  const [newPasswordForm] = Form.useForm();
  const [forgotConfirmForm] = Form.useForm();
  const newPasswordValue = Form.useWatch('password', newPasswordForm) || '';
  const forgotPasswordValue = Form.useWatch('password', forgotConfirmForm) || '';

  function goTo(next: Mode) {
    setError('');
    setNotice('');
    setMode(next);
  }

  // If the gate bounced us here (?next=...), the ID token likely just expired.
  // Try a silent refresh with the still-valid refresh token before showing the
  // login form, so an active user isn't forced to retype their password.
  const nextParam = search?.get('next') || '';
  const [checking, setChecking] = useState(!!nextParam);

  useEffect(() => {
    if (!nextParam) return;
    // Loop guard: if we tried a silent refresh <8s ago (e.g. it returned ok but
    // the session didn't stick), show the form instead of bouncing forever.
    let recentlyTried = false;
    try {
      const last = Number(sessionStorage.getItem('eco_refresh_attempt') || 0);
      recentlyTried = Date.now() - last < 8000;
    } catch {
      /* sessionStorage unavailable — proceed without the guard */
    }
    if (recentlyTried) {
      setChecking(false);
      return;
    }
    try {
      sessionStorage.setItem('eco_refresh_attempt', String(Date.now()));
    } catch {
      /* ignore */
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' });
        if (!cancelled && res.ok) {
          try {
            sessionStorage.removeItem('eco_refresh_attempt');
          } catch {
            /* ignore */
          }
          router.replace(nextParam.startsWith('/') ? nextParam : '/overview');
          return;
        }
      } catch {
        /* fall through to the login form */
      }
      if (!cancelled) setChecking(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [nextParam, router]);

  // Hand tokens to the server so it can set httpOnly/SameSite=Strict cookies
  // that neither JS nor CSRF requests can read, then route into the app.
  async function establishSession(tokens: AuthResult) {
    const res = await fetch('/api/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ idToken: tokens.idToken, refreshToken: tokens.refreshToken }),
    });
    if (!res.ok) throw new Error('No se pudo iniciar la sesión');
    const next = search?.get('next') || '/dashboard';
    router.push(next.startsWith('/') ? next : '/dashboard');
  }

  async function handleSignIn(values: SignInFormValues) {
    setError('');
    setLoading(true);
    try {
      const result = await signIn(values.email, values.password);
      if (result.kind === 'newPasswordRequired') {
        // Cuenta nueva (invitación): debe crear su contraseña antes de entrar.
        setPendingUser(result.user);
        setActivatingEmail(values.email);
        goTo('newPassword');
        return;
      }
      await establishSession(result.tokens);
    } catch (err: any) {
      setError(err.message || 'Error al iniciar sesión');
    } finally {
      setLoading(false);
    }
  }

  async function handleNewPassword(values: { password: string }) {
    if (!pendingUser) {
      goTo('signin');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const tokens = await completeNewPassword(pendingUser, values.password);
      await establishSession(tokens);
    } catch (err: any) {
      setError(err.message || 'No se pudo crear la contraseña');
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotRequest(values: { email: string }) {
    setError('');
    setLoading(true);
    try {
      await forgotPassword(values.email);
      setForgotEmail(values.email);
      setNotice(`Te enviamos un código a ${values.email}. Revísalo e ingrésalo abajo.`);
      setMode('forgotConfirm');
    } catch (err: any) {
      setError(err.message || 'No se pudo enviar el código');
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotConfirm(values: { code: string; password: string }) {
    setError('');
    setLoading(true);
    try {
      await confirmForgotPassword(forgotEmail, values.code.trim(), values.password);
      setNotice('Contraseña actualizada. Ya puedes iniciar sesión.');
      setMode('signin');
    } catch (err: any) {
      setError(err.message || 'No se pudo actualizar la contraseña');
    } finally {
      setLoading(false);
    }
  }

  if (checking) {
    return (
      <div
        role="status"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          minHeight: '100vh',
          background: 'var(--bg)',
          color: 'var(--text-2)',
          fontSize: 'var(--fs-body)',
        }}
      >
        <EcoMark size={28} />
        Restaurando sesión…
      </div>
    );
  }

  const step = STEP_COPY[mode];

  return (
    <main
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 24,
        minHeight: '100vh',
        background: 'var(--bg)',
        color: 'var(--text)',
        padding: 'clamp(16px, 5vw, 32px)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', maxWidth: 420 }}>
        <EcoMark />
        <div style={{ lineHeight: 1.25 }}>
          <div style={{ fontSize: 'var(--fs-title-md)', fontWeight: 600, letterSpacing: '0.04em' }}>ECO</div>
          <div style={{ fontSize: 'var(--fs-body-sm)', color: 'var(--text-3)' }}>
            Escucha ciudadana · Gobierno de Puerto Rico
          </div>
        </div>
      </div>

      <section
        aria-labelledby="eco-auth-title"
        style={{
          width: '100%',
          maxWidth: 420,
          background: 'var(--canvas)',
          border: '1px solid var(--hairline)',
          borderRadius: 'var(--r-lg)',
          padding: 'clamp(20px, 5vw, 32px)',
        }}
      >
        <header style={{ marginBottom: 24 }}>
          <div className="mono" style={{ fontSize: 'var(--fs-overline)', fontWeight: 500, letterSpacing: 'var(--tracking-overline)', textTransform: 'uppercase', color: 'var(--text-3)' }}>
            {step.eyebrow}
          </div>
          <h1 id="eco-auth-title" style={{ margin: '6px 0 0', fontSize: 'var(--fs-display-md)', fontWeight: 700, letterSpacing: 'var(--tracking-display)', lineHeight: 1.2 }}>
            {step.title}
          </h1>
          {mode === 'newPassword' && activatingEmail && (
            <p style={{ margin: '8px 0 0', fontSize: 'var(--fs-body)', color: 'var(--text-2)' }}>
              Activando la cuenta <span className="mono" style={{ color: 'var(--text)', wordBreak: 'break-all' }}>{activatingEmail}</span>
            </p>
          )}
          {step.lead && (
            <p style={{ margin: '8px 0 0', fontSize: 'var(--fs-body)', color: 'var(--text-2)', lineHeight: 1.55 }}>{step.lead}</p>
          )}
        </header>

        {notice && (
          <Alert title={notice} type="success" showIcon style={{ marginBottom: 20 }} />
        )}
        {error && (
          <Alert title={error} type="error" showIcon style={{ marginBottom: 20 }} />
        )}

        {mode === 'signin' && (
          <Form<SignInFormValues>
            layout="vertical"
            onFinish={handleSignIn}
            requiredMark={false}
            size="large"
          >
            <Form.Item
              label="Correo electrónico"
              name="email"
              rules={[
                { required: true, message: 'Ingrese su correo electrónico' },
                { type: 'email', message: 'Correo electrónico inválido' },
              ]}
            >
              <Input placeholder="usuario@agencia.pr.gov" autoComplete="username" />
            </Form.Item>

            <Form.Item
              label="Contraseña"
              name="password"
              rules={[{ required: true, message: 'Ingrese su contraseña' }]}
              style={{ marginBottom: 8 }}
              extra="Si es tu primer ingreso, usa la contraseña temporal del correo de invitación."
            >
              <Input.Password autoComplete="current-password" />
            </Form.Item>

            <div style={{ textAlign: 'right', marginBottom: 20 }}>
              <Button type="link" style={{ padding: 0, height: 'auto', minHeight: 24, fontWeight: 400, textDecoration: 'underline', textUnderlineOffset: 3 }} onClick={() => goTo('forgotRequest')}>
                ¿Olvidaste tu contraseña?
              </Button>
            </div>

            <Form.Item style={{ marginBottom: 0 }}>
              <Button type="primary" htmlType="submit" loading={loading} block>
                Iniciar sesión
              </Button>
            </Form.Item>
          </Form>
        )}

        {mode === 'newPassword' && (
          <Form
            form={newPasswordForm}
            layout="vertical"
            onFinish={handleNewPassword}
            requiredMark={false}
            size="large"
          >
            <Form.Item label="Nueva contraseña" name="password" rules={PASSWORD_RULES} validateTrigger="onBlur" style={{ marginBottom: 12 }}>
              <Input.Password autoComplete="new-password" />
            </Form.Item>
            <PasswordChecklist value={newPasswordValue} />
            <Form.Item
              label="Confirmar contraseña"
              name="confirm"
              dependencies={['password']}
              rules={[
                { required: true, message: 'Confirme la contraseña' },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (!value || getFieldValue('password') === value) return Promise.resolve();
                    return Promise.reject(new Error('Las contraseñas no coinciden'));
                  },
                }),
              ]}
            >
              <Input.Password autoComplete="new-password" />
            </Form.Item>
            <Form.Item style={{ marginBottom: 0 }}>
              <Button type="primary" htmlType="submit" loading={loading} block>
                Crear contraseña y entrar
              </Button>
            </Form.Item>
          </Form>
        )}

        {mode === 'forgotRequest' && (
          <Form
            layout="vertical"
            onFinish={handleForgotRequest}
            requiredMark={false}
            size="large"
          >
            <Form.Item
              label="Correo electrónico"
              name="email"
              initialValue={forgotEmail}
              rules={[
                { required: true, message: 'Ingrese su correo electrónico' },
                { type: 'email', message: 'Correo electrónico inválido' },
              ]}
            >
              <Input placeholder="usuario@agencia.pr.gov" autoComplete="username" />
            </Form.Item>
            <Form.Item style={{ marginBottom: 12 }}>
              <Button type="primary" htmlType="submit" loading={loading} block>
                Enviar código
              </Button>
            </Form.Item>
            <Button type="link" block style={{ fontWeight: 400, textDecoration: 'underline', textUnderlineOffset: 3 }} onClick={() => goTo('signin')}>
              Volver a iniciar sesión
            </Button>
          </Form>
        )}

        {mode === 'forgotConfirm' && (
          <Form
            form={forgotConfirmForm}
            layout="vertical"
            onFinish={handleForgotConfirm}
            requiredMark={false}
            size="large"
          >
            <Form.Item
              label="Código de verificación"
              name="code"
              rules={[{ required: true, message: 'Ingrese el código que recibió' }]}
            >
              <Input placeholder="123456" inputMode="numeric" autoComplete="one-time-code" style={{ fontFamily: 'var(--ff-mono)', letterSpacing: '0.2em' }} />
            </Form.Item>
            <Form.Item label="Nueva contraseña" name="password" rules={PASSWORD_RULES} validateTrigger="onBlur" style={{ marginBottom: 12 }}>
              <Input.Password autoComplete="new-password" />
            </Form.Item>
            <PasswordChecklist value={forgotPasswordValue} />
            <Form.Item
              label="Confirmar contraseña"
              name="confirm"
              dependencies={['password']}
              rules={[
                { required: true, message: 'Confirme la contraseña' },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (!value || getFieldValue('password') === value) return Promise.resolve();
                    return Promise.reject(new Error('Las contraseñas no coinciden'));
                  },
                }),
              ]}
            >
              <Input.Password autoComplete="new-password" />
            </Form.Item>
            <Form.Item style={{ marginBottom: 12 }}>
              <Button type="primary" htmlType="submit" loading={loading} block>
                Actualizar contraseña
              </Button>
            </Form.Item>
            <Button type="link" block style={{ fontWeight: 400, textDecoration: 'underline', textUnderlineOffset: 3 }} onClick={() => goTo('signin')}>
              Volver a iniciar sesión
            </Button>
          </Form>
        )}
      </section>
    </main>
  );
}
