interface DiffReportProps {
  report: Record<string, { source: number; destination: number; match: boolean; error?: string }>;
}

export default function DiffReport({ report }: DiffReportProps) {
  if (!report || Object.keys(report).length === 0) {
    return <p className="text-gray-500 text-center py-8">No report data available.</p>;
  }

  const allMatch = Object.values(report).every((r) => r.match);

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
            {Object.entries(report).map(([category, data]) => (
              <tr key={category} className="border-b hover:bg-gray-50">
                <td className="px-4 py-3 text-sm font-medium text-gray-900 capitalize">{category}</td>
                <td className="px-4 py-3 text-sm text-gray-600 text-right">{data.source.toLocaleString()}</td>
                <td className="px-4 py-3 text-sm text-gray-600 text-right">{data.destination.toLocaleString()}</td>
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
    </div>
  );
}
