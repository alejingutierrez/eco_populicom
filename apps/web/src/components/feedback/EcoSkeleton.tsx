import { Skeleton, Card } from 'antd';

type SkeletonVariant = 'stat-card' | 'chart' | 'table' | 'mention-list' | 'drawer';

interface EcoSkeletonProps {
  variant: SkeletonVariant;
  count?: number;
}

function StatCardSkeleton() {
  return (
    <Card size="small">
      <Skeleton active title={{ width: '40%' }} paragraph={{ rows: 1, width: ['60%'] }} />
    </Card>
  );
}

function ChartSkeleton() {
  return (
    <Card size="small">
      <Skeleton active title={{ width: '30%' }} paragraph={{ rows: 4 }} />
    </Card>
  );
}

function TableSkeleton({ count = 5 }: { count: number }) {
  return (
    <div>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton
          key={i}
          active
          avatar={false}
          title={false}
          paragraph={{ rows: 1, width: '100%' }}
          style={{ marginBottom: 12 }}
        />
      ))}
    </div>
  );
}

function MentionListSkeleton({ count = 3 }: { count: number }) {
  return (
    <div>
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i} size="small" style={{ marginBottom: 8 }}>
          <Skeleton active avatar={false} title={{ width: '70%' }} paragraph={{ rows: 1, width: ['40%'] }} />
        </Card>
      ))}
    </div>
  );
}

function DrawerSkeleton() {
  return (
    <div>
      <Skeleton active avatar={{ shape: 'square', size: 20 }} paragraph={{ rows: 0 }} style={{ marginBottom: 16 }} />
      <Skeleton active title={{ width: '80%' }} paragraph={{ rows: 3 }} />
      <Skeleton active title={{ width: '30%' }} paragraph={{ rows: 2, width: ['50%', '40%'] }} style={{ marginTop: 16 }} />
    </div>
  );
}

export function EcoSkeleton({ variant, count = 5 }: EcoSkeletonProps) {
  switch (variant) {
    case 'stat-card':
      return <StatCardSkeleton />;
    case 'chart':
      return <ChartSkeleton />;
    case 'table':
      return <TableSkeleton count={count} />;
    case 'mention-list':
      return <MentionListSkeleton count={count} />;
    case 'drawer':
      return <DrawerSkeleton />;
  }
}
