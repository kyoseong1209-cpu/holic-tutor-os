import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, FileSearch, Save } from "lucide-react";

import { updateProblem } from "@/app/protected/problems/actions";
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
import { PROBLEM_CANDIDATE_BUCKET } from "@/lib/tutor-os/problem-candidates";
import type { Problem } from "@/lib/tutor-os/problems";

type PageProps = {
  params: Promise<{ problemId: string }>;
};

function optionalText(value: string | null | undefined) {
  return value && value.trim().length > 0 ? value : "아직 입력되지 않음";
}

function infoRow(label: string, value: string | number | null | undefined) {
  return (
    <div className="flex items-start justify-between gap-4 border-b py-3 last:border-b-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="max-w-[65%] text-right text-sm font-medium">
        {value ?? "아직 입력되지 않음"}
      </span>
    </div>
  );
}

export default async function ProblemDetailPage({ params }: PageProps) {
  const { problemId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect("/auth/login");
  }

  const { data: problemData, error: problemError } = await supabase
    .from("problems")
    .select("*")
    .eq("id", problemId)
    .eq("user_id", user.id)
    .single();

  if (problemError || !problemData) {
    notFound();
  }

  const problem = problemData as Problem;
  const { data: signedUrlData } = await supabase.storage
    .from(PROBLEM_CANDIDATE_BUCKET)
    .createSignedUrl(problem.image_storage_path, 60 * 60);
  const updateAction = updateProblem.bind(null, problem.id);

  return (
    <div className="flex w-full flex-col gap-6">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
            문항 DB
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-normal">
            {problem.title}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {problem.source_pdf_name ?? "출처 PDF 없음"} ·{" "}
            {problem.question_number ?? "-"}번
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/protected/problems">
            <ArrowLeft />
            문항 목록
          </Link>
        </Button>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card className="overflow-hidden rounded-lg">
          <CardHeader>
            <CardTitle>문항 이미지</CardTitle>
            <CardDescription>{problem.image_storage_path}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex min-h-[420px] items-center justify-center rounded-lg bg-muted">
              {signedUrlData?.signedUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt={`${problem.title} 이미지`}
                  className="max-h-[70vh] w-full object-contain"
                  src={signedUrlData.signedUrl}
                />
              ) : (
                <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
                  <FileSearch className="size-10" />
                  이미지를 불러오지 못했습니다.
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4">
          <Card className="rounded-lg">
            <CardHeader>
              <CardTitle>기본 정보</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="divide-y">
                {infoRow("학교", problem.school)}
                {infoRow("학년", problem.grade)}
                {infoRow("연도", problem.year)}
                {infoRow("학기", problem.semester)}
                {infoRow("시험명", problem.exam_name)}
                {infoRow("단원", problem.unit)}
                {infoRow("유형", problem.problem_type)}
                {infoRow("난이도", problem.difficulty)}
                {infoRow("검수 등급", problem.review_grade)}
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-lg">
            <CardHeader>
              <CardTitle>풀이 정보</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 text-sm">
              <section>
                <p className="font-medium">정답</p>
                <p className="mt-2 whitespace-pre-line text-muted-foreground">
                  {optionalText(problem.answer)}
                </p>
              </section>
              <section>
                <p className="font-medium">핵심 아이디어</p>
                <p className="mt-2 whitespace-pre-line text-muted-foreground">
                  {optionalText(problem.core_idea)}
                </p>
              </section>
              <section>
                <p className="font-medium">정석 풀이</p>
                <p className="mt-2 whitespace-pre-line text-muted-foreground">
                  {optionalText(problem.standard_solution)}
                </p>
              </section>
              <section>
                <p className="font-medium">우아한 풀이</p>
                <p className="mt-2 whitespace-pre-line text-muted-foreground">
                  {optionalText(problem.elegant_solution)}
                </p>
              </section>
              <section>
                <p className="font-medium">오답 유발 포인트</p>
                <p className="mt-2 whitespace-pre-line text-muted-foreground">
                  {problem.mistake_points.length > 0
                    ? problem.mistake_points.join("\n")
                    : "아직 입력되지 않음"}
                </p>
              </section>
              <section>
                <p className="font-medium">선생님 메모</p>
                <p className="mt-2 whitespace-pre-line text-muted-foreground">
                  {optionalText(problem.teacher_note)}
                </p>
              </section>
            </CardContent>
          </Card>
        </div>
      </section>

      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle>문항 정보 수정</CardTitle>
          <CardDescription>
            이번 단계에서는 기본 정보와 풀이 메모만 간단히 수정합니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={updateAction} className="grid gap-5">
            <div className="grid gap-4 md:grid-cols-2">
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
                <Input id="year" name="year" inputMode="numeric" defaultValue={problem.year ?? ""} />
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
                <Label htmlFor="unit">단원</Label>
                <Input id="unit" name="unit" defaultValue={problem.unit ?? ""} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="problem_type">유형</Label>
                <Input id="problem_type" name="problem_type" defaultValue={problem.problem_type ?? ""} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="difficulty">난이도</Label>
                <Input id="difficulty" name="difficulty" defaultValue={problem.difficulty ?? ""} />
              </div>
              <div className="grid gap-2 md:col-span-2">
                <Label htmlFor="answer">정답</Label>
                <Textarea id="answer" name="answer" defaultValue={problem.answer ?? ""} />
              </div>
              <div className="grid gap-2 md:col-span-2">
                <Label htmlFor="core_idea">핵심 아이디어</Label>
                <Textarea id="core_idea" name="core_idea" defaultValue={problem.core_idea ?? ""} />
              </div>
              <div className="grid gap-2 md:col-span-2">
                <Label htmlFor="standard_solution">정석 풀이</Label>
                <Textarea id="standard_solution" name="standard_solution" defaultValue={problem.standard_solution ?? ""} />
              </div>
              <div className="grid gap-2 md:col-span-2">
                <Label htmlFor="elegant_solution">우아한 풀이</Label>
                <Textarea id="elegant_solution" name="elegant_solution" defaultValue={problem.elegant_solution ?? ""} />
              </div>
              <div className="grid gap-2 md:col-span-2">
                <Label htmlFor="mistake_points">오답 유발 포인트</Label>
                <Textarea
                  id="mistake_points"
                  name="mistake_points"
                  defaultValue={problem.mistake_points.join("\n")}
                />
              </div>
              <div className="grid gap-2 md:col-span-2">
                <Label htmlFor="teacher_note">선생님 메모</Label>
                <Textarea id="teacher_note" name="teacher_note" defaultValue={problem.teacher_note ?? ""} />
              </div>
            </div>
            <div>
              <Button type="submit">
                <Save />
                저장
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
