import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ArrowLeft,
  BookOpenCheck,
  Save,
  Trash2,
  TrendingUp,
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
  const weaknesses = weaknessSummary(lessons);

  return (
    <div className="flex w-full flex-col gap-8">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Button asChild size="sm" variant="ghost" className="-ml-3 mb-2">
            <Link href="/protected/students">
              <ArrowLeft />
              학생 목록
            </Link>
          </Button>
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
            학생 상세
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-normal">
            {student.name}
          </h1>
        </div>
        <div className="rounded-lg border px-4 py-3 text-sm text-muted-foreground">
          수업 기록 {lessons.length}개
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle>학생 정보</CardTitle>
            <CardDescription>기본 정보와 관리 상태를 수정합니다.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              action={updateStudent.bind(null, student.id)}
              className="grid gap-5"
            >
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
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Button type="submit">
                  <Save />
                  저장
                </Button>
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                    삭제
                  </summary>
                  <form
                    action={deleteStudent.bind(null, student.id)}
                    className="mt-3"
                  >
                    <Button type="submit" variant="destructive">
                      <Trash2 />
                      학생 삭제
                    </Button>
                  </form>
                </details>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookOpenCheck className="size-5 text-emerald-700 dark:text-emerald-300" />
              수업 기록 추가
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
      </section>

      <section className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="size-5 text-sky-700 dark:text-sky-300" />
              반복 약점
            </CardTitle>
          </CardHeader>
          <CardContent>
            {weaknesses.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                등록된 약점 태그가 없습니다.
              </p>
            ) : (
              <div className="space-y-3">
                {weaknesses.map((weakness) => (
                  <div
                    className="flex items-center justify-between rounded-md border px-3 py-2"
                    key={weakness.tag}
                  >
                    <span className="text-sm font-medium">{weakness.tag}</span>
                    <span className="text-sm text-muted-foreground">
                      {weakness.count}회
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4">
          {lessons.length === 0 ? (
            <Card className="rounded-lg">
              <CardContent className="p-6 text-sm text-muted-foreground">
                아직 수업 기록이 없습니다.
              </CardContent>
            </Card>
          ) : (
            lessons.map((lesson) => (
              <Card className="rounded-lg" key={lesson.id}>
                <CardHeader>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <CardTitle className="text-lg">{lesson.topic}</CardTitle>
                      <CardDescription>
                        {lesson.lesson_date}
                        {lesson.duration_minutes
                          ? ` · ${lesson.duration_minutes}분`
                          : ""}
                      </CardDescription>
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
                </CardHeader>
                <CardContent className="grid gap-4">
                  {lesson.content ? (
                    <p className="whitespace-pre-line text-sm">
                      {lesson.content}
                    </p>
                  ) : null}
                  {lesson.performance ? (
                    <div className="rounded-md border p-3">
                      <p className="text-xs font-medium text-muted-foreground">
                        오늘 관찰
                      </p>
                      <p className="mt-1 whitespace-pre-line text-sm">
                        {lesson.performance}
                      </p>
                    </div>
                  ) : null}
                  {lesson.parent_feedback_draft ? (
                    <div className="rounded-md bg-muted p-3">
                      <p className="text-xs font-medium text-muted-foreground">
                        학부모 피드백 초안
                      </p>
                      <p className="mt-2 whitespace-pre-line text-sm">
                        {lesson.parent_feedback_draft}
                      </p>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
