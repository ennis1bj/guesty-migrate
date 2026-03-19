interface ManifestCardProps {
  manifest: Record<string, number>;
  selectedCategories: string[];
  onToggleCategory: (category: string) => void;
}

const CATEGORY_ICONS: Record<string, string> = {
  custom_fields: 'M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z',
  listings: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
  reservations: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
  guests: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z',
  owners: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
  automations: 'M13 10V3L4 14h7v7l9-11h-7z',
  tasks: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
};

export default function ManifestCard({ manifest, selectedCategories, onToggleCategory }: ManifestCardProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {Object.entries(manifest).map(([category, count]) => {
        const selected = selectedCategories.includes(category);
        return (
          <button
            key={category}
            onClick={() => onToggleCategory(category)}
            className={`p-4 rounded-xl border-2 text-left transition-all ${
              selected
                ? 'border-indigo-600 bg-indigo-50 shadow-sm'
                : 'border-gray-200 bg-white hover:border-gray-300'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <svg
                className={`w-6 h-6 ${selected ? 'text-indigo-600' : 'text-gray-400'}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d={CATEGORY_ICONS[category] || CATEGORY_ICONS.tasks} />
              </svg>
              <div
                className={`w-5 h-5 rounded border-2 flex items-center justify-center ${
                  selected ? 'bg-indigo-600 border-indigo-600' : 'border-gray-300'
                }`}
              >
                {selected && (
                  <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
              </div>
            </div>
            <h3 className="text-lg font-semibold capitalize text-gray-900">{category}</h3>
            <p className="text-2xl font-bold text-indigo-600">{count.toLocaleString()}</p>
          </button>
        );
      })}
    </div>
  );
}
