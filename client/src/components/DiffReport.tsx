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
    return <p className="text-gray-500 text-center py-8">No report data available.</p>;
  }

  const standardEntries = Object.entries(report).filter(([key, data]) => !isPhotoEntry(key, data));
  const photoEntry = report.photos && isPhotoEntry('photos', report.photos) ? report.photos : null;

  const allMatch = standardEntries.every(([, r]) => r.match);

  return (
    <div>
      <div className={`mb-4 p-4 rounded-lg ${allMatch ? 'bg-green-50 border border-green-200' : 'bg-yellow-50 border border-yellow-200'}`}>
        <p className={`font-medium ${allMatch ? 'text-green-800' : 'text-yellow-800'}`}>
          {allMatch
            ? 'All categories match between source and destination!'
            : 'Some categories have mismatched counts. Review the details below.'}
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-gray-50">
              <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700 border-b">Category</th>
              <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700 border-b">Source</th>
              <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700 border-b">Destination</th>
              <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700 border-b">Status</th>
            </tr>
          </thead>
          <tbody>
            {standardEntries.map(([category, data]) => (
              <tr key={category} className="border-b hover:bg-gray-50">
                <td className="px-4 py-3 text-sm font-medium text-gray-900 capitalize">{category}</td>
                <td className="px-4 py-3 text-sm text-gray-600 text-right">{(data.source ?? 0).toLocaleString()}</td>
                <td className="px-4 py-3 text-sm text-gray-600 text-right">{(data.destination ?? 0).toLocaleString()}</td>
                <td className="px-4 py-3 text-center">
                  {data.match ? (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                      Match
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
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
          <h4 className="text-sm font-semibold text-gray-700 mb-3">Photo Migration</h4>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700 border-b">Category</th>
                  <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700 border-b">Found</th>
                  <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700 border-b">Migrated</th>
                  <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700 border-b">Channel-Skipped</th>
                  <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700 border-b">Failed</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">Photos</td>
                  <td className="px-4 py-3 text-sm text-gray-600 text-right">{(photoEntry.found ?? 0).toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm text-gray-600 text-right">{(photoEntry.migrated ?? 0).toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm text-gray-600 text-right">{(photoEntry.skipped_channel_managed ?? 0).toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm text-gray-600 text-right">
                    {(photoEntry.failed ?? 0) > 0 ? (
                      <span className="text-red-600 font-medium">{(photoEntry.failed ?? 0).toLocaleString()}</span>
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
