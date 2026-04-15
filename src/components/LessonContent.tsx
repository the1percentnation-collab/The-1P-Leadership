"use client";

interface LessonContentProps {
  content: string;
  lessonTitle: string;
  objectives: string[];
  duration: string;
  isCompleted: boolean;
  onComplete: () => void;
}

function markdownToHtml(markdown: string): string {
  let html = markdown
    // Escape HTML entities first (but preserve intentional HTML)
    // Convert headings: ### h3, ## h2, # h1
    .replace(/^### (.+)$/gm, '<h3 class="text-lg font-bold text-slate-800 mt-6 mb-2">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-xl font-bold text-slate-900 mt-8 mb-3">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-2xl font-bold text-slate-900 mt-8 mb-4">$1</h1>')
    // Bold text
    .replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold text-slate-900">$1</strong>')
    // Italic text
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Unordered list items
    .replace(/^- (.+)$/gm, '<li class="ml-4 text-slate-700 leading-relaxed">$1</li>')
    // Ordered list items
    .replace(/^\d+\. (.+)$/gm, '<li class="ml-4 text-slate-700 leading-relaxed list-decimal">$1</li>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code class="bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded text-sm font-mono">$1</code>')
    // Horizontal rules
    .replace(/^---$/gm, '<hr class="my-6 border-slate-200" />')
    // Blockquotes
    .replace(/^> (.+)$/gm, '<blockquote class="border-l-4 border-amber-400 pl-4 py-1 my-4 text-slate-600 italic">$1</blockquote>');

  // Wrap consecutive <li> elements in <ul>
  html = html.replace(
    /((?:<li class="ml-4 text-slate-700 leading-relaxed">.*?<\/li>\n?)+)/g,
    '<ul class="list-disc space-y-1 my-4">$1</ul>'
  );

  // Convert remaining double newlines to paragraph breaks
  html = html
    .split(/\n\n+/)
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return "";
      // Don't wrap blocks that already have HTML tags
      if (/^<(h[1-6]|ul|ol|li|blockquote|hr|div|p)/.test(trimmed)) {
        return trimmed;
      }
      return `<p class="text-slate-700 leading-relaxed mb-4">${trimmed}</p>`;
    })
    .join("\n");

  // Convert single newlines within paragraphs to <br>
  html = html.replace(/([^>\n])\n([^<\n])/g, "$1<br />$2");

  return html;
}

export default function LessonContent({
  content,
  lessonTitle,
  objectives,
  duration,
  isCompleted,
  onComplete,
}: LessonContentProps) {
  return (
    <div className="max-w-3xl mx-auto">
      {/* Lesson Header */}
      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-3">
          {lessonTitle}
        </h1>
        <div className="flex items-center gap-4 text-sm text-slate-500">
          <span className="flex items-center gap-1.5">
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            {duration}
          </span>
          {isCompleted && (
            <span className="flex items-center gap-1.5 text-emerald-600 font-medium">
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              Completed
            </span>
          )}
        </div>
      </div>

      {/* Objectives */}
      {objectives.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 mb-8">
          <h2 className="text-sm font-bold text-amber-800 uppercase tracking-wider mb-3">
            Learning Objectives
          </h2>
          <ul className="space-y-2">
            {objectives.map((objective, index) => (
              <li key={index} className="flex items-start gap-2.5">
                <svg
                  className="w-5 h-5 text-amber-500 shrink-0 mt-0.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <span className="text-sm text-amber-900">{objective}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Content */}
      <article
        className="prose-custom mb-12"
        dangerouslySetInnerHTML={{ __html: markdownToHtml(content) }}
      />

      {/* Mark as Complete */}
      <div className="border-t border-slate-200 pt-8 mb-8">
        {isCompleted ? (
          <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-xl px-5 py-4">
            <svg
              className="w-6 h-6 text-emerald-600 shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span className="text-sm font-semibold text-emerald-800">
              You have completed this lesson.
            </span>
          </div>
        ) : (
          <button
            type="button"
            onClick={onComplete}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4.5 12.75l6 6 9-13.5"
              />
            </svg>
            Mark as Complete
          </button>
        )}
      </div>
    </div>
  );
}
