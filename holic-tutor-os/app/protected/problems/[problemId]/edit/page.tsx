import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, FileSearch } from "lucide-react";

import { ProblemEditForm } from "@/components/problem-edit-form";
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

export default async function ProblemEditPage({ params }: PageProps) {
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
            문항 정보 수정
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {problem.source_pdf_name ?? "출처 PDF 없음"} · {problem.question_number ?? "-"}번
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href={`/protected/problems/${problem.id}`}>
            <ArrowLeft />
            상세로 돌아가기
          </Link>
        </Button>
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
        <Card className="h-fit overflow-hidden rounded-lg xl:sticky xl:top-5">
          <CardHeader>
            <CardTitle>문항 이미지</CardTitle>
            <CardDescription>{problem.image_storage_path}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex min-h-[320px] items-center justify-center rounded-lg bg-muted">
              {signedUrlData?.signedUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt={`${problem.title} 이미지`}
                  className="max-h-[65vh] w-full object-contain"
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

        <ProblemEditForm problem={problem} />
      </section>
    </div>
  );
}
