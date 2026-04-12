import type { UserProgress, Certificate } from '@/types';

const STORAGE_KEY = '1p-leadership-progress';

function isClient(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function defaultProgress(): UserProgress {
  return {
    completedLessons: [],
    quizScores: {},
    completedModules: [],
    completedCourses: [],
    certificates: [],
    enrolledAt: {},
    lastActivity: new Date().toISOString(),
  };
}

export function getProgress(): UserProgress {
  if (!isClient()) {
    return defaultProgress();
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return defaultProgress();
    }
    const parsed = JSON.parse(raw) as Partial<UserProgress>;
    // Merge with defaults so any missing fields are filled in safely
    return {
      ...defaultProgress(),
      ...parsed,
    };
  } catch {
    return defaultProgress();
  }
}

export function saveProgress(progress: UserProgress): void {
  if (!isClient()) {
    return;
  }

  try {
    progress.lastActivity = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // localStorage may be full or unavailable — silently fail
  }
}

export function completeLesson(lessonId: string): UserProgress {
  const progress = getProgress();
  if (!progress.completedLessons.includes(lessonId)) {
    progress.completedLessons.push(lessonId);
  }
  saveProgress(progress);
  return progress;
}

export function saveQuizScore(quizId: string, score: number): UserProgress {
  const progress = getProgress();
  progress.quizScores[quizId] = score;
  saveProgress(progress);
  return progress;
}

export function completeModule(moduleId: string): UserProgress {
  const progress = getProgress();
  if (!progress.completedModules.includes(moduleId)) {
    progress.completedModules.push(moduleId);
  }
  saveProgress(progress);
  return progress;
}

export function completeCourse(
  courseId: string,
  courseName: string,
  level: number,
  holderName: string
): UserProgress {
  const progress = getProgress();

  if (!progress.completedCourses.includes(courseId)) {
    progress.completedCourses.push(courseId);
  }

  // Only issue a certificate if one doesn't already exist for this course
  const existingCert = progress.certificates.find((c) => c.courseId === courseId);
  if (!existingCert) {
    const certificate: Certificate = {
      id: crypto.randomUUID(),
      courseId,
      courseName,
      level,
      issuedAt: new Date().toISOString(),
      holderName,
      certificateNumber: generateCertificateNumber(),
    };
    progress.certificates.push(certificate);
  }

  saveProgress(progress);
  return progress;
}

export function isLessonCompleted(lessonId: string): boolean {
  const progress = getProgress();
  return progress.completedLessons.includes(lessonId);
}

export function getQuizScore(quizId: string): number | null {
  const progress = getProgress();
  const score = progress.quizScores[quizId];
  return score !== undefined ? score : null;
}

export function isModuleCompleted(moduleId: string): boolean {
  const progress = getProgress();
  return progress.completedModules.includes(moduleId);
}

export function isCourseCompleted(courseId: string): boolean {
  const progress = getProgress();
  return progress.completedCourses.includes(courseId);
}

export function enrollInCourse(courseId: string): UserProgress {
  const progress = getProgress();
  if (!progress.enrolledAt[courseId]) {
    progress.enrolledAt[courseId] = new Date().toISOString();
  }
  saveProgress(progress);
  return progress;
}

export function isEnrolled(courseId: string): boolean {
  const progress = getProgress();
  return courseId in progress.enrolledAt;
}

export function getCourseProgress(courseId: string, totalLessons: string[]): number {
  if (totalLessons.length === 0) {
    return 0;
  }

  const progress = getProgress();
  const completedCount = totalLessons.filter((lessonId) =>
    progress.completedLessons.includes(lessonId)
  ).length;

  return Math.round((completedCount / totalLessons.length) * 100);
}

export function generateCertificateNumber(): string {
  const now = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `1PCERT-${now}-${rand}`;
}

export function resetProgress(): void {
  if (!isClient()) {
    return;
  }

  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // silently fail
  }
}
