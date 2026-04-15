"use client";

import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import type { UserProgress, Certificate } from "@/types";
import {
  getProgress,
  saveProgress,
  completeLesson as completeLessonLib,
  saveQuizScore as saveQuizScoreLib,
  completeModule as completeModuleLib,
  completeCourse as completeCourseLib,
  enrollInCourse as enrollInCourseLib,
  isLessonCompleted as isLessonCompletedLib,
  getQuizScore as getQuizScoreLib,
  isModuleCompleted as isModuleCompletedLib,
  isCourseCompleted as isCourseCompletedLib,
  isEnrolled as isEnrolledLib,
  getCourseProgress as getCourseProgressLib,
  resetProgress as resetProgressLib,
} from "@/lib/progress";

interface ProgressContextType {
  progress: UserProgress;
  completeLesson: (lessonId: string) => void;
  saveQuizScore: (quizId: string, score: number) => void;
  completeModule: (moduleId: string) => void;
  completeCourse: (courseId: string, courseName: string, level: number, holderName: string) => void;
  enrollInCourse: (courseId: string) => void;
  isLessonCompleted: (lessonId: string) => boolean;
  getQuizScore: (quizId: string) => number | null;
  isModuleCompleted: (moduleId: string) => boolean;
  isCourseCompleted: (courseId: string) => boolean;
  isEnrolled: (courseId: string) => boolean;
  getCourseProgress: (courseId: string, totalLessons: string[]) => number;
  resetProgress: () => void;
}

const ProgressContext = createContext<ProgressContextType | null>(null);

export function ProgressProvider({ children }: { children: ReactNode }) {
  const [progress, setProgress] = useState<UserProgress>(getProgress);

  useEffect(() => {
    setProgress(getProgress());
  }, []);

  function completeLesson(lessonId: string) {
    const updated = completeLessonLib(lessonId);
    setProgress(updated);
  }

  function saveQuizScore(quizId: string, score: number) {
    const updated = saveQuizScoreLib(quizId, score);
    setProgress(updated);
  }

  function completeModule(moduleId: string) {
    const updated = completeModuleLib(moduleId);
    setProgress(updated);
  }

  function completeCourse(courseId: string, courseName: string, level: number, holderName: string) {
    const updated = completeCourseLib(courseId, courseName, level, holderName);
    setProgress(updated);
  }

  function enrollInCourse(courseId: string) {
    const updated = enrollInCourseLib(courseId);
    setProgress(updated);
  }

  function isLessonCompleted(lessonId: string): boolean {
    return progress.completedLessons.includes(lessonId);
  }

  function getQuizScore(quizId: string): number | null {
    const score = progress.quizScores[quizId];
    return score !== undefined ? score : null;
  }

  function isModuleCompleted(moduleId: string): boolean {
    return progress.completedModules.includes(moduleId);
  }

  function isCourseCompleted(courseId: string): boolean {
    return progress.completedCourses.includes(courseId);
  }

  function isEnrolled(courseId: string): boolean {
    return courseId in progress.enrolledAt;
  }

  function getCourseProgress(courseId: string, totalLessons: string[]): number {
    if (totalLessons.length === 0) {
      return 0;
    }
    const completedCount = totalLessons.filter((lessonId) =>
      progress.completedLessons.includes(lessonId)
    ).length;
    return Math.round((completedCount / totalLessons.length) * 100);
  }

  function resetProgress() {
    resetProgressLib();
    setProgress(getProgress());
  }

  return (
    <ProgressContext.Provider
      value={{
        progress,
        completeLesson,
        saveQuizScore,
        completeModule,
        completeCourse,
        enrollInCourse,
        isLessonCompleted,
        getQuizScore,
        isModuleCompleted,
        isCourseCompleted,
        isEnrolled,
        getCourseProgress,
        resetProgress,
      }}
    >
      {children}
    </ProgressContext.Provider>
  );
}

export function useProgress(): ProgressContextType {
  const context = useContext(ProgressContext);
  if (!context) {
    throw new Error("useProgress must be used within a ProgressProvider");
  }
  return context;
}
