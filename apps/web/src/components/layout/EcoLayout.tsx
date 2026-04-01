'use client';

import { Layout } from 'antd';
import { EcoSidebar } from './EcoSidebar';
import { EcoHeader } from './EcoHeader';

const { Content } = Layout;

export function EcoLayout({ children }: { children: React.ReactNode }) {
  return (
    <Layout style={{ minHeight: '100vh' }}>
      <EcoSidebar />
      <Layout>
        <EcoHeader />
        <Content
          style={{
            padding: '22px 24px',
            background: '#F4F7FA',
            overflowY: 'auto',
            minHeight: 'calc(100vh - 56px)',
          }}
        >
          {children}
        </Content>
      </Layout>
    </Layout>
  );
}
