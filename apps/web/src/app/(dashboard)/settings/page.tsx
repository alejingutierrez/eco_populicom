import { Card, CardTitle } from '@/components/ui/card';

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-foreground">Configuración</h1>

      <Card>
        <CardTitle>Agencia</CardTitle>
        <div className="mt-3 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Nombre</span>
            <span className="text-foreground">Autoridad de Acueductos y Alcantarillados</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Brandwatch Project ID</span>
            <span className="font-mono text-foreground">1998403803</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Brandwatch Query ID</span>
            <span className="font-mono text-foreground">2003911540</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Polling</span>
            <span className="text-foreground">Cada 5 minutos</span>
          </div>
        </div>
      </Card>

      <Card>
        <CardTitle>NLP</CardTitle>
        <div className="mt-3 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Modelo</span>
            <span className="text-foreground">Claude Opus (Bedrock)</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Sentimiento</span>
            <span className="text-foreground">3 niveles + 7 emociones</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Tópicos</span>
            <span className="text-foreground">10 fijos + subtópicos</span>
          </div>
        </div>
      </Card>

      <Card>
        <CardTitle>Plataforma</CardTitle>
        <div className="mt-3 space-y-2 text-sm text-muted-foreground">
          <p>ECO v0.1.0 — Social Listening Platform</p>
          <p>Gobierno de Puerto Rico · Populicom</p>
        </div>
      </Card>
    </div>
  );
}
