interface ProgressBarProps {
  percentage: number;
  color?: string;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
}

const colorMap: Record<string, { bg: string; fill: string }> = {
  amber: { bg: "bg-amber-100", fill: "bg-amber-500" },
  emerald: { bg: "bg-emerald-100", fill: "bg-emerald-500" },
  violet: { bg: "bg-violet-100", fill: "bg-violet-500" },
  blue: { bg: "bg-blue-100", fill: "bg-blue-500" },
  slate: { bg: "bg-slate-200", fill: "bg-slate-600" },
};

const sizeMap: Record<string, string> = {
  sm: "h-1.5",
  md: "h-2.5",
  lg: "h-4",
};

export default function ProgressBar({
  percentage,
  color = "amber",
  size = "md",
  showLabel = false,
}: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, percentage));
  const colors = colorMap[color] ?? colorMap.amber;
  const heightClass = sizeMap[size];

  return (
    <div className="w-full">
      {showLabel && (
        <div className="flex justify-between items-center mb-1">
          <span className="text-xs font-medium text-slate-600">Progress</span>
          <span className="text-xs font-semibold text-slate-700">
            {Math.round(clamped)}%
          </span>
        </div>
      )}
      <div
        className={`w-full ${colors.bg} rounded-full overflow-hidden ${heightClass}`}
      >
        <div
          className={`${colors.fill} ${heightClass} rounded-full transition-all duration-500 ease-out`}
          style={{ width: `${clamped}%` }}
          role="progressbar"
          aria-valuenow={clamped}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
    </div>
  );
}
