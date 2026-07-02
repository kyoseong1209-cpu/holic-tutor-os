import Link from "next/link";
import { redirect } from "next/navigation";
import { Database, FileSearch } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/server";
import { PROBLEM_CANDIDATE_BUCKET } from "@/lib/tutor-os/problem-candidates";
import type { Problem, ProblemWithSignedUrl } from "@/lib/tutor-os/problems";

type PageProps = {
  searchParams: Promise<{ q?: string }>;
};

function matchesQuery(problem: Problem, query: string) {
  if (!query) return true;
  const haystack = [
    problem.title,
    problem.source_pdf_name,
    problem.school,
    problem.grade,
    problem.subject,
    problem.unit_scope,
    problem.exam_sections?.join(" "),
    problem.file_kind,
    problem.unit,
    problem.problem_type,
    problem.difficulty,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(query.toLowerCase());
}

async function signedProblems(
  supabase: Awaited<ReturnType<typeof createClient>>,
  problems: Problem[],
) {
  return Promise.all(
    problems.map(async (problem) => {
      const { data } = await supabase.storage
        .from(PROBLEM_CANDIDATE_BUCKET)
        .createSignedUrl(problem.image_storage_path, 60 * 60);

      return {
        ...problem,
        signedUrl: data?.signedUrl ?? null,
      };
    }),
  );
}

export default async function ProblemsPage({ searchParams }: PageProps) {
  const { q = "" } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect("/auth/login");
  }

  const { data } = await supabase
    .from("problems")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  const allProblems = (data ?? []) as Problem[];
  const filtered = allProblems.filter((problem) => matchesQuery(problem, q.trim()));
  const problems = await signedProblems(supabase, filtered);

  return (
    <div className="flex w-full flex-col gap-6">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
            문항 DB
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-normal">
            정식 등록 문항
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            승인된 crop 후보에서 정식 문항으로 등록된 자료를 확인합니다.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/protected/problem-candidates">
            <Database />
            후보 검수함
          </Link>
        </Button>
      </section>

      <form className="flex max-w-xl gap-2">
        <Input name="q" placeholder="제목, PDF, 단원, 유형으로 검색" defaultValue={q} />
        <Button type="submit" variant="outline">
          검색
        </Button>
      </form>

      {problems.length === 0 ? (
        <Card className="rounded-lg">
          <CardContent className="p-6 text-sm text-muted-foreground">
            아직 정식 등록된 문항이 없습니다.
          </CardContent>
        </Card>
      ) : (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {problems.map((problem) => (
            <ProblemCard key={problem.id} problem={problem} />
          ))}
        </section>
      )}
    </div>
  );
}

function valueOrEmpty(value: string | number | null | undefined) {
  return value ?? "-";
}

function arrayOrEmpty(value: string[] | null | undefined) {
  return value && value.length > 0 ? value.join(", ") : "-";
}

function ProblemCard({ problem }: { problem: ProblemWithSignedUrl }) {
  return (
    <Card className="overflow-hidden rounded-lg">
      <Link href={`/protected/problems/${problem.id}`}>
        <div className="flex aspect-[4/3] items-center justify-center bg-muted">
          {problem.signedUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt={`${problem.title} 이미지`}
              className="h-full w-full object-contain"
              src={problem.signedUrl}
            />
          ) : (
            <FileSearch className="size-10 text-muted-foreground" />
          )}
        </div>
      </Link>
      <CardHeader>
        <CardTitle className="text-base">{problem.title}</CardTitle>
        <CardDescription>
          {problem.source_pdf_name ?? "출처 PDF 없음"} · {valueOrEmpty(problem.question_number)}번
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2 text-sm text-muted-foreground">
        <p>학교/학년: {valueOrEmpty(problem.school)} · {valueOrEmpty(problem.grade)}</p>
        <p>연도/시험: {valueOrEmpty(problem.year)} · {valueOrEmpty(problem.semester)} · {valueOrEmpty(problem.exam_name)}</p>
        <p>과목: {valueOrEmpty(problem.subject)}</p>
        <p>범위: {valueOrEmpty(problem.unit_scope || problem.unit)}</p>
        <p>구성: {arrayOrEmpty(problem.exam_sections)}</p>
        <p>유형/난이도: {valueOrEmpty(problem.problem_type)} · {valueOrEmpty(problem.difficulty)}</p>
        <p>등록일: {new Date(problem.created_at).toLocaleDateString("ko-KR")}</p>
      </CardContent>
    </Card>
  );
}


