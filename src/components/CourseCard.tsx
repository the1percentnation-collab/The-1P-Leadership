"use client";

import Link from "next/link";
import type { Course } from "@/types";
import ProgressBar from "./ProgressBar";

interface CourseCardProps {
  course: Course;
  progress: number;
  enrolled: boolean;
}

const colorStyles: Record<
  string,
  { border: string; badge: string; button: string; accent: string }
> = {
  amber: {
    border: "border-amber-400",
    badge: "bg-amber-100 text-amber-800",
    button: "bg-amber-500 hover:bg-amber-600",
    accent: "text-amber-600",
  },
  emerald: {
    border: "border-emerald-400",
    badge: "bg-emerald-100 text-emerald-800",
    button: "bg-emerald-500 hover:bg-emerald-600",
    accent: "text-emerald-600",
  },
  violet: {
    border: "border-violet-400",
    badge: "bg-violet-100 text-violet-800",
    button: "bg-violet-500 hover:bg-violet-600",
    accent: "text-violet-600",
  },
};

export default function CourseCard({
  course,
  progress,
  enrolled,
}: CourseCardProps) {
  const styles = colorStyles[course.color] ?? colorStyles.amber;

  return (
    <div
      className={`bg-white rounded-xl border-l-4 ${styles.border} shadow-sm hover:shadow-md transition-shadow flex flex-col overflow-hidden`}
    >
      <div className="p-6 flex flex-col flex-1">
        {/* Badge and Level */}
        <div className="flex items-center justify-between mb-3">
          <span className={`text-sm font-semibold px-3 py-1 rounded-full ${styles.badge}`}>
            Level {course.level}
          </span>
          <span className="text-2xl" role="img" aria-label="course badge">
            {course.badge}
          </span>
        </div>

        {/* Title & Subtitle */}
        <h3 className="text-lg font-bold text-slate-900 mb-1">{course.title}</h3>
        <p className={`text-sm font-medium ${styles.accent} mb-2`}>
          {course.subtitle}
        </p>

        {/* Description */}
        <p className="text-sm text-slate-600 leading-relaxed mb-4 flex-1">
          {course.description}
        </p>

        {/* Prerequisites */}
        {course.prerequisites.length > 0 && (
          <div className="mb-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
              Prerequisites
            </p>
            <ul className="space-y-0.5">
              {course.prerequisites.map((prereq) => (
                <li key={prereq} className="text-xs text-slate-500 flex items-center gap-1">
                  <svg
                    className="w-3 h-3 text-slate-400 shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
                    />
                  </svg>
                  {prereq}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Progress Bar (if enrolled) */}
        {enrolled && (
          <div className="mb-4">
            <ProgressBar
              percentage={progress}
              color={course.color}
              size="sm"
              showLabel
            />
          </div>
        )}

        {/* Action Button */}
        <Link
          href={`/courses/${course.id}`}
          className={`inline-flex items-center justify-center px-5 py-2.5 rounded-lg text-sm font-semibold text-white ${styles.button} transition-colors text-center`}
        >
          {enrolled ? "Continue" : "Enroll"}
          <svg
            className="w-4 h-4 ml-1.5"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
            />
          </svg>
        </Link>
      </div>
    </div>
  );
}
