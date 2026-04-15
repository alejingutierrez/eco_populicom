'use client';

import { usePathname } from 'next/navigation';
import { useAgency } from '@/contexts/AgencyContext';
import { Layout, Breadcrumb, Select, DatePicker, Avatar, Space, Tooltip } from 'antd';
import { Building2, Calendar } from 'lucide-react';
import dayjs from 'dayjs';

const { Header } = Layout;
const { RangePicker } = DatePicker;

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/mentions': 'Menciones',
  '/sentiment': 'Sentimiento',
  '/topics': 'Tópicos',
  '/geography': 'Geografía',
  '/alerts': 'Alertas',
  '/settings': 'Configuración',
};

export function EcoHeader() {
  const pathname = usePathname();
  const pageTitle = PAGE_TITLES[pathname] ?? 'Dashboard';
  const { agencies, selectedAgency, setAgency, isLoading } = useAgency();

  return (
    <Header
      className="eco-header"
      style={{
        background: '#fff',
        padding: '0 28px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        height: 56,
        lineHeight: 'normal',
      }}
    >
      {/* Left: Breadcrumbs + Title */}
      <div>
        <Breadcrumb
          items={[{ title: 'Inicio' }, { title: pageTitle }]}
          style={{ marginBottom: 2 }}
        />
        <div
          style={{
            fontSize: 17,
            fontWeight: 700,
            color: '#0E1E2C',
            letterSpacing: -0.3,
            lineHeight: 1.2,
          }}
        >
          {pageTitle}
        </div>
      </div>

      {/* Right: Agency selector + Date range + User */}
      <Space size={10}>
        {/* Agency selector */}
        <Select
          value={selectedAgency}
          onChange={setAgency}
          loading={isLoading}
          style={{ minWidth: 200 }}
          suffixIcon={<Building2 size={14} color="#0A7EA4" />}
          options={agencies.map((a) => ({
            value: a.slug,
            label: a.name,
          }))}
        />

        {/* Date range picker */}
        <RangePicker
          defaultValue={[dayjs().startOf('month'), dayjs()]}
          format="MMM D, YYYY"
          suffixIcon={<Calendar size={14} color="#64748B" />}
          style={{ minWidth: 240 }}
        />

        {/* User avatar */}
        <Tooltip title="A. Gutierrez — Admin">
          <Avatar
            size={32}
            className="eco-avatar-gradient"
            style={{ cursor: 'pointer', fontSize: 11, fontWeight: 700 }}
          >
            AG
          </Avatar>
        </Tooltip>
      </Space>
    </Header>
  );
}
