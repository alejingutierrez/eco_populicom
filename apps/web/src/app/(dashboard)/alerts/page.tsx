'use client';

import { useEffect, useState } from 'react';
import { Card, CardTitle } from '@/components/ui/card';
import { Bell, Plus, Trash2 } from 'lucide-react';

interface AlertRule {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  config: { type: string; [key: string]: unknown };
  notifyEmails: string[];
  createdAt: string;
}

interface AlertHistoryItem {
  id: string;
  ruleName: string;
  triggeredAt: string;
  sentiment: string;
  mentionCount: number;
}

export default function AlertsPage() {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [history, setHistory] = useState<AlertHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch('/api/alerts').then((r) => r.json()),
      fetch('/api/alerts/history').then((r) => r.json()),
    ])
      .then(([rulesData, historyData]) => {
        setRules(rulesData.rules ?? []);
        setHistory(historyData.history ?? []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  async function toggleRule(id: string, isActive: boolean) {
    await fetch(`/api/alerts/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !isActive }),
    });
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, isActive: !isActive } : r)));
  }

  if (loading) {
    return <div className="flex h-64 items-center justify-center text-muted-foreground">Cargando...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-foreground">Alertas</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          <Plus className="h-4 w-4" />
          Nueva Regla
        </button>
      </div>

      {/* Active rules */}
      <Card>
        <CardTitle>Reglas de Alerta</CardTitle>
        {rules.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No hay reglas configuradas</p>
        ) : (
          <div className="mt-3 space-y-3">
            {rules.map((rule) => (
              <div key={rule.id} className="flex items-center justify-between rounded-md border border-border/50 p-3">
                <div className="flex items-center gap-3">
                  <Bell className={`h-4 w-4 ${rule.isActive ? 'text-primary' : 'text-muted-foreground'}`} />
                  <div>
                    <p className="text-sm font-medium text-foreground">{rule.name}</p>
                    <p className="text-xs text-muted-foreground">
                      Tipo: {rule.config.type} · Emails: {rule.notifyEmails.join(', ')}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => toggleRule(rule.id, rule.isActive)}
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      rule.isActive
                        ? 'bg-positive/15 text-positive'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {rule.isActive ? 'Activa' : 'Inactiva'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Alert history */}
      <Card>
        <CardTitle>Historial de Alertas</CardTitle>
        {history.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No se han disparado alertas</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="pb-2 font-medium">Regla</th>
                  <th className="pb-2 font-medium">Fecha</th>
                  <th className="pb-2 font-medium">Sentimiento</th>
                  <th className="pb-2 text-right font-medium">Menciones</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="border-b border-border/50">
                    <td className="py-2 text-foreground">{h.ruleName}</td>
                    <td className="py-2 text-muted-foreground">
                      {new Date(h.triggeredAt).toLocaleString('es-PR')}
                    </td>
                    <td className="py-2">{h.sentiment}</td>
                    <td className="py-2 text-right">{h.mentionCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
