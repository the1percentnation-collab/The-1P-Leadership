"use client";

import Link from "next/link";
import type { Module } from "@/types";

interface ModuleCardProps {
  module: Module;
  courseId: string;
  moduleIndex: number;
  isCompleted: boolean;
  isLocked: boolean;
  completedLessons: number;
  totalLessons: number;
}

export default function ModuleCard({
  module,
  courseId,
  moduleIndex,
  isCompleted,
  isLocked,
  completedLessons,
  totalLessons,
}: ModuleCardProps) {
  const progressPercent =
    totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0;

  const firstLessonId = module.lessons[0]?.id;

  const content = (
    <div
      className={`relative rounded-xl border p-5 transition-all ${
        isLocked
          ? "bg-slate-50 border-slate-200 opacity-70 cursor-not-allowed"
          : isCompleted
          ? "bg-emerald-50 border-emerald-200 hover:shadow-md cursor-pointer"
          : "bg-white border-slate-200 hover:shadow-md hover:border-slate-300 cursor-pointer"
      }`}
    >
      {/* Module Number Badge */}
      <div className="flex items-start gap-4">
        {/* Icon */}
        <div
          className={`flex items-center justify-center w-12 h-12 rounded-lg text-xl shrink-0 ${
            isCompleted
              ? "bg-emerald-100"
              : isLocked
              ? "bg-slate-100"
              : "bg-amber-50"
          }`}
        >
          {isLocked ? (
            <svg
              className="w-6 h-6 text-slate-400"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
              />
            </svg>
          ) : isCompleted ? (
            <svg
              className="w-6 h-6 text-emerald-600"
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
          ) : (
            <span>{module.icon}</span>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Module {moduleIndex + 1}
            </span>
            {isCompleted && (
              <span className="text-xs font-medium text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-full">
                Completed
              </span>
            )}
            {isLocked && (
              <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                Locked
              </span>
            )}
          </div>
          <h3 className="text-base font-bold text-slate-900 mb-1 truncate">
            {module.title}
          </h3>
          <p className="text-sm text-slate-500 line-clamp-2 mb-3">
            {module.description}
          </p>

          {/* Lesson Count & Progress */}
          <div className="flex items-center gap-4">
            <span className="text-xs text-slate-500 flex items-center gap-1">
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
                  d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
                />
              </svg>
              {completedLessons}/{totalLessons} lessons
            </span>
            {!isLocked && totalLessons > 0 && (
              <div className="flex-1 max-w-[120px]">
                <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                  <div
                    className={`h-1.5 rounded-full transition-all duration-500 ${
                      isCompleted ? "bg-emerald-500" : "bg-amber-500"
                    }`}
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  if (isLocked || !firstLessonId) {
    return content;
  }

  return (
    <Link
      href={`/courses/${courseId}/lessons/${firstLessonId}`}
      className="block"
    >
      {content}
    </Link>
  );
}
