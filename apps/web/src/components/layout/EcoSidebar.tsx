'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Layout, Menu, Avatar, Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import {
  LayoutDashboard,
  MessageSquare,
  Activity,
  Hash,
  MapPin,
  Bell,
  Settings,
  LogOut,
  ChevronsLeft,
  ChevronsRight,
  Globe,
} from 'lucide-react';
import { SIDEBAR } from '@/theme/constants';

const { Sider } = Layout;

const analysisItems = [
  { key: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { key: '/mentions', icon: MessageSquare, label: 'Menciones' },
  { key: '/sentiment', icon: Activity, label: 'Sentimiento' },
  { key: '/topics', icon: Hash, label: 'Tópicos' },
  { key: '/geography', icon: MapPin, label: 'Geografía' },
  { key: '/alerts', icon: Bell, label: 'Alertas' },
];

const systemItems = [
  { key: '/settings', icon: Settings, label: 'Configuración' },
];

function buildMenuItems(
  items: { key: string; icon: React.ComponentType<{ size?: number }>; label: string }[],
  collapsed: boolean,
): MenuProps['items'] {
  return items.map((item) => ({
    key: item.key,
    icon: <item.icon size={16} />,
    label: collapsed ? (
      <Tooltip title={item.label} placement="right">
        <span />
      </Tooltip>
    ) : (
      item.label
    ),
  }));
}

function handleLogout() {
  document.cookie = 'eco_id_token=; path=/; max-age=0';
  document.cookie = 'eco_access_token=; path=/; max-age=0';
  window.location.href = '/sign-in';
}

export function EcoSidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  const selectedKey =
    analysisItems.find((i) => pathname.startsWith(i.key))?.key ??
    systemItems.find((i) => pathname.startsWith(i.key))?.key ??
    '/dashboard';

  return (
    <Sider
      className="eco-sidebar"
      width={SIDEBAR.width}
      collapsedWidth={SIDEBAR.collapsedWidth}
      collapsible
      collapsed={collapsed}
      onCollapse={setCollapsed}
      trigger={null}
      style={{ height: '100vh', position: 'sticky', top: 0, overflow: 'auto' }}
    >
      {/* Logo */}
      <div className="eco-sidebar-logo">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="eco-sidebar-logo-icon">
            <Globe size={16} color="white" />
          </div>
          {!collapsed && (
            <div>
              <div style={{ color: '#fff', fontSize: 16, fontWeight: 800, letterSpacing: 2.5 }}>
                ECO
              </div>
              <div
                style={{
                  color: 'rgba(255,255,255,0.3)',
                  fontSize: 7,
                  letterSpacing: 1.5,
                  fontWeight: 500,
                }}
              >
                SOCIAL LISTENING
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Analysis section */}
      {!collapsed && <div className="eco-sidebar-section-label">Análisis</div>}
      <Menu
        theme="dark"
        mode="inline"
        selectedKeys={[selectedKey]}
        items={buildMenuItems(analysisItems, collapsed)}
        onClick={({ key }) => {
          // Using window.location for simplicity; Next.js router could be used
          // but Menu onClick doesn't have access to router easily
        }}
        style={{ background: 'transparent', borderRight: 0 }}
      />

      {/* System section */}
      {!collapsed && <div className="eco-sidebar-section-label">Sistema</div>}
      <Menu
        theme="dark"
        mode="inline"
        selectedKeys={[selectedKey]}
        items={buildMenuItems(systemItems, collapsed)}
        style={{ background: 'transparent', borderRight: 0 }}
      />

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* User info */}
      <div
        style={{
          padding: collapsed ? '12px 8px' : '12px 20px',
          borderTop: `1px solid ${SIDEBAR.dividerColor}`,
        }}
      >
        {!collapsed ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Avatar size={28} className="eco-avatar-gradient" style={{ flexShrink: 0 }}>
              AG
            </Avatar>
            <div style={{ overflow: 'hidden' }}>
              <div
                style={{
                  color: 'rgba(255,255,255,0.8)',
                  fontSize: 12,
                  fontWeight: 500,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                A. Gutierrez
              </div>
              <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10 }}>Admin</div>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <Avatar size={28} className="eco-avatar-gradient">
              AG
            </Avatar>
          </div>
        )}
      </div>

      {/* Logout */}
      <div
        style={{
          padding: collapsed ? '8px' : '8px 12px',
          borderTop: `1px solid ${SIDEBAR.dividerColor}`,
        }}
      >
        <Tooltip title="Cerrar sesión" placement="right">
          <button
            onClick={handleLogout}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: '8px 12px',
              borderRadius: 8,
              border: 'none',
              background: 'transparent',
              color: 'rgba(255,255,255,0.35)',
              cursor: 'pointer',
              fontSize: 11,
              justifyContent: collapsed ? 'center' : 'flex-start',
            }}
          >
            <LogOut size={14} />
            {!collapsed && 'Cerrar sesión'}
          </button>
        </Tooltip>
      </div>

      {/* Collapse toggle */}
      <div
        style={{
          padding: '8px 12px 12px',
          borderTop: `1px solid ${SIDEBAR.dividerColor}`,
        }}
      >
        <button
          onClick={() => setCollapsed(!collapsed)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: '100%',
            padding: '8px',
            borderRadius: 8,
            border: `1px solid rgba(255,255,255,0.06)`,
            background: 'transparent',
            color: 'rgba(255,255,255,0.3)',
            cursor: 'pointer',
            fontSize: 10,
            justifyContent: collapsed ? 'center' : 'flex-start',
          }}
        >
          {collapsed ? <ChevronsRight size={14} /> : <ChevronsLeft size={14} />}
          {!collapsed && 'Colapsar'}
        </button>
      </div>

      {/* Navigation links (hidden, for Next.js client-side routing) */}
      <nav style={{ display: 'none' }}>
        {[...analysisItems, ...systemItems].map((item) => (
          <Link key={item.key} href={item.key} id={`nav-${item.key.slice(1)}`}>
            {item.label}
          </Link>
        ))}
      </nav>
    </Sider>
  );
}
