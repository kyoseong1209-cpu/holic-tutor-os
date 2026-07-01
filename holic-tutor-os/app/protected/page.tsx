import Link from "next/link";
import { redirect } from "next/navigation";
import { BarChart3, BookOpenCheck, Plus, UsersRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

type RecentLesson = {
  id: string;
  lesson_date: string;
  topic: string;
  student_id: string;
  parent_feedback_draft: string | null;
  students: { name: string } | null;
};

type WeaknessRow = {
  weakness_tags: string[] | null;
};

function weaknessSummary(rows: WeaknessRow[]) {
  const counts = new Map<string, number>();

  rows.forEach((row) => {
    row.weakness_tags?.forEach((tag) => {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    });
  });

  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect("/auth/login");
  }

  const [{ count: studentCount }, { count: lessonCount }, lessonsResult, tagsResult] =
    await Promise.all([
      supabase
        .from("students")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id),
      supabase
        .from("lesson_records")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id),
      supabase
        .from("lesson_records")
        .select("id, lesson_date, topic, student_id, parent_feedback_draft, students(name)")
        .eq("user_id", user.id)
        .order("lesson_date", { ascending: false })
        .limit(5),
      supabase
        .from("lesson_records")
        .select("weakness_tags")
        .eq("user_id", user.id)
        .limit(100),
    ]);

  const recentLessons = (lessonsResult.data ?? []) as unknown as RecentLesson[];
  const weaknesses = weaknessSummary(
    (tagsResult.data ?? []) as unknown as WeaknessRow[],
  );

  return (
    <div className="flex w-full flex-col gap-8">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
            Holic Tutor OS
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-normal">
            오늘의 튜터 운영
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href="/protected/students">
              <UsersRound />
              학생 목록
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/protected/students#new-student">
              <Plus />
              학생 등록
            </Link>
          </Button>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <Card className="rounded-lg">
          <CardHeader>
            <CardDescription>관리 중 학생</CardDescription>
            <CardTitle className="text-3xl">{studentCount ?? 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="rounded-lg">
          <CardHeader>
            <CardDescription>누적 수업 기록</CardDescription>
            <CardTitle className="text-3xl">{lessonCount ?? 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="rounded-lg">
          <CardHeader>
            <CardDescription>반복 약점 항목</CardDescription>
            <CardTitle className="text-3xl">{weaknesses.length}</CardTitle>
          </CardHeader>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <BookOpenCheck className="size-5 text-emerald-700 dark:text-emerald-300" />
              최근 수업 기록
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentLessons.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                아직 등록된 수업 기록이 없습니다.
              </p>
            ) : (
              <div className="divide-y">
                {recentLessons.map((lesson) => (
                  <Link
                    className="block py-4 hover:bg-muted/50"
                    href={`/protected/students/${lesson.student_id}`}
                    key={lesson.id}
                  >
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <p className="font-medium">
                        {lesson.students?.name ?? "학생"} · {lesson.topic}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {lesson.lesson_date}
                      </p>
                    </div>
                    {lesson.parent_feedback_draft ? (
                      <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                        {lesson.parent_feedback_draft}
                      </p>
                    ) : null}
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <BarChart3 className="size-5 text-sky-700 dark:text-sky-300" />
              반복 약점
            </CardTitle>
          </CardHeader>
          <CardContent>
            {weaknesses.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                수업 기록에 약점 태그를 남기면 이곳에 쌓입니다.
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
      </section>
    </div>
  );
}
