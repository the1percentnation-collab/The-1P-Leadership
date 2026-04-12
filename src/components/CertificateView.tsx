"use client";

import type { Certificate } from "@/types";

interface CertificateViewProps {
  certificate: Certificate;
}

const levelColors: Record<number, { border: string; accent: string; bg: string; label: string }> = {
  1: {
    border: "border-amber-400",
    accent: "text-amber-600",
    bg: "from-amber-50 to-white",
    label: "Foundations of Leadership",
  },
  2: {
    border: "border-emerald-400",
    accent: "text-emerald-600",
    bg: "from-emerald-50 to-white",
    label: "Advanced Leadership",
  },
  3: {
    border: "border-violet-400",
    accent: "text-violet-600",
    bg: "from-violet-50 to-white",
    label: "Executive Leadership",
  },
};

export default function CertificateView({ certificate }: CertificateViewProps) {
  const style = levelColors[certificate.level] ?? levelColors[1];
  const issueDate = new Date(certificate.issuedAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="print:shadow-none">
      <div
        className={`relative bg-gradient-to-br ${style.bg} border-4 ${style.border} rounded-2xl p-1 shadow-xl max-w-3xl mx-auto`}
      >
        {/* Inner border */}
        <div className="border-2 border-slate-200 rounded-xl px-8 py-12 sm:px-16 sm:py-16 text-center">
          {/* Corner Decorations */}
          <div className="absolute top-4 left-4 w-8 h-8 border-t-2 border-l-2 border-amber-300 rounded-tl-lg" />
          <div className="absolute top-4 right-4 w-8 h-8 border-t-2 border-r-2 border-amber-300 rounded-tr-lg" />
          <div className="absolute bottom-4 left-4 w-8 h-8 border-b-2 border-l-2 border-amber-300 rounded-bl-lg" />
          <div className="absolute bottom-4 right-4 w-8 h-8 border-b-2 border-r-2 border-amber-300 rounded-br-lg" />

          {/* Header Emblem */}
          <div className="mb-6">
            <span className="text-amber-400 text-4xl">&#9670;</span>
          </div>

          {/* Organization */}
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-800 tracking-wide mb-1">
            The One Percent Nation
          </h1>
          <p className="text-sm text-slate-500 tracking-widest uppercase mb-8">
            Leadership Certification
          </p>

          {/* Divider */}
          <div className="flex items-center justify-center gap-3 mb-8">
            <div className="h-px bg-slate-300 w-16" />
            <span className="text-slate-400 text-xs">&#9670;</span>
            <div className="h-px bg-slate-300 w-16" />
          </div>

          {/* Certificate Text */}
          <p className="text-sm text-slate-500 mb-3">
            This certifies that
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-3 font-serif">
            {certificate.holderName}
          </h2>
          <p className="text-sm text-slate-500 mb-6">
            has successfully completed
          </p>

          {/* Course / Level */}
          <div className="inline-block mb-6">
            <span
              className={`text-lg sm:text-xl font-bold ${style.accent}`}
            >
              Level {certificate.level}: {certificate.courseName}
            </span>
          </div>

          <p className="text-sm text-slate-500 mb-1">
            {style.label}
          </p>

          {/* Divider */}
          <div className="flex items-center justify-center gap-3 my-8">
            <div className="h-px bg-slate-300 w-16" />
            <span className="text-slate-400 text-xs">&#9670;</span>
            <div className="h-px bg-slate-300 w-16" />
          </div>

          {/* Date and Certificate Number */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-6 sm:gap-12">
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">
                Date Issued
              </p>
              <p className="text-sm font-semibold text-slate-700">{issueDate}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">
                Certificate No.
              </p>
              <p className="text-sm font-mono font-semibold text-slate-700">
                {certificate.certificateNumber}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Print Button */}
      <div className="text-center mt-6 print:hidden">
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold rounded-lg transition-colors"
        >
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
              d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0110.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0l.229 2.523a1.125 1.125 0 01-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0021 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 00-1.913-.247M6.34 18H5.25A2.25 2.25 0 013 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 011.913-.247m10.5 0a48.536 48.536 0 00-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18.75 12h.008v.008h-.008V12zm-3 0h.008v.008H15.75V12z"
            />
          </svg>
          Print Certificate
        </button>
      </div>
    </div>
  );
}
