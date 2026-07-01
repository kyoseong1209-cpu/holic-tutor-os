import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ArrowLeft,
  BookOpenCheck,
  ClipboardList,
  MessageSquareText,
  NotebookTabs,
  Plus,
  Save,
  Target,
  Trash2,
  TrendingUp,
  UserRound,
} from "lucide-react";

import {
  createLessonRecord,
  deleteStudent,
  updateStudent,
} from "@/app/protected/actions";
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

function todayInSeoul() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

function weaknessSummary(lessons: LessonRecord[]): WeaknessCount[] {
  const counts = new Map<string, number>();

  lessons.forEach((lesson) => {
    lesson.weakness_tags.forEach((tag) => {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    });
  });

  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
}

function statusLabel(status: Student["status"]) {
  if (status === "paused") return "보류";
  if (status === "archived") return "종료";
  return "수업 중";
}

function optionalText(value: string | null | undefined, fallback = "미입력") {
  return value && value.trim().length > 0 ? value : fallback;
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
  const topWeaknesses = weaknessSummary(lessons).slice(0, 5);
  const homeworkLessons = lessons.filter((lesson) => lesson.homework).slice(0, 3);
  const latestNextPlan = lessons.find((lesson) => lesson.next_plan);
  const latestFeedback = lessons.find((lesson) => lesson.parent_feedback_draft);

  return (
    <div className="flex w-full flex-col gap-6">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Button asChild size="sm" variant="ghost" className="-ml-3 mb-2">
            <Link href="/protected/students">
              <ArrowLeft />
              학생 목록
            </Link>
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
              학생 상세
            </p>
            <span className="rounded-md border px-2 py-0.5 text-xs text-muted-foreground">
              {statusLabel(student.status)}
            </span>
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-normal">
            {student.name}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href="#new-lesson">
              <Plus />
              새 수업 기록
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="#edit-student">
              <Save />
              정보 수정
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
              {recentLessons[0]?.lesson_date ?? "기록 없음"}
            </CardTitle>
          </CardHeader>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-1">
          <Card className="rounded-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <UserRound className="size-5 text-emerald-700 dark:text-emerald-300" />
                학생 기본 정보
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="divide-y">
                {infoRow("학교", student.school)}
                {infoRow("학년/과정", student.grade)}
                {infoRow("학생 연락처", student.student_phone)}
                {infoRow("학부모 연락처", student.parent_phone)}
              </div>
              {student.memo ? (
                <div className="mt-4 rounded-md bg-muted p-3">
                  <p className="text-xs font-medium text-muted-foreground">
                    메모
                  </p>
                  <p className="mt-2 whitespace-pre-line text-sm">
                    {student.memo}
                  </p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="rounded-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <TrendingUp className="size-5 text-sky-700 dark:text-sky-300" />
                반복 약점 TOP 5
              </CardTitle>
            </CardHeader>
            <CardContent>
              {topWeaknesses.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  수업 기록에 약점 태그를 남기면 이곳에 쌓입니다.
                </p>
              ) : (
                <div className="space-y-3">
                  {topWeaknesses.map((weakness, index) => (
                    <div
                      className="flex items-center justify-between rounded-md border px-3 py-2"
                      key={weakness.tag}
                    >
                      <span className="text-sm font-medium">
                        {index + 1}. {weakness.tag}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {weakness.count}회
                      </span>
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
                    <div className="py-4 first:pt-0 last:pb-0" key={lesson.id}>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="font-medium">{lesson.topic}</p>
                          <p className="mt-1 text-sm text-muted-foreground">
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
                      {lesson.performance ? (
                        <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">
                          {lesson.performance}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="rounded-lg">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-xl">
                  <ClipboardList className="size-5 text-amber-700 dark:text-amber-300" />
                  최근 숙제
                </CardTitle>
              </CardHeader>
              <CardContent>
                {homeworkLessons.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    최근 숙제 기록이 없습니다.
                  </p>
                ) : (
                  <div className="space-y-4">
                    {homeworkLessons.map((lesson) => (
                      <div className="rounded-md border p-3" key={lesson.id}>
                        <p className="text-xs text-muted-foreground">
                          {lesson.lesson_date} · {lesson.topic}
                        </p>
                        <p className="mt-2 whitespace-pre-line text-sm">
                          {lesson.homework}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="rounded-lg">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-xl">
                  <Target className="size-5 text-rose-700 dark:text-rose-300" />
                  다음 수업 우선순위
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {latestNextPlan?.next_plan ? (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">
                      최근 계획
                    </p>
                    <p className="mt-2 whitespace-pre-line text-sm">
                      {latestNextPlan.next_plan}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    다음 계획이 아직 기록되지 않았습니다.
                  </p>
                )}
                {topWeaknesses.length > 0 ? (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">
                      함께 점검할 약점
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {topWeaknesses.slice(0, 3).map((weakness) => (
                        <span
                          className="rounded-md bg-muted px-2 py-1 text-xs"
                          key={weakness.tag}
                        >
                          {weakness.tag}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </div>

          <Card className="rounded-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <MessageSquareText className="size-5 text-violet-700 dark:text-violet-300" />
                학부모에게 보낼 피드백 초안
              </CardTitle>
              <CardDescription>
                가장 최근에 생성된 피드백 초안을 확인합니다.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {latestFeedback?.parent_feedback_draft ? (
                <div className="rounded-md bg-muted p-4">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">
                    {latestFeedback.lesson_date} · {latestFeedback.topic}
                  </p>
                  <p className="whitespace-pre-line text-sm">
                    {latestFeedback.parent_feedback_draft}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  수업 기록을 저장하면 피드백 초안이 자동 생성됩니다.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      <Card className="rounded-lg" id="new-lesson">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <BookOpenCheck className="size-5 text-emerald-700 dark:text-emerald-300" />
            새 수업 기록 추가
          </CardTitle>
          <CardDescription>
            약점 태그는 쉼표로 구분합니다. 예: 인수분해, 계산 실수
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            action={createLessonRecord.bind(null, student.id)}
            className="grid gap-5"
          >
            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="lesson_date">수업일</Label>
                <Input
                  id="lesson_date"
                  name="lesson_date"
                  type="date"
                  defaultValue={todayInSeoul()}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="duration_minutes">수업 시간</Label>
                <Input
                  id="duration_minutes"
                  name="duration_minutes"
                  min="1"
                  placeholder="분 단위"
                  type="number"
                />
              </div>
              <div className="grid gap-2 md:col-span-2">
                <Label htmlFor="topic">수업 주제</Label>
                <Input
                  id="topic"
                  name="topic"
                  required
                  placeholder="예: 이차방정식 활용"
                />
              </div>
              <div className="grid gap-2 md:col-span-2">
                <Label htmlFor="content">수업 내용</Label>
                <Textarea id="content" name="content" />
              </div>
              <div className="grid gap-2 md:col-span-2">
                <Label htmlFor="performance">오늘 관찰</Label>
                <Textarea
                  id="performance"
                  name="performance"
                  placeholder="예: 식 세우기는 좋아졌지만 부호 실수가 반복됨"
                />
              </div>
              <div className="grid gap-2 md:col-span-2">
                <Label htmlFor="weakness_tags">약점 태그</Label>
                <Input
                  id="weakness_tags"
                  name="weakness_tags"
                  placeholder="예: 부호 실수, 함수 그래프, 문제 해석"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="homework">과제</Label>
                <Textarea id="homework" name="homework" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="next_plan">다음 계획</Label>
                <Textarea id="next_plan" name="next_plan" />
              </div>
            </div>
            <div>
              <Button type="submit">
                <BookOpenCheck />
                기록 저장
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

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
