"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { NotebookTabs, Pencil, Trash2 } from "lucide-react";

import {
  deleteLessonRecord,
  type LessonRecordMutationState,
} from "@/app/protected/actions";
import { LessonRecordEditForm } from "@/components/lesson-record-edit-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LessonRecord } from "@/lib/tutor-os/types";

const INITIAL_ACTION_STATE: LessonRecordMutationState = {
  status: "idle",
  message: "",
};

function optionalText(value: string | null | undefined, fallback = "미입력") {
  return value && value.trim().length > 0 ? value : fallback;
}

function lessonSummary(lesson: LessonRecord) {
  return optionalText(lesson.performance ?? lesson.content, "수업 요약이 아직 기록되지 않았습니다.");
}

function DeleteLessonRecordButton({
  lessonId,
  onDeleted,
  onError,
  studentId,
}: {
  lessonId: string;
  onDeleted: (lessonId: string, message: string) => void;
  onError: (message: string) => void;
  studentId: string;
}) {
  const [actionState, formAction, isPending] = useActionState(
    deleteLessonRecord.bind(null, studentId, lessonId),
    INITIAL_ACTION_STATE,
  );
  const handledMutationIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!actionState.mutationId) return;
    if (handledMutationIdRef.current === actionState.mutationId) return;

    handledMutationIdRef.current = actionState.mutationId;

    if (actionState.status === "success") {
      onDeleted(actionState.deletedLessonId ?? lessonId, actionState.message);
      return;
    }

    if (actionState.status === "error") {
      onError(actionState.message);
    }
  }, [actionState, lessonId, onDeleted, onError]);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (isPending) {
      event.preventDefault();
      return;
    }

    const confirmed = window.confirm("이 수업 기록을 삭제할까요? 삭제하면 되돌릴 수 없습니다.");
    if (!confirmed) {
      event.preventDefault();
    }
  }

  return (
    <form action={formAction} onSubmit={handleSubmit}>
      <Button
        className="text-muted-foreground hover:text-destructive"
        disabled={isPending}
        size="sm"
        title="수업 기록 삭제"
        type="submit"
        variant="ghost"
      >
        <Trash2 />
        {isPending ? "삭제 중..." : "삭제"}
      </Button>
    </form>
  );
}

export function LessonRecordsList({
  initialLessons,
  studentId,
}: {
  initialLessons: LessonRecord[];
  studentId: string;
}) {
  const router = useRouter();
  const [lessons, setLessons] = useState(initialLessons);
  const [editingLessonId, setEditingLessonId] = useState<string | null>(null);
  const [notice, setNotice] = useState<LessonRecordMutationState>(INITIAL_ACTION_STATE);

  useEffect(() => {
    setLessons(initialLessons);
  }, [initialLessons]);

  function handleDeleted(lessonId: string, message: string) {
    setLessons((current) => current.filter((lesson) => lesson.id !== lessonId));
    setEditingLessonId((current) => (current === lessonId ? null : current));
    setNotice({ status: "success", message, mutationId: Date.now() });
    router.refresh();
  }

  function handleSaved(updatedLesson: LessonRecord, message: string) {
    setLessons((current) =>
      current.map((lesson) => (lesson.id === updatedLesson.id ? updatedLesson : lesson)),
    );
    setEditingLessonId(null);
    setNotice({ status: "success", message, mutationId: Date.now() });
    router.refresh();
  }

  function handleError(message: string) {
    setNotice({ status: "error", message, mutationId: Date.now() });
  }

  return (
    <Card className="rounded-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <NotebookTabs className="size-5 text-emerald-700 dark:text-emerald-300" />
          최근 수업 기록 5개
        </CardTitle>
      </CardHeader>
      <CardContent>
        {notice.status !== "idle" ? (
          <div
            className={cn(
              "mb-4 rounded-md border px-4 py-3 text-sm",
              notice.status === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
                : "border-destructive/30 bg-destructive/10 text-destructive",
            )}
            role={notice.status === "error" ? "alert" : "status"}
          >
            {notice.message}
          </div>
        ) : null}

        {lessons.length === 0 ? (
          <p className="text-sm text-muted-foreground">아직 수업 기록이 없습니다.</p>
        ) : (
          <div className="divide-y">
            {lessons.map((lesson) => {
              const isEditing = editingLessonId === lesson.id;

              return (
                <div className="grid gap-3 py-4 first:pt-0 last:pb-0" key={lesson.id}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="font-medium">{lesson.topic}</p>
                      <p className="text-sm text-muted-foreground">
                        {lesson.lesson_date}
                        {lesson.duration_minutes ? ` · ${lesson.duration_minutes}분` : ""}
                      </p>
                    </div>
                    <div className="flex flex-col items-start gap-2 sm:items-end">
                      {lesson.weakness_tags.length > 0 ? (
                        <div className="flex flex-wrap gap-1 sm:justify-end">
                          {lesson.weakness_tags.map((tag) => (
                            <span
                              className="rounded-md bg-sky-100 px-2 py-1 text-xs text-sky-800 dark:bg-sky-950 dark:text-sky-200"
                              key={tag}
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      <div className="flex flex-wrap items-center gap-1">
                        <Button
                          aria-expanded={isEditing}
                          onClick={() => setEditingLessonId(isEditing ? null : lesson.id)}
                          size="sm"
                          type="button"
                          variant={isEditing ? "secondary" : "outline"}
                        >
                          <Pencil />
                          {isEditing ? "수정 닫기" : "수정"}
                        </Button>
                        <DeleteLessonRecordButton
                          lessonId={lesson.id}
                          onDeleted={handleDeleted}
                          onError={handleError}
                          studentId={studentId}
                        />
                      </div>
                    </div>
                  </div>

                  {isEditing ? (
                    <LessonRecordEditForm
                      lesson={lesson}
                      onCancel={() => setEditingLessonId(null)}
                      onError={handleError}
                      onSaved={handleSaved}
                      studentId={studentId}
                    />
                  ) : (
                    <div className="grid gap-3 lg:grid-cols-3">
                      <div className="rounded-md bg-muted p-3">
                        <p className="text-xs font-medium text-muted-foreground">수업 요약</p>
                        <p className="mt-2 line-clamp-3 whitespace-pre-line text-sm">
                          {lessonSummary(lesson)}
                        </p>
                      </div>
                      <div className="rounded-md bg-muted p-3">
                        <p className="text-xs font-medium text-muted-foreground">숙제</p>
                        <p className="mt-2 line-clamp-3 whitespace-pre-line text-sm">
                          {optionalText(lesson.homework, "숙제 기록 없음")}
                        </p>
                      </div>
                      <div className="rounded-md bg-muted p-3">
                        <p className="text-xs font-medium text-muted-foreground">다음 우선순위</p>
                        <p className="mt-2 line-clamp-3 whitespace-pre-line text-sm">
                          {optionalText(lesson.next_plan, "다음 계획 기록 없음")}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
