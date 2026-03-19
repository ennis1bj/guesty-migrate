interface Step {
  label: string;
  description: string;
}

interface StepWizardProps {
  steps: Step[];
  currentStep: number;
}

export default function StepWizard({ steps, currentStep }: StepWizardProps) {
  return (
    <nav className="mb-8">
      <ol className="flex items-center">
        {steps.map((step, index) => (
          <li key={step.label} className={`flex items-center ${index < steps.length - 1 ? 'flex-1' : ''}`}>
            <div className="flex items-center">
              <div
                className={`flex items-center justify-center w-10 h-10 rounded-xl border-2 text-sm font-bold transition-all duration-200 ${
                  index < currentStep
                    ? 'bg-amber-500 border-amber-500 text-slate-900'
                    : index === currentStep
                    ? 'border-amber-500 text-amber-600 bg-white'
                    : 'border-stone-300 text-slate-400 bg-white'
                }`}
              >
                {index < currentStep ? (
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                ) : (
                  index + 1
                )}
              </div>
              <div className="ml-3 hidden sm:block">
                <p className={`text-sm font-semibold ${index <= currentStep ? 'text-slate-900' : 'text-slate-400'}`}>
                  {step.label}
                </p>
                <p className="text-xs text-slate-400">{step.description}</p>
              </div>
            </div>
            {index < steps.length - 1 && (
              <div className={`flex-1 h-0.5 mx-4 rounded ${index < currentStep ? 'bg-amber-500' : 'bg-stone-300'}`} />
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
