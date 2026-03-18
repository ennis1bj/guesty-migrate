interface ProgressBarProps {
  label: string;
  current: number;
  total: number;
  status: string;
}

export default function ProgressBar({ label, current, total, status }: ProgressBarProps) {
  const percentage = total > 0 ? Math.round((current / total) * 100) : 0;

  const statusColor = {
    complete: 'bg-green-500',
    partial: 'bg-yellow-500',
    failed: 'bg-red-500',
    running: 'bg-indigo-500',
  }[status] || 'bg-gray-400';

  const statusBadge = {
    complete: 'bg-green-100 text-green-800',
    partial: 'bg-yellow-100 text-yellow-800',
    failed: 'bg-red-100 text-red-800',
    running: 'bg-indigo-100 text-indigo-800',
  }[status] || 'bg-gray-100 text-gray-800';

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center space-x-2">
          <span className="text-sm font-medium text-gray-700 capitalize">{label}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusBadge}`}>
            {status}
          </span>
        </div>
        <span className="text-sm text-gray-500">
          {current}/{total} ({percentage}%)
        </span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2.5">
        <div
          className={`h-2.5 rounded-full transition-all duration-500 ${statusColor}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
