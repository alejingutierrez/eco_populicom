'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, Form, Input, Button, Alert, Typography } from 'antd';
import type { CognitoUser } from 'amazon-cognito-identity-js';
import {
  signIn,
  completeNewPassword,
  forgotPassword,
  confirmForgotPassword,
  type AuthResult,
} from '@/lib/auth/cognito';

const { Title, Text } = Typography;

type Mode = 'signin' | 'newPassword' | 'forgotRequest' | 'forgotConfirm';

interface SignInFormValues {
  email: string;
  password: string;
}

// Política del pool: min 8, mayúscula y dígito (símbolos/minúscula opcionales).
const PASSWORD_RULES = [
  { required: true, message: 'Ingrese una contraseña' },
  { min: 8, message: 'Mínimo 8 caracteres' },
  { pattern: /[A-Z]/, message: 'Debe incluir al menos una mayúscula' },
  { pattern: /[0-9]/, message: 'Debe incluir al menos un número' },
];

export default function SignInPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: '#F4F7FA' }} />}>
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
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          backgroundColor: '#F4F7FA',
          color: '#64748B',
          fontSize: 14,
        }}
      >
        Restaurando sesión…
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        backgroundColor: '#F4F7FA',
        padding: 'clamp(16px, 5vw, 32px)',
      }}
    >
      <Card
        style={{
          width: '100%',
          maxWidth: 420,
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 12,
              background: 'linear-gradient(135deg, #1B3A4B 0%, #3B82F6 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
            }}
          >
            <span
              style={{
                color: '#FFFFFF',
                fontSize: 22,
                fontWeight: 700,
                letterSpacing: 1,
              }}
            >
              ECO
            </span>
          </div>
          <Title level={3} style={{ margin: 0, color: '#0E1E2C' }}>
            ECO
          </Title>
          <Text style={{ color: '#64748B' }}>
            Monitoreo de medios y redes — Gobierno de Puerto Rico
          </Text>
        </div>

        {notice && (
          <Alert message={notice} type="success" showIcon style={{ marginBottom: 24 }} />
        )}
        {error && (
          <Alert message={error} type="error" showIcon style={{ marginBottom: 24 }} />
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
            >
              <Input.Password autoComplete="current-password" />
            </Form.Item>

            <div style={{ textAlign: 'right', marginBottom: 16 }}>
              <Button type="link" size="small" style={{ padding: 0 }} onClick={() => goTo('forgotRequest')}>
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
            layout="vertical"
            onFinish={handleNewPassword}
            requiredMark={false}
            size="large"
          >
            <Text style={{ display: 'block', color: '#64748B', marginBottom: 16 }}>
              Crea tu contraseña para activar tu cuenta.
            </Text>
            <Form.Item label="Nueva contraseña" name="password" rules={PASSWORD_RULES} hasFeedback>
              <Input.Password autoComplete="new-password" />
            </Form.Item>
            <Form.Item
              label="Confirmar contraseña"
              name="confirm"
              dependencies={['password']}
              hasFeedback
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
            <Text style={{ display: 'block', color: '#64748B', marginBottom: 16 }}>
              Ingresa tu correo y te enviaremos un código para restablecer tu contraseña.
            </Text>
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
            <Form.Item style={{ marginBottom: 8 }}>
              <Button type="primary" htmlType="submit" loading={loading} block>
                Enviar código
              </Button>
            </Form.Item>
            <Button type="link" size="small" block onClick={() => goTo('signin')}>
              Volver a iniciar sesión
            </Button>
          </Form>
        )}

        {mode === 'forgotConfirm' && (
          <Form
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
              <Input placeholder="123456" inputMode="numeric" autoComplete="one-time-code" />
            </Form.Item>
            <Form.Item label="Nueva contraseña" name="password" rules={PASSWORD_RULES} hasFeedback>
              <Input.Password autoComplete="new-password" />
            </Form.Item>
            <Form.Item
              label="Confirmar contraseña"
              name="confirm"
              dependencies={['password']}
              hasFeedback
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
            <Form.Item style={{ marginBottom: 8 }}>
              <Button type="primary" htmlType="submit" loading={loading} block>
                Actualizar contraseña
              </Button>
            </Form.Item>
            <Button type="link" size="small" block onClick={() => goTo('signin')}>
              Volver a iniciar sesión
            </Button>
          </Form>
        )}
      </Card>
    </div>
  );
}
