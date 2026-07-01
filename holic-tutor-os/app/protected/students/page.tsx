import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, UserRound } from "lucide-react";

import { createStudent } from "@/app/protected/actions";
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
import type { Student } from "@/lib/tutor-os/types";

type LessonCountRow = {
  student_id: string;
};

function countLessons(rows: LessonCountRow[]) {
  const counts = new Map<string, number>();
  rows.forEach((row) => {
    counts.set(row.student_id, (counts.get(row.student_id) ?? 0) + 1);
  });
  return counts;
}

export default async function StudentsPage() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect("/auth/login");
  }

  const [studentsResult, lessonRowsResult] = await Promise.all([
    supabase
      .from("students")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
    supabase.from("lesson_records").select("student_id").eq("user_id", user.id),
  ]);

  const students = (studentsResult.data ?? []) as Student[];
  const lessonCounts = countLessons(
    (lessonRowsResult.data ?? []) as LessonCountRow[],
  );

  return (
    <div className="flex w-full flex-col gap-8">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
            학생 관리
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-normal">
            등록 학생
          </h1>
        </div>
        <Button asChild variant="outline">
          <Link href="#new-student">
            <Plus />
            새 학생
          </Link>
        </Button>
      </section>

      <section className="grid gap-3">
        {students.length === 0 ? (
          <Card className="rounded-lg">
            <CardContent className="p-6 text-sm text-muted-foreground">
              아직 등록된 학생이 없습니다.
            </CardContent>
          </Card>
        ) : (
          students.map((student) => (
            <Link
              className="rounded-lg border bg-card p-4 shadow-sm transition hover:border-emerald-500/60 hover:bg-muted/40"
              href={`/protected/students/${student.id}`}
              key={student.id}
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="flex items-start gap-3">
                  <div className="rounded-md bg-emerald-100 p-2 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                    <UserRound className="size-5" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold">{student.name}</h2>
                      <span className="rounded-md border px-2 py-0.5 text-xs text-muted-foreground">
                        {student.status === "active"
                          ? "수업 중"
                          : student.status === "paused"
                            ? "보류"
                            : "종료"}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {[student.school, student.grade].filter(Boolean).join(" · ") ||
                        "학교/학년 미입력"}
                    </p>
                  </div>
                </div>
                <div className="text-sm text-muted-foreground">
                  수업 기록 {lessonCounts.get(student.id) ?? 0}개
                </div>
              </div>
            </Link>
          ))
        )}
      </section>

      <Card className="rounded-lg" id="new-student">
        <CardHeader>
          <CardTitle>새 학생 등록</CardTitle>
          <CardDescription>
            이름만 입력해도 등록할 수 있고, 나머지는 나중에 채워도 됩니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={createStudent} className="grid gap-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="name">학생 이름</Label>
                <Input id="name" name="name" required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="school">학교</Label>
                <Input id="school" name="school" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="grade">학년/과정</Label>
                <Input id="grade" name="grade" placeholder="예: 중3, 고2 문과" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="student_phone">학생 연락처</Label>
                <Input id="student_phone" name="student_phone" />
              </div>
              <div className="grid gap-2 md:col-span-2">
                <Label htmlFor="parent_phone">학부모 연락처</Label>
                <Input id="parent_phone" name="parent_phone" />
              </div>
              <div className="grid gap-2 md:col-span-2">
                <Label htmlFor="memo">메모</Label>
                <Textarea id="memo" name="memo" />
              </div>
            </div>
            <div>
              <Button type="submit">
                <Plus />
                등록
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
