interface CategoryData {
  source?: number;
  destination?: number;
  match?: boolean;
  error?: string;
  found?: number;
  migrated?: number;
  skipped_channel_managed?: number;
  failed?: number;
}

interface DiffReportProps {
  report: Record<string, CategoryData>;
}

function isPhotoEntry(key: string, data: CategoryData): boolean {
  return key === 'photos' || data.found !== undefined || data.migrated !== undefined;
}

export default function DiffReport({ report }: DiffReportProps) {
  if (!report || Object.keys(report).length === 0) {
    return <p className="text-slate-400 text-center py-8">No report data available.</p>;
  }

  const standardEntries = Object.entries(report).filter(([key, data]) => !isPhotoEntry(key, data));
  const photoEntry = report.photos && isPhotoEntry('photos', report.photos) ? report.photos : null;

  const allMatch = standardEntries.every(([, r]) => r.match);

  return (
    <div>
      <div className={`mb-4 p-4 rounded-xl ${allMatch ? 'bg-emerald-50 border border-emerald-200' : 'bg-yellow-50 border border-yellow-200'}`}>
        <p className={`font-semibold ${allMatch ? 'text-emerald-800' : 'text-yellow-800'}`}>
          {allMatch
            ? 'All categories match between source and destination.'
            : 'Some categories have mismatched counts. Review the details below.'}
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-[#fafaf8]">
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 border-b border-stone-200">Category</th>
              <th className="px-4 py-3 text-right text-sm font-semibold text-slate-700 border-b border-stone-200">Source</th>
              <th className="px-4 py-3 text-right text-sm font-semibold text-slate-700 border-b border-stone-200">Destination</th>
              <th className="px-4 py-3 text-center text-sm font-semibold text-slate-700 border-b border-stone-200">Status</th>
            </tr>
          </thead>
          <tbody>
            {standardEntries.map(([category, data]) => (
              <tr key={category} className="border-b border-stone-100 hover:bg-[#fafaf8] transition-colors">
                <td className="px-4 py-3 text-sm font-semibold text-slate-900 capitalize">{category.replace(/_/g, ' ')}</td>
                <td className="px-4 py-3 text-sm text-slate-600 text-right font-mono">{(data.source ?? 0).toLocaleString()}</td>
                <td className="px-4 py-3 text-sm text-slate-600 text-right font-mono">{(data.destination ?? 0).toLocaleString()}</td>
                <td className="px-4 py-3 text-center">
                  {data.match ? (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
                      Match
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-800">
                      Mismatch
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {photoEntry && (
        <div className="mt-6">
          <h4 className="text-sm font-bold text-slate-700 mb-3">Photo Migration</h4>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-[#fafaf8]">
                  <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 border-b border-stone-200">Category</th>
                  <th className="px-4 py-3 text-right text-sm font-semibold text-slate-700 border-b border-stone-200">Found</th>
                  <th className="px-4 py-3 text-right text-sm font-semibold text-slate-700 border-b border-stone-200">Migrated</th>
                  <th className="px-4 py-3 text-right text-sm font-semibold text-slate-700 border-b border-stone-200">Channel-Skipped</th>
                  <th className="px-4 py-3 text-right text-sm font-semibold text-slate-700 border-b border-stone-200">Failed</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-stone-100 hover:bg-[#fafaf8] transition-colors">
                  <td className="px-4 py-3 text-sm font-semibold text-slate-900">Photos</td>
                  <td className="px-4 py-3 text-sm text-slate-600 text-right font-mono">{(photoEntry.found ?? 0).toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm text-slate-600 text-right font-mono">{(photoEntry.migrated ?? 0).toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm text-slate-600 text-right font-mono">{(photoEntry.skipped_channel_managed ?? 0).toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm text-right font-mono">
                    {(photoEntry.failed ?? 0) > 0 ? (
                      <span className="text-red-600 font-semibold">{(photoEntry.failed ?? 0).toLocaleString()}</span>
                    ) : (
                      (photoEntry.failed ?? 0).toLocaleString()
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
