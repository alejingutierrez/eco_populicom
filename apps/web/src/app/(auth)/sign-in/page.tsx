'use client';

import { Suspense, useState } from 'react';
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
      setError(err.message || 'Error al iniciar sesion');
    } finally {
      setLoading(false);
    }
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
            Social Listening — Gobierno de Puerto Rico
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
            label="Correo electronico"
            name="email"
            rules={[
              { required: true, message: 'Ingrese su correo electronico' },
              { type: 'email', message: 'Correo electronico invalido' },
            ]}
          >
            <Input placeholder="usuario@agencia.pr.gov" />
          </Form.Item>

          <Form.Item
            label="Contrasena"
            name="password"
            rules={[
              { required: true, message: 'Ingrese su contrasena' },
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
              Iniciar sesion
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
