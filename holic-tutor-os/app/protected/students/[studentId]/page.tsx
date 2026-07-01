import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ArrowLeft,
  MessageSquareText,
  NotebookTabs,
  Plus,
  Save,
  Target,
  Trash2,
  TrendingUp,
  UserRound,
} from "lucide-react";

import { deleteStudent, updateStudent } from "@/app/protected/actions";
import { LessonRecordForm } from "@/components/lesson-record-form";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/server";
import type { LessonRecord, Student, WeaknessCount } from "@/lib/tutor-os/types";

type WeaknessInsight = WeaknessCount & {
  lastSeen: string;
  comment: string;
};

function todayInSeoul() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

function lessonSummary(lesson: LessonRecord) {
  return optionalText(
    lesson.performance ?? lesson.content,
    "수업 요약이 아직 기록되지 않았습니다.",
  );
}

function statusLabel(status: Student["status"]) {
  if (status === "paused") return "보류";
  if (status === "archived") return "종료";
  return "수업 중";
}

function optionalText(value: string | null | undefined, fallback = "미입력") {
  return value && value.trim().length > 0 ? value : fallback;
}

function feeInfoFromMemo(memo: string | null) {
  if (!memo) return null;

  return (
    memo
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => /(수업료|시급|회당|월\s*\d|만원|원)/.test(line)) ?? null
  );
}

function buildWeaknessInsights(lessons: LessonRecord[]): WeaknessInsight[] {
  const insights = new Map<string, WeaknessInsight>();

  lessons.forEach((lesson) => {
    lesson.weakness_tags.forEach((tag) => {
      const existing = insights.get(tag);
      if (existing) {
        insights.set(tag, { ...existing, count: existing.count + 1 });
        return;
      }

      insights.set(tag, {
        tag,
        count: 1,
        lastSeen: lesson.lesson_date,
        comment:
          lesson.performance ??
          lesson.content ??
          `${tag} 유형은 다음 수업에서 다시 확인하면 좋습니다.`,
      });
    });
  });

  return Array.from(insights.values()).sort((a, b) => b.count - a.count);
}

function infoRow(label: string, value: string | null | undefined) {
  return (
    <div className="flex items-start justify-between gap-4 border-b py-3 last:border-b-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="max-w-[65%] text-right text-sm font-medium">
        {optionalText(value)}
      </span>
    </div>
  );
}

function buildFeedbackDraft(
  student: Student,
  recentLesson: LessonRecord | undefined,
  weaknesses: WeaknessInsight[],
) {
  if (!recentLesson) {
    return `${student.name} 학생의 수업 기록을 추가하면 학부모 피드백 초안이 자동으로 정리됩니다.`;
  }

  const lines = [
    `안녕하세요. ${student.name} 학생은 최근 ${recentLesson.topic} 수업을 진행했습니다.`,
    lessonSummary(recentLesson),
  ];

  if (weaknesses.length > 0) {
    lines.push(
      `반복해서 점검할 부분은 ${weaknesses
        .slice(0, 3)
        .map((weakness) => weakness.tag)
        .join(", ")}입니다.`,
    );
  }

  if (recentLesson.homework) {
    lines.push(`과제는 ${recentLesson.homework}입니다.`);
  }

  if (recentLesson.next_plan) {
    lines.push(`다음 수업에서는 ${recentLesson.next_plan}을 우선 확인하겠습니다.`);
  }

  return lines.join("\n");
}

export default async function StudentDetailPage({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  const { studentId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect("/auth/login");
  }

  const [studentResult, lessonsResult] = await Promise.all([
    supabase
      .from("students")
      .select("*")
      .eq("id", studentId)
      .eq("user_id", user.id)
      .single(),
    supabase
      .from("lesson_records")
      .select("*")
      .eq("student_id", studentId)
      .eq("user_id", user.id)
      .order("lesson_date", { ascending: false })
      .order("created_at", { ascending: false }),
  ]);

  if (!studentResult.data || studentResult.error) {
    notFound();
  }

  const student = studentResult.data as Student;
  const lessons = (lessonsResult.data ?? []) as LessonRecord[];
  const recentLessons = lessons.slice(0, 5);
  const topWeaknesses = buildWeaknessInsights(lessons).slice(0, 5);
  const latestLesson = recentLessons[0];
  const latestNextPlan = lessons.find((lesson) => lesson.next_plan);
  const feeInfo = feeInfoFromMemo(student.memo);
  const feedbackDraft = buildFeedbackDraft(student, latestLesson, topWeaknesses);
  const reviewConcepts =
    topWeaknesses.length > 0
      ? topWeaknesses
          .slice(0, 3)
          .map((weakness) => weakness.tag)
          .join(", ")
      : "최근 약점 태그를 기록하면 자동으로 정리됩니다.";

  return (
    <div className="flex w-full flex-col gap-6">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
            학생 관제판
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-normal">
            {student.name}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            다음 수업 준비와 수업 후 피드백을 한 화면에서 확인합니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/protected/students">
              <ArrowLeft />
              학생 목록
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="#edit-student">
              <Save />
              정보 수정
            </Link>
          </Button>
          <Button asChild>
            <Link href="#new-lesson">
              <Plus />
              새 수업 기록
            </Link>
          </Button>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <Card className="rounded-lg">
          <CardHeader>
            <CardDescription>누적 수업 기록</CardDescription>
            <CardTitle className="text-3xl">{lessons.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="rounded-lg">
          <CardHeader>
            <CardDescription>반복 약점 항목</CardDescription>
            <CardTitle className="text-3xl">{topWeaknesses.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="rounded-lg">
          <CardHeader>
            <CardDescription>최근 수업일</CardDescription>
            <CardTitle className="text-2xl">
              {latestLesson?.lesson_date ?? "기록 없음"}
            </CardTitle>
          </CardHeader>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="grid gap-4">
          <Card className="rounded-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <UserRound className="size-5 text-emerald-700 dark:text-emerald-300" />
                학생 기본 정보
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="divide-y">
                {infoRow("이름", student.name)}
                {infoRow("학교", student.school)}
                {infoRow("학년", student.grade)}
                {infoRow("상태", statusLabel(student.status))}
                {feeInfo ? infoRow("수업료/시급", feeInfo) : null}
                {infoRow("학생 연락처", student.student_phone)}
                {infoRow("학부모 연락처", student.parent_phone)}
              </div>
              <div className="mt-4 rounded-md bg-muted p-3">
                <p className="text-xs font-medium text-muted-foreground">메모</p>
                <p className="mt-2 whitespace-pre-line text-sm">
                  {optionalText(student.memo, "수업 전 확인할 메모가 없습니다.")}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <TrendingUp className="size-5 text-sky-700 dark:text-sky-300" />
                반복 약점 TOP 5
              </CardTitle>
              <CardDescription>
                약점 태그의 반복 횟수와 최근 발생일을 확인합니다.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {topWeaknesses.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  수업 기록에 약점 태그를 남기면 이곳에 쌓입니다.
                </p>
              ) : (
                <div className="space-y-3">
                  {topWeaknesses.map((weakness, index) => (
                    <div className="rounded-md border p-3" key={weakness.tag}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium">
                          {index + 1}. {weakness.tag}
                        </p>
                        <span className="text-sm text-muted-foreground">
                          {weakness.count}회 · 최근 {weakness.lastSeen}
                        </span>
                      </div>
                      <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                        {weakness.comment}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4">
          <Card className="rounded-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <Target className="size-5 text-rose-700 dark:text-rose-300" />
                다음 수업 준비 카드
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-3">
              <div className="rounded-md border p-3">
                <p className="text-xs font-medium text-muted-foreground">
                  다음 수업 우선순위
                </p>
                <p className="mt-2 whitespace-pre-line text-sm font-medium">
                  {latestNextPlan?.next_plan ??
                    topWeaknesses[0]?.tag ??
                    "다음 계획을 기록해 주세요."}
                </p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs font-medium text-muted-foreground">
                  다시 풀릴 문항/개념
                </p>
                <p className="mt-2 whitespace-pre-line text-sm font-medium">
                  {reviewConcepts}
                </p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs font-medium text-muted-foreground">
                  수업 전 확인 메모
                </p>
                <p className="mt-2 line-clamp-4 whitespace-pre-line text-sm font-medium">
                  {optionalText(student.memo, "특이사항 없음")}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <NotebookTabs className="size-5 text-emerald-700 dark:text-emerald-300" />
                최근 수업 기록 5개
              </CardTitle>
            </CardHeader>
            <CardContent>
              {recentLessons.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  아직 수업 기록이 없습니다.
                </p>
              ) : (
                <div className="divide-y">
                  {recentLessons.map((lesson) => (
                    <div className="grid gap-3 py-4 first:pt-0 last:pb-0" key={lesson.id}>
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="font-medium">{lesson.topic}</p>
                          <p className="text-sm text-muted-foreground">
                            {lesson.lesson_date}
                            {lesson.duration_minutes
                              ? ` · ${lesson.duration_minutes}분`
                              : ""}
                          </p>
                        </div>
                        {lesson.weakness_tags.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
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
                      </div>
                      <div className="grid gap-3 lg:grid-cols-3">
                        <div className="rounded-md bg-muted p-3">
                          <p className="text-xs font-medium text-muted-foreground">
                            수업 요약
                          </p>
                          <p className="mt-2 line-clamp-3 whitespace-pre-line text-sm">
                            {lessonSummary(lesson)}
                          </p>
                        </div>
                        <div className="rounded-md bg-muted p-3">
                          <p className="text-xs font-medium text-muted-foreground">
                            숙제
                          </p>
                          <p className="mt-2 line-clamp-3 whitespace-pre-line text-sm">
                            {optionalText(lesson.homework, "숙제 기록 없음")}
                          </p>
                        </div>
                        <div className="rounded-md bg-muted p-3">
                          <p className="text-xs font-medium text-muted-foreground">
                            다음 우선순위
                          </p>
                          <p className="mt-2 line-clamp-3 whitespace-pre-line text-sm">
                            {optionalText(lesson.next_plan, "다음 계획 기록 없음")}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <MessageSquareText className="size-5 text-violet-700 dark:text-violet-300" />
                학부모 피드백 초안
              </CardTitle>
              <CardDescription>
                최근 수업 기록과 반복 약점을 바탕으로 바로 복사해 보낼 수 있습니다.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea
                readOnly
                value={feedbackDraft}
                className="min-h-40 resize-none bg-muted"
              />
            </CardContent>
          </Card>
        </div>
      </section>

      <LessonRecordForm defaultDate={todayInSeoul()} studentId={student.id} />

      <Card className="rounded-lg" id="edit-student">
        <CardHeader>
          <CardTitle>학생 정보 수정</CardTitle>
          <CardDescription>기본 정보와 관리 상태를 수정합니다.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <form action={updateStudent.bind(null, student.id)} className="grid gap-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="name">학생 이름</Label>
                <Input
                  id="name"
                  name="name"
                  required
                  defaultValue={student.name}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="status">상태</Label>
                <select
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm"
                  defaultValue={student.status}
                  id="status"
                  name="status"
                >
                  <option value="active">수업 중</option>
                  <option value="paused">보류</option>
                  <option value="archived">종료</option>
                </select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="school">학교</Label>
                <Input
                  id="school"
                  name="school"
                  defaultValue={student.school ?? ""}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="grade">학년/과정</Label>
                <Input
                  id="grade"
                  name="grade"
                  defaultValue={student.grade ?? ""}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="student_phone">학생 연락처</Label>
                <Input
                  id="student_phone"
                  name="student_phone"
                  defaultValue={student.student_phone ?? ""}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="parent_phone">학부모 연락처</Label>
                <Input
                  id="parent_phone"
                  name="parent_phone"
                  defaultValue={student.parent_phone ?? ""}
                />
              </div>
              <div className="grid gap-2 md:col-span-2">
                <Label htmlFor="memo">메모</Label>
                <Textarea
                  id="memo"
                  name="memo"
                  defaultValue={student.memo ?? ""}
                />
              </div>
            </div>
            <div>
              <Button type="submit">
                <Save />
                저장
              </Button>
            </div>
          </form>
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
              학생 삭제
            </summary>
            <form action={deleteStudent.bind(null, student.id)} className="mt-3">
              <Button type="submit" variant="destructive">
                <Trash2 />
                학생 삭제
              </Button>
            </form>
          </details>
        </CardContent>
      </Card>
    </div>
  );
}
