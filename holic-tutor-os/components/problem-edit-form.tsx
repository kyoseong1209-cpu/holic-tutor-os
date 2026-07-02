"use client";

import Link from "next/link";
import {
  useActionState,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";

import {
  updateProblem,
  type ProblemMutationState,
} from "@/app/protected/problems/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  PROBLEM_DIFFICULTIES,
  type Problem,
} from "@/lib/tutor-os/problems";
import { cn } from "@/lib/utils";

const INITIAL_STATE: ProblemMutationState = {
  status: "idle",
  message: "",
};

export function ProblemEditForm({ problem }: { problem: Problem }) {
  const router = useRouter();
  const [actionState, formAction, isPending] = useActionState(
    updateProblem.bind(null, problem.id),
    INITIAL_STATE,
  );
  const handledMutationIdRef = useRef<number | null>(null);
  const [submitLocked, setSubmitLocked] = useState(false);
  const isSubmitDisabled = isPending || submitLocked;

  useEffect(() => {
    if (!actionState.mutationId) return;
    if (handledMutationIdRef.current === actionState.mutationId) return;
    handledMutationIdRef.current = actionState.mutationId;

    if (actionState.status === "error") {
      setSubmitLocked(false);
      return;
    }

    if (actionState.status === "success") {
      router.refresh();
      const redirectTimer = window.setTimeout(() => {
        router.push(`/protected/problems/${problem.id}`);
      }, 800);

      return () => window.clearTimeout(redirectTimer);
    }
  }, [actionState.mutationId, actionState.status, problem.id, router]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (isSubmitDisabled) {
      event.preventDefault();
      return;
    }

    setSubmitLocked(true);
  }

  return (
    <form action={formAction} className="grid gap-5" onSubmit={handleSubmit}>
      {actionState.status !== "idle" ? (
        <div
          className={cn(
            "rounded-lg border px-4 py-3 text-sm",
            actionState.status === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
              : "border-destructive/30 bg-destructive/10 text-destructive",
          )}
          role={actionState.status === "success" ? "status" : "alert"}
        >
          {actionState.message}
        </div>
      ) : null}

      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle className="text-base">기본 정보</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-2 md:col-span-2">
            <Label htmlFor="title">제목</Label>
            <Input id="title" name="title" required defaultValue={problem.title} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="school">학교</Label>
            <Input id="school" name="school" defaultValue={problem.school ?? ""} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="grade">학년</Label>
            <Input id="grade" name="grade" defaultValue={problem.grade ?? ""} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="year">연도</Label>
            <Input
              id="year"
              name="year"
              inputMode="numeric"
              defaultValue={problem.year ?? ""}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="semester">학기</Label>
            <Input id="semester" name="semester" defaultValue={problem.semester ?? ""} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="exam_name">시험명</Label>
            <Input id="exam_name" name="exam_name" defaultValue={problem.exam_name ?? ""} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="subject">과목</Label>
            <Input id="subject" name="subject" defaultValue={problem.subject ?? ""} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="unit_scope">파일명 범위</Label>
            <Input id="unit_scope" name="unit_scope" defaultValue={problem.unit_scope ?? ""} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="exam_sections">문제 구성</Label>
            <Input
              id="exam_sections"
              name="exam_sections"
              defaultValue={problem.exam_sections?.join(", ") ?? ""}
              placeholder="예: 선택, 공통"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="file_kind">파일 종류</Label>
            <Input id="file_kind" name="file_kind" defaultValue={problem.file_kind ?? ""} />
          </div>
          <div className="grid gap-2 md:col-span-2">
            <Label htmlFor="source_note">출처 메모</Label>
            <Textarea
              id="source_note"
              name="source_note"
              defaultValue={problem.source_note ?? ""}
              placeholder="예: 파일명 자동 추출 후 확인 완료"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="unit">문항 단원</Label>
            <Input id="unit" name="unit" defaultValue={problem.unit ?? ""} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="problem_type">세부 유형</Label>
            <Input
              id="problem_type"
              name="problem_type"
              defaultValue={problem.problem_type ?? ""}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="difficulty">난이도</Label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              defaultValue={problem.difficulty ?? ""}
              id="difficulty"
              name="difficulty"
            >
              <option value="">선택 안 함</option>
              {PROBLEM_DIFFICULTIES.map((difficulty) => (
                <option key={difficulty} value={difficulty}>
                  {difficulty}
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle className="text-base">풀이와 메모</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="answer">정답</Label>
            <Textarea id="answer" name="answer" defaultValue={problem.answer ?? ""} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="core_idea">핵심 아이디어</Label>
            <Textarea
              id="core_idea"
              name="core_idea"
              defaultValue={problem.core_idea ?? ""}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="standard_solution">정석 풀이</Label>
            <Textarea
              className="min-h-32"
              id="standard_solution"
              name="standard_solution"
              defaultValue={problem.standard_solution ?? ""}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="elegant_solution">우아한 풀이</Label>
            <Textarea
              className="min-h-32"
              id="elegant_solution"
              name="elegant_solution"
              defaultValue={problem.elegant_solution ?? ""}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="mistake_points">오답 유발 포인트</Label>
            <Textarea
              className="min-h-28"
              id="mistake_points"
              name="mistake_points"
              defaultValue={problem.mistake_points.join("\n")}
              placeholder="한 줄에 하나씩 입력"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="teacher_note">선생님 메모</Label>
            <Textarea
              className="min-h-28"
              id="teacher_note"
              name="teacher_note"
              defaultValue={problem.teacher_note ?? ""}
            />
          </div>
        </CardContent>
      </Card>

      <div className="sticky bottom-0 -mx-1 flex flex-col gap-2 border-t bg-background/95 px-1 py-4 backdrop-blur sm:static sm:flex-row sm:border-t-0 sm:bg-transparent sm:p-0">
        <Button className="w-full sm:w-auto" disabled={isSubmitDisabled} type="submit">
          <Save />
          {isSubmitDisabled ? "저장 중..." : "저장"}
        </Button>
        <Button asChild className="w-full sm:w-auto" variant="outline">
          <Link href={`/protected/problems/${problem.id}`}>취소</Link>
        </Button>
      </div>
    </form>
  );
}
