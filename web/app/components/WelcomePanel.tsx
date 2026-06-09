const suggestions = [
  ["[+] summarize", "Review the current CAKE architecture"],
  ["[+] automate", "Create a plan for tomorrow from my todos"],
  ["[+] search", "Find the latest context before answering"],
  ["[+] files", "Draft a stable module boundary for a new tool"],
];

interface WelcomePanelProps {
  selectedModel: string;
  onPick: (value: string) => void;
}

export function WelcomePanel({ selectedModel, onPick }: WelcomePanelProps) {
  return (
    <div className="flex min-h-full items-center justify-center px-4 py-10">
      <div className="w-full max-w-225">
        <div className="mb-8 flex items-center justify-center gap-4 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-canvas text-[18px] font-bold text-ink">
            CA
          </div>
          <h1 className="text-[30px] font-bold leading-normal md:text-[38px]">
            {selectedModel}
          </h1>
        </div>
        <div className="mx-auto max-w-180 border border-hairline bg-surface-dark p-4">
          <div className="mb-4 text-[16px] leading-6 text-ash">
            | How can CAKE core help today?
          </div>
          <div className="flex items-center gap-2 text-ash">
            <span>[+]</span>
            <span>[tools]</span>
            <span>[voice]</span>
          </div>
        </div>
        <div className="mx-auto mt-8 max-w-155">
          <p className="mb-3 text-[14px] font-bold leading-7 text-ash">
            [+] Suggested
          </p>
          <div className="space-y-2">
            {suggestions.map(([label, prompt]) => (
              <button
                key={prompt}
                type="button"
                onClick={() => onPick(prompt)}
                className="block w-full rounded-sm px-3 py-2 text-left text-[15px] leading-6 text-canvas hover:bg-surface-dark-elevated"
              >
                <span className="text-ash">{label}</span>
                <span className="ml-3">{prompt}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
