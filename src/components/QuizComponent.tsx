"use client";

import { useState } from "react";
import type { Quiz } from "@/types";

interface QuizComponentProps {
  quiz: Quiz;
  onComplete: (score: number) => void;
}

export default function QuizComponent({ quiz, onComplete }: QuizComponentProps) {
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [submitted, setSubmitted] = useState(false);

  const totalQuestions = quiz.questions.length;
  const question = quiz.questions[currentQuestion];
  const isLastQuestion = currentQuestion === totalQuestions - 1;

  function selectAnswer(optionIndex: number) {
    if (submitted) return;
    setAnswers((prev) => ({ ...prev, [currentQuestion]: optionIndex }));
  }

  function goToNext() {
    if (currentQuestion < totalQuestions - 1) {
      setCurrentQuestion((prev) => prev + 1);
    }
  }

  function goToPrevious() {
    if (currentQuestion > 0) {
      setCurrentQuestion((prev) => prev - 1);
    }
  }

  function handleSubmit() {
    setSubmitted(true);
    const correctCount = quiz.questions.reduce((count, q, index) => {
      return answers[index] === q.correctAnswer ? count + 1 : count;
    }, 0);
    const score = Math.round((correctCount / totalQuestions) * 100);
    onComplete(score);
  }

  const score = submitted
    ? Math.round(
        (quiz.questions.reduce((count, q, index) => {
          return answers[index] === q.correctAnswer ? count + 1 : count;
        }, 0) /
          totalQuestions) *
          100
      )
    : 0;

  const passed = score >= quiz.passingScore;

  // Results Screen
  if (submitted) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {/* Score Header */}
        <div
          className={`px-6 py-8 text-center ${
            passed
              ? "bg-gradient-to-br from-emerald-500 to-emerald-600"
              : "bg-gradient-to-br from-red-500 to-red-600"
          }`}
        >
          <div className="text-5xl font-bold text-white mb-2">{score}%</div>
          <div className="text-lg font-semibold text-white/90">
            {passed ? "Congratulations! You passed!" : "Not quite. Keep studying!"}
          </div>
          <div className="text-sm text-white/70 mt-1">
            Passing score: {quiz.passingScore}%
          </div>
        </div>

        {/* Question Review */}
        <div className="p-6 space-y-6">
          <h3 className="text-lg font-bold text-slate-900">Question Review</h3>
          {quiz.questions.map((q, qIndex) => {
            const userAnswer = answers[qIndex];
            const isCorrect = userAnswer === q.correctAnswer;

            return (
              <div
                key={q.id}
                className={`rounded-lg border p-4 ${
                  isCorrect
                    ? "border-emerald-200 bg-emerald-50"
                    : "border-red-200 bg-red-50"
                }`}
              >
                <div className="flex items-start gap-3 mb-3">
                  <span
                    className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold text-white shrink-0 ${
                      isCorrect ? "bg-emerald-500" : "bg-red-500"
                    }`}
                  >
                    {isCorrect ? "\u2713" : "\u2717"}
                  </span>
                  <p className="text-sm font-semibold text-slate-800">
                    {qIndex + 1}. {q.question}
                  </p>
                </div>

                <div className="ml-9 space-y-1.5 mb-3">
                  {q.options.map((option, oIndex) => {
                    const isUserChoice = userAnswer === oIndex;
                    const isCorrectChoice = q.correctAnswer === oIndex;

                    return (
                      <div
                        key={oIndex}
                        className={`text-sm px-3 py-1.5 rounded-md ${
                          isCorrectChoice
                            ? "bg-emerald-100 text-emerald-800 font-medium"
                            : isUserChoice
                            ? "bg-red-100 text-red-800"
                            : "text-slate-600"
                        }`}
                      >
                        {isCorrectChoice && (
                          <span className="font-bold mr-1">\u2713</span>
                        )}
                        {isUserChoice && !isCorrectChoice && (
                          <span className="font-bold mr-1">\u2717</span>
                        )}
                        {option}
                      </div>
                    );
                  })}
                </div>

                <div className="ml-9 text-sm text-slate-600 bg-white/60 rounded-md px-3 py-2">
                  <span className="font-semibold text-slate-700">Explanation: </span>
                  {q.explanation}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Quiz Question Screen
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      {/* Progress Bar */}
      <div className="bg-slate-50 px-6 py-3 border-b border-slate-200">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold text-slate-700">
            {quiz.title}
          </span>
          <span className="text-sm text-slate-500">
            Question {currentQuestion + 1} of {totalQuestions}
          </span>
        </div>
        <div className="w-full bg-slate-200 rounded-full h-1.5">
          <div
            className="bg-amber-500 h-1.5 rounded-full transition-all duration-300"
            style={{
              width: `${((currentQuestion + 1) / totalQuestions) * 100}%`,
            }}
          />
        </div>
      </div>

      {/* Question */}
      <div className="p-6">
        <h3 className="text-lg font-bold text-slate-900 mb-6">
          {question.question}
        </h3>

        {/* Options */}
        <div className="space-y-3 mb-8">
          {question.options.map((option, index) => {
            const isSelected = answers[currentQuestion] === index;

            return (
              <button
                key={index}
                type="button"
                onClick={() => selectAnswer(index)}
                className={`w-full text-left px-4 py-3 rounded-lg border-2 text-sm transition-all ${
                  isSelected
                    ? "border-amber-400 bg-amber-50 text-slate-900 font-medium"
                    : "border-slate-200 hover:border-slate-300 text-slate-700 hover:bg-slate-50"
                }`}
              >
                <span
                  className={`inline-flex items-center justify-center w-6 h-6 rounded-full border-2 mr-3 text-xs font-bold ${
                    isSelected
                      ? "border-amber-500 bg-amber-500 text-white"
                      : "border-slate-300 text-slate-400"
                  }`}
                >
                  {String.fromCharCode(65 + index)}
                </span>
                {option}
              </button>
            );
          })}
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={goToPrevious}
            disabled={currentQuestion === 0}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            &larr; Previous
          </button>

          {isLastQuestion ? (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={Object.keys(answers).length !== totalQuestions}
              className="px-6 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors"
            >
              Submit Quiz
            </button>
          ) : (
            <button
              type="button"
              onClick={goToNext}
              disabled={answers[currentQuestion] === undefined}
              className="px-4 py-2 text-sm font-medium text-amber-600 hover:text-amber-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next &rarr;
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
