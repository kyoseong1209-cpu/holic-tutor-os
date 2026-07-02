import Link from "next/link";
import { redirect } from "next/navigation";
import {
  FileSearch,
  Flag,
  UploadCloud,
} from "lucide-react";

import { updateProblemCandidateReview } from "@/app/protected/problem-candidates/actions";
import { ProblemBatchDeleteButton } from "@/components/problem-batch-delete-button";
import { PromoteApprovedBatchButton } from "@/components/promote-approved-batch-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import {
  PROBLEM_CANDIDATE_BUCKET,
  reviewGradeLabel,
  reviewStatusLabel,
  type CandidateWithSignedUrl,
  type CropImportBatch,
  type ProblemCandidate,
  type ReviewGrade,
  type ReviewStatus,
} from "@/lib/tutor-os/problem-candidates";

type PageProps = {
  searchParams: Promise<{
    batch?: string;
    notice?: string;
    noticeType?: "success" | "partial" | "error";
  }>;
};

function statusBadgeClass(status: ReviewStatus) {
  if (status === "approved") return "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200";
  if (status === "needs_edit") return "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200";
  if (status === "rejected") return "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200";
  return "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200";
}

function gradeButtonClass(active: boolean, grade: ReviewGrade) {
  const base = "h-8 rounded-md px-3 text-xs";
  if (!active) return base;
  if (grade === "A") return `${base} bg-emerald-600 text-white hover:bg-emerald-700`;
  if (grade === "B") return `${base} bg-sky-600 text-white hover:bg-sky-700`;
  return `${base} bg-rose-600 text-white hover:bg-rose-700`;
}

function CandidateActionButton({
  candidateId,
  label,
  grade,
  status,
  variant = "outline",
}: {
  candidateId: string;
  label: string;
  grade?: ReviewGrade;
  status?: ReviewStatus;
  variant?: "outline" | "secondary" | "destructive";
}) {
  const action = updateProblemCandidateReview.bind(null, candidateId);

  return (
    <form action={action}>
      {grade ? <input name="review_grade" type="hidden" value={grade} /> : null}
      {status ? <input name="review_status" type="hidden" value={status} /> : null}
      <Button size="sm" type="submit" variant={variant}>
        {label}
      </Button>
    </form>
  );
}

async function signedCandidates(
  supabase: Awaited<ReturnType<typeof createClient>>,
  candidates: ProblemCandidate[],
) {
  return Promise.all(
    candidates.map(async (candidate) => {
      const { data } = await supabase.storage
        .from(PROBLEM_CANDIDATE_BUCKET)
        .createSignedUrl(candidate.image_path, 60 * 60);

      return {
        ...candidate,
        signedUrl: data?.signedUrl ?? null,
      };
    }),
  );
}

export default async function ProblemCandidatesPage({ searchParams }: PageProps) {
  const {
    batch: selectedBatchParam,
    notice,
    noticeType = "success",
  } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect("/auth/login");
  }

  const { data: batchesData } = await supabase
    .from("crop_import_batches")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  const batches = (batchesData ?? []) as CropImportBatch[];
  const selectedBatch =
    batches.find((batch) => batch.id === selectedBatchParam) ?? batches[0] ?? null;

  const { data: candidatesData } = selectedBatch
    ? await supabase
        .from("problem_candidates")
        .select("*")
        .eq("user_id", user.id)
        .eq("batch_id", selectedBatch.id)
        .order("question_number_guess", { ascending: true, nullsFirst: false })
        .order("candidate_id", { ascending: true })
    : { data: [] };

  const candidates = await signedCandidates(
    supabase,
    (candidatesData ?? []) as ProblemCandidate[],
  );

  return (
    <div className="flex w-full flex-col gap-6">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
            문항 후보 검수함
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-normal">
            crop 후보 검수
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            업로드한 crop 후보를 A/B/C로 평가하고 승인 상태를 관리합니다.
          </p>
        </div>
        <Button asChild>
          <Link href="/protected/problem-candidates/import">
            <UploadCloud />
            crop 결과 가져오기
          </Link>
        </Button>
      </section>

      {notice ? (
        <div
          className={
            noticeType === "error"
              ? "rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
              : noticeType === "partial"
                ? "rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
                : "rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
          }
          role="status"
        >
          {notice}
        </div>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <aside className="grid content-start gap-3">
          <Card className="rounded-lg">
            <CardHeader>
              <CardTitle className="text-lg">가져오기 묶음</CardTitle>
              <CardDescription>{batches.length}개 batch</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2">
              {batches.length === 0 ? (
                <p className="text-sm text-muted-foreground">아직 가져온 crop 결과가 없습니다.</p>
              ) : (
                batches.map((batch) => {
                  const batchName = batch.source_pdf_name ?? "이름 없는 PDF";

                  return (
                    <div
                      className={
                        batch.id === selectedBatch?.id
                          ? "grid gap-3 rounded-md border border-emerald-500 bg-emerald-50 p-3 text-sm dark:bg-emerald-950"
                          : "grid gap-3 rounded-md border p-3 text-sm transition hover:bg-muted"
                      }
                      key={batch.id}
                    >
                      <Link href={`/protected/problem-candidates?batch=${batch.id}`}>
                        <p className="font-medium">{batchName}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {batch.crop_version} · {batch.generated_crop_count ?? 0}개 후보
                        </p>
                      </Link>
                      <ProblemBatchDeleteButton batchId={batch.id} batchName={batchName} />
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </aside>

        <div className="grid content-start gap-4">
          {selectedBatch ? (
            <Card className="rounded-lg">
              <CardHeader className="gap-2">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <CardTitle>{selectedBatch.source_pdf_name ?? "이름 없는 PDF"}</CardTitle>
                    <CardDescription>
                      expected {selectedBatch.expected_count ?? "-"} · detected{" "}
                      {selectedBatch.detected_anchor_count ?? "-"} · missing{" "}
                      {selectedBatch.missing_question_numbers.length}
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">{selectedBatch.crop_version}</Badge>
                    <PromoteApprovedBatchButton batchId={selectedBatch.id} />
                  </div>
                </div>
              </CardHeader>
            </Card>
          ) : null}

          {candidates.length === 0 ? (
            <Card className="rounded-lg">
              <CardContent className="p-6 text-sm text-muted-foreground">
                선택된 batch에 표시할 후보가 없습니다.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {candidates.map((candidate) => (
                <CandidateCard candidate={candidate} key={candidate.id} />
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function CandidateCard({ candidate }: { candidate: CandidateWithSignedUrl }) {
  return (
    <Card className="overflow-hidden rounded-lg">
      <Link href={`/protected/problem-candidates/${candidate.id}`}>
        <div className="flex aspect-[4/3] items-center justify-center bg-muted">
          {candidate.signedUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt={`${candidate.candidate_id} crop`}
              className="h-full w-full object-contain"
              src={candidate.signedUrl}
            />
          ) : (
            <FileSearch className="size-10 text-muted-foreground" />
          )}
        </div>
      </Link>
      <CardHeader className="gap-2 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">{candidate.candidate_id}</CardTitle>
            <CardDescription>
              q{candidate.question_number_guess ?? "-"} · page {candidate.page_number}
            </CardDescription>
          </div>
          <Badge className={statusBadgeClass(candidate.review_status)} variant="outline">
            {reviewStatusLabel(candidate.review_status)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-md border p-2">
            <p className="text-xs text-muted-foreground">confidence</p>
            <p className="font-medium">{candidate.confidence ?? "-"}</p>
          </div>
          <div className="rounded-md border p-2">
            <p className="text-xs text-muted-foreground">A/B/C</p>
            <p className="font-medium">{reviewGradeLabel(candidate.review_grade)}</p>
          </div>
        </div>

        <p className="line-clamp-2 min-h-10 text-sm text-muted-foreground">
          {candidate.notes.length > 0 ? candidate.notes.join(", ") : "notes 없음"}
        </p>

        <div className="flex flex-wrap gap-2">
          {(["A", "B", "C"] as ReviewGrade[]).map((grade) => (
            <form action={updateProblemCandidateReview.bind(null, candidate.id)} key={grade}>
              <input name="review_grade" type="hidden" value={grade} />
              <Button
                className={gradeButtonClass(candidate.review_grade === grade, grade)}
                size="sm"
                type="submit"
                variant={candidate.review_grade === grade ? "default" : "outline"}
              >
                {grade}
              </Button>
            </form>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <CandidateActionButton
            candidateId={candidate.id}
            label="승인"
            status="approved"
            variant="secondary"
          />
          <CandidateActionButton
            candidateId={candidate.id}
            label="보류"
            status="needs_edit"
          />
          <CandidateActionButton
            candidateId={candidate.id}
            label="반려"
            status="rejected"
            variant="destructive"
          />
        </div>

        <Button asChild size="sm" variant="ghost">
          <Link href={`/protected/problem-candidates/${candidate.id}`}>
            <Flag />
            상세 검수
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
