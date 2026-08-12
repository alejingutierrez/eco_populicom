'use client';

import { useEffect, useMemo, useRef } from 'react';
import dynamic from 'next/dynamic';
import type { ForceGraphMethods } from 'react-force-graph-2d';
import { STATUS_COLORS, type NarrativeStatus } from './NarrativeStatusBadge';

// react-force-graph-2d uses canvas + window APIs → import only client-side.
const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), { ssr: false });

export interface GraphNode {
  id: string;
  name: string;
  status: NarrativeStatus | string;
  mentionCount: number;
  velocity24h: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: string;
  strength: number;
}

interface NarrativeGraphProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width: number;
  height: number;
  onNodeClick?: (node: GraphNode) => void;
  selectedId?: string | null;
}

export function NarrativeGraph({ nodes, edges, width, height, onNodeClick, selectedId }: NarrativeGraphProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<ForceGraphMethods<any, any> | undefined>(undefined);

  // Compute node radius proportional to sqrt(mentionCount). Clamp 4..28.
  const data = useMemo(() => {
    const minR = 4;
    const maxR = 28;
    const maxMentions = Math.max(1, ...nodes.map((n) => n.mentionCount));
    return {
      nodes: nodes.map((n) => ({
        ...n,
        val: Math.min(maxR, Math.max(minR, minR + (maxR - minR) * Math.sqrt(n.mentionCount / maxMentions))),
      })),
      links: edges.map((e) => ({ ...e })),
    };
  }, [nodes, edges]);

  useEffect(() => {
    // Zoom to fit on first render / data change.
    if (!fgRef.current || nodes.length === 0) return;
    const t = setTimeout(() => fgRef.current?.zoomToFit(400, 80), 600);
    return () => clearTimeout(t);
  }, [data]);

  return (
    <ForceGraph2D
      ref={fgRef as unknown as undefined}
      graphData={data}
      width={width}
      height={height}
      backgroundColor="#fafafa"
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      nodeLabel={(n: any) => `${n.name}\n${n.mentionCount} menciones · ${n.status}`}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      nodeCanvasObject={(node: any, ctx, globalScale) => {
        const color = STATUS_COLORS[node.status as NarrativeStatus] ?? '#999';
        const isSelected = selectedId === node.id;
        const radius = node.val ?? 6;

        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI, false);
        ctx.fillStyle = color;
        ctx.fill();
        if (isSelected) {
          ctx.lineWidth = 3 / globalScale;
          ctx.strokeStyle = '#0A7EA4';
          ctx.stroke();
        }

        // Label when zoomed in enough
        if (globalScale > 1.2 || isSelected) {
          const fontSize = Math.max(10, 12 / globalScale);
          ctx.font = `${fontSize}px Inter, system-ui, sans-serif`;
          ctx.fillStyle = '#262626';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          const label = node.name.length > 32 ? node.name.slice(0, 30) + '…' : node.name;
          ctx.fillText(label, node.x, node.y + radius + 2);
        }
      }}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      linkColor={() => 'rgba(10, 126, 164, 0.25)'}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      linkWidth={(l: any) => Math.max(0.5, Math.min(4, l.strength * 4))}
      cooldownTicks={120}
      d3VelocityDecay={0.3}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onNodeClick={(node: any) => onNodeClick?.(node as GraphNode)}
    />
  );
}
