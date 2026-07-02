import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, FileSearch, Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button asChild variant="outline">
            <Link href="/protected/problems">
              <ArrowLeft />
              문항 목록
            </Link>
          </Button>
          <Button asChild>
            <Link href={`/protected/problems/${problem.id}/edit`}>
              <Pencil />
              수정
            </Link>
          </Button>
        </div>
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
                {infoRow("세부 유형", problem.problem_type)}
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
    </div>
  );
}
