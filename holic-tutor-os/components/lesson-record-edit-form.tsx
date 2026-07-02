"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, X } from "lucide-react";

import {
  updateLessonRecord,
  type LessonRecordMutationState,
} from "@/app/protected/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { LessonRecord } from "@/lib/tutor-os/types";

const ERROR_TAGS = [
  "조건 해석",
  "경우 누락",
  "계산 실수",
  "부등호 방향",
  "정수조건",
  "그래프 해석",
  "식 변형 목적 부족",
  "문제 독해 오류",
  "개념 기억 부족",
  "풀이 전략 부재",
  "검산 부족",
  "시간 관리 실패",
];

const INTERNAL_MEMO_MARKER = "[선생님 내부 메모]";
const INITIAL_ACTION_STATE: LessonRecordMutationState = {
  status: "idle",
  message: "",
};

function splitTags(value: string) {
  return value
    .split(/[,\n]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function uniqueTags(tags: string[]) {
  return Array.from(new Set(tags));
}

function parseLessonContent(value: string | null) {
  if (!value) {
    return { content: "", internalMemo: "" };
  }

  const normalized = value.replace(/\r\n/g, "\n");
  const markerIndex = normalized.indexOf(INTERNAL_MEMO_MARKER);
  const publicPart = markerIndex >= 0 ? normalized.slice(0, markerIndex) : normalized;
  const internalPart = markerIndex >= 0 ? normalized.slice(markerIndex + INTERNAL_MEMO_MARKER.length) : "";

  return {
    content: publicPart.replace(/^오늘 다룬 내용\s*\n/, "").trim(),
    internalMemo: internalPart.trim(),
  };
}

function initialTagState(tags: string[]) {
  return {
    weaknessText: tags.filter((tag) => !ERROR_TAGS.includes(tag)).join("\n"),
    selectedTags: tags.filter((tag) => ERROR_TAGS.includes(tag)),
  };
}

export function LessonRecordEditForm({
  lesson,
  onCancel,
  onError,
  onSaved,
  studentId,
}: {
  lesson: LessonRecord;
  onCancel: () => void;
  onError: (message: string) => void;
  onSaved: (lesson: LessonRecord, message: string) => void;
  studentId: string;
}) {
  const parsedContent = useMemo(() => parseLessonContent(lesson.content), [lesson.content]);
  const parsedTags = useMemo(() => initialTagState(lesson.weakness_tags), [lesson.weakness_tags]);
  const [actionState, formAction, isPending] = useActionState(
    updateLessonRecord.bind(null, studentId, lesson.id),
    INITIAL_ACTION_STATE,
  );
  const handledMutationIdRef = useRef<number | null>(null);
  const [lessonDate, setLessonDate] = useState(lesson.lesson_date);
  const [topic, setTopic] = useState(lesson.topic);
  const [content, setContent] = useState(parsedContent.content);
  const [strengths, setStrengths] = useState(lesson.performance ?? "");
  const [weaknessText, setWeaknessText] = useState(parsedTags.weaknessText);
  const [selectedTags, setSelectedTags] = useState<string[]>(parsedTags.selectedTags);
  const [homework, setHomework] = useState(lesson.homework ?? "");
  const [nextPlan, setNextPlan] = useState(lesson.next_plan ?? "");
  const [parentNote, setParentNote] = useState(lesson.parent_feedback_draft ?? "");
  const [internalMemo, setInternalMemo] = useState(parsedContent.internalMemo);
  const [submitLocked, setSubmitLocked] = useState(false);

  const combinedTags = useMemo(
    () => uniqueTags([...splitTags(weaknessText), ...selectedTags]),
    [selectedTags, weaknessText],
  );

  const isSubmitDisabled = isPending || submitLocked;
  const formId = `lesson-edit-${lesson.id}`;

  useEffect(() => {
    if (!actionState.mutationId) return;
    if (handledMutationIdRef.current === actionState.mutationId) return;

    handledMutationIdRef.current = actionState.mutationId;
    setSubmitLocked(false);

    if (actionState.status === "success" && actionState.updatedLesson) {
      onSaved(actionState.updatedLesson, actionState.message);
      return;
    }

    if (actionState.status === "error") {
      onError(actionState.message);
    }
  }, [actionState, onError, onSaved]);

  function toggleTag(tag: string) {
    if (isPending) return;

    setSelectedTags((current) =>
      current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag],
    );
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (isSubmitDisabled) {
      event.preventDefault();
      return;
    }

    setSubmitLocked(true);
  }

  return (
    <form action={formAction} className="grid gap-5 rounded-lg border bg-background p-4" onSubmit={handleSubmit}>
      <input name="weakness_tags" type="hidden" value={combinedTags.join(", ")} />

      {actionState.status === "error" ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
          {actionState.message}
        </div>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-medium">수업 기록 수정</p>
          <p className="text-sm text-muted-foreground">필요한 항목만 고친 뒤 저장하세요.</p>
        </div>
        <Button disabled={isPending} onClick={onCancel} type="button" variant="ghost">
          <X />
          취소
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-[180px_1fr]">
        <div className="space-y-2">
          <Label htmlFor={`${formId}-lesson-date`}>수업 날짜</Label>
          <Input disabled={isPending} id={`${formId}-lesson-date`} name="lesson_date" onChange={(event) => setLessonDate(event.target.value)} required type="date" value={lessonDate} />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${formId}-topic`}>수업 단원</Label>
          <Input disabled={isPending} id={`${formId}-topic`} name="topic" onChange={(event) => setTopic(event.target.value)} required value={topic} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${formId}-content`}>오늘 다룬 내용</Label>
          <Textarea className="min-h-28" disabled={isPending} id={`${formId}-content`} name="content" onChange={(event) => setContent(event.target.value)} value={content} />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${formId}-strengths`}>학생이 잘한 점</Label>
          <Textarea className="min-h-28" disabled={isPending} id={`${formId}-strengths`} name="strengths" onChange={(event) => setStrengths(event.target.value)} value={strengths} />
        </div>
      </div>

      <div className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor={`${formId}-weakness-text`}>반복 약점</Label>
          <Textarea className="min-h-24" disabled={isPending} id={`${formId}-weakness-text`} onChange={(event) => setWeaknessText(event.target.value)} placeholder="쉼표 또는 줄바꿈으로 여러 개 입력할 수 있습니다." value={weaknessText} />
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">오답 유형 태그</p>
          <div className="flex flex-wrap gap-2">
            {ERROR_TAGS.map((tag) => {
              const selected = selectedTags.includes(tag);
              return (
                <button
                  aria-pressed={selected}
                  className={cn(
                    "min-h-9 rounded-md border px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60",
                    selected
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-background text-foreground hover:bg-muted",
                  )}
                  disabled={isPending}
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  type="button"
                >
                  {tag}
                </button>
              );
            })}
          </div>
        </div>
        {combinedTags.length > 0 ? (
          <p className="text-sm text-muted-foreground">저장될 약점: {combinedTags.join(", ")}</p>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${formId}-homework`}>숙제</Label>
          <Textarea className="min-h-24" disabled={isPending} id={`${formId}-homework`} name="homework" onChange={(event) => setHomework(event.target.value)} value={homework} />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${formId}-next-plan`}>다음 수업 우선순위</Label>
          <Textarea className="min-h-24" disabled={isPending} id={`${formId}-next-plan`} name="next_plan" onChange={(event) => setNextPlan(event.target.value)} value={nextPlan} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${formId}-parent-note`}>학부모 전달 메모</Label>
          <Textarea className="min-h-28" disabled={isPending} id={`${formId}-parent-note`} name="parent_note" onChange={(event) => setParentNote(event.target.value)} value={parentNote} />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${formId}-internal-memo`}>선생님 내부 메모</Label>
          <Textarea className="min-h-28" disabled={isPending} id={`${formId}-internal-memo`} name="internal_memo" onChange={(event) => setInternalMemo(event.target.value)} value={internalMemo} />
          {internalMemo.trim() ? (
            <p className="text-xs text-muted-foreground">이 내용은 학부모 피드백 초안에 들어가지 않습니다.</p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button disabled={isPending} onClick={onCancel} type="button" variant="outline">
          취소
        </Button>
        <Button disabled={isSubmitDisabled} type="submit">
          {isSubmitDisabled ? "수정 중..." : "수정 저장"}
          {!isSubmitDisabled ? <CheckCircle2 /> : null}
        </Button>
      </div>
    </form>
  );
}
