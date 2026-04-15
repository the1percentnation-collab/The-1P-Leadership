export interface Lesson {
  id: string;
  title: string;
  description: string;
  content: string; // markdown content
  duration: string; // estimated time
  objectives: string[];
}

export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctAnswer: number;
  explanation: string;
}

export interface Quiz {
  id: string;
  title: string;
  description: string;
  passingScore: number; // percentage
  questions: QuizQuestion[];
}

export interface Module {
  id: string;
  title: string;
  description: string;
  icon: string;
  lessons: Lesson[];
  quiz: Quiz;
}

export interface Course {
  id: string;
  level: number;
  title: string;
  subtitle: string;
  description: string;
  badge: string;
  color: string;
  prerequisites: string[];
  outcomes: string[];
  modules: Module[];
}

export interface UserProgress {
  completedLessons: string[]; // lesson IDs
  quizScores: Record<string, number>; // quizId -> score percentage
  completedModules: string[]; // module IDs
  completedCourses: string[]; // course IDs
  certificates: Certificate[];
  enrolledAt: Record<string, string>; // courseId -> ISO date
  lastActivity: string; // ISO date
}

export interface Certificate {
  id: string;
  courseId: string;
  courseName: string;
  level: number;
  issuedAt: string; // ISO date
  holderName: string;
  certificateNumber: string;
}
