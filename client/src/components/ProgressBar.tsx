interface ProgressBarProps {
  label: string;
  current: number;
  total: number;
  status: string;
}

export default function ProgressBar({ label, current, total, status }: ProgressBarProps) {
  const percentage = total > 0 ? Math.round((current / total) * 100) : 0;

  const statusColor = {
    complete: 'bg-emerald-500',
    partial: 'bg-yellow-500',
    failed: 'bg-red-500',
    running: 'bg-amber-500',
  }[status] || 'bg-slate-400';

  const statusBadge = {
    complete: 'bg-emerald-100 text-emerald-800',
    partial: 'bg-yellow-100 text-yellow-800',
    failed: 'bg-red-100 text-red-800',
    running: 'bg-amber-100 text-amber-800',
  }[status] || 'bg-stone-100 text-slate-700';

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center space-x-2">
          <span className="text-sm font-semibold text-slate-700 capitalize">{label.replace(/_/g, ' ')}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${statusBadge}`}>
            {status}
          </span>
        </div>
        <span className="text-sm text-slate-400 font-mono">
          {current}/{total} ({percentage}%)
        </span>
      </div>
      <div className="w-full bg-stone-200 rounded-full h-2.5">
        <div
          className={`h-2.5 rounded-full transition-all duration-500 ${statusColor}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
