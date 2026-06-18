'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, Form, Input, Button, Alert, Typography } from 'antd';
import { signIn } from '@/lib/auth/cognito';

const { Title, Text } = Typography;

interface SignInFormValues {
  email: string;
  password: string;
}

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
  const [loading, setLoading] = useState(false);

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

  async function handleFinish(values: SignInFormValues) {
    setError('');
    setLoading(true);
    try {
      const result = await signIn(values.email, values.password);
      // Hand tokens to the server so it can set httpOnly/SameSite=Strict
      // cookies that neither JS nor CSRF requests can read.
      const res = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ idToken: result.idToken, refreshToken: result.refreshToken }),
      });
      if (!res.ok) throw new Error('No se pudo iniciar la sesión');
      const next = search?.get('next') || '/dashboard';
      router.push(next.startsWith('/') ? next : '/dashboard');
    } catch (err: any) {
      setError(err.message || 'Error al iniciar sesión');
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

        {error && (
          <Alert
            message={error}
            type="error"
            showIcon
            style={{ marginBottom: 24 }}
          />
        )}

        <Form<SignInFormValues>
          layout="vertical"
          onFinish={handleFinish}
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
            <Input placeholder="usuario@agencia.pr.gov" />
          </Form.Item>

          <Form.Item
            label="Contraseña"
            name="password"
            rules={[
              { required: true, message: 'Ingrese su contraseña' },
            ]}
          >
            <Input.Password />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0 }}>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              block
            >
              Iniciar sesión
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
