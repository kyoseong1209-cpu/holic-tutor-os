import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, FileSearch, Save } from "lucide-react";

import { updateProblemCandidateReview } from "@/app/protected/problem-candidates/actions";
import { PromoteProblemCandidateButton } from "@/components/promote-problem-candidate-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/server";
import {
  PROBLEM_CANDIDATE_BUCKET,
  REVIEW_GRADES,
  REVIEW_STATUSES,
  reviewGradeLabel,
  reviewStatusLabel,
  type CropImportBatch,
  type ProblemCandidate,
  type ReviewStatus,
} from "@/lib/tutor-os/problem-candidates";

type PageProps = {
  params: Promise<{ candidateId: string }>;
};

function statusBadgeClass(status: ReviewStatus) {
  if (status === "approved") return "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200";
  if (status === "needs_edit") return "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200";
  if (status === "rejected") return "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200";
  return "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200";
}

export default async function ProblemCandidateDetailPage({ params }: PageProps) {
  const { candidateId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect("/auth/login");
  }

  const { data: candidateData, error: candidateError } = await supabase
    .from("problem_candidates")
    .select("*")
    .eq("id", candidateId)
    .eq("user_id", user.id)
    .single();

  if (candidateError || !candidateData) {
    notFound();
  }

  const candidate = candidateData as ProblemCandidate;
  const [{ data: batchData }, { data: signedUrlData }] = await Promise.all([
    supabase
      .from("crop_import_batches")
      .select("*")
      .eq("id", candidate.batch_id)
      .eq("user_id", user.id)
      .single(),
    supabase.storage
      .from(PROBLEM_CANDIDATE_BUCKET)
      .createSignedUrl(candidate.image_path, 60 * 60),
  ]);
  const batch = batchData as CropImportBatch | null;
  const action = updateProblemCandidateReview.bind(null, candidate.id);

  return (
    <div className="flex w-full flex-col gap-6">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
            문항 후보 상세
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-normal">
            {candidate.candidate_id}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            q{candidate.question_number_guess ?? "-"} · page {candidate.page_number} ·{" "}
            {batch?.source_pdf_name ?? "이름 없는 PDF"}
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href={`/protected/problem-candidates?batch=${candidate.batch_id}`}>
            <ArrowLeft />
            목록으로
          </Link>
        </Button>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card className="overflow-hidden rounded-lg">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>crop 이미지</CardTitle>
                <CardDescription>{candidate.image_path}</CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={statusBadgeClass(candidate.review_status)} variant="outline">
                  {reviewStatusLabel(candidate.review_status)}
                </Badge>
                {candidate.promoted_problem_id ? (
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/protected/problems/${candidate.promoted_problem_id}`}>
                      등록 문항 보기
                    </Link>
                  </Button>
                ) : null}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex min-h-[420px] items-center justify-center rounded-lg bg-muted">
              {signedUrlData?.signedUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt={`${candidate.candidate_id} crop`}
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
              <CardTitle>검수 저장</CardTitle>
              <CardDescription>
                A/B/C 평가와 승인 상태, 검수 메모를 저장합니다.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form action={action} className="grid gap-5">
                <div className="grid gap-2">
                  <Label>A/B/C 평가</Label>
                  <div className="flex flex-wrap gap-2">
                    {REVIEW_GRADES.map((grade) => (
                      <label
                        className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm"
                        key={grade}
                      >
                        <input
                          defaultChecked={candidate.review_grade === grade}
                          name="review_grade"
                          type="radio"
                          value={grade}
                        />
                        {grade}
                      </label>
                    ))}
                    <label className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm">
                      <input
                        defaultChecked={candidate.review_grade === null}
                        name="review_grade"
                        type="radio"
                        value=""
                      />
                      미평가
                    </label>
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="review_status">검수 상태</Label>
                  <select
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm"
                    defaultValue={candidate.review_status}
                    id="review_status"
                    name="review_status"
                  >
                    {REVIEW_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {reviewStatusLabel(status)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="review_memo">검수 메모</Label>
                  <Textarea
                    id="review_memo"
                    name="review_memo"
                    placeholder="예: 하단 여백이 조금 크지만 문항은 온전함"
                    defaultValue={candidate.review_memo ?? ""}
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="rejected_reason">반려 사유</Label>
                  <Textarea
                    id="rejected_reason"
                    name="rejected_reason"
                    placeholder="반려할 때만 적어도 됩니다."
                    defaultValue={candidate.rejected_reason ?? ""}
                  />
                </div>

                <Button type="submit">
                  <Save />
                  저장
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card className="rounded-lg">
            <CardHeader>
              <CardTitle>정식 문항 등록</CardTitle>
              <CardDescription>
                approved 상태인 후보만 정식 문항 DB로 등록할 수 있습니다.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PromoteProblemCandidateButton
                candidateId={candidate.id}
                disabled={candidate.review_status !== "approved" || Boolean(candidate.promoted_problem_id)}
              />
            </CardContent>
          </Card>

          <Card className="rounded-lg">
            <CardHeader>
              <CardTitle>후보 정보</CardTitle>
              <CardDescription>
                현재 평가는 {reviewGradeLabel(candidate.review_grade)}입니다.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">candidate_id</p>
                  <p className="font-medium">{candidate.candidate_id}</p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">confidence</p>
                  <p className="font-medium">{candidate.confidence ?? "-"}</p>
                </div>
              </div>
              <div>
                <p className="mb-2 text-sm font-medium">notes</p>
                <div className="flex flex-wrap gap-2">
                  {candidate.notes.length > 0 ? (
                    candidate.notes.map((note) => (
                      <Badge key={note} variant="outline">
                        {note}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-sm text-muted-foreground">notes 없음</span>
                  )}
                </div>
              </div>
              <div>
                <p className="mb-2 text-sm font-medium">bbox JSON</p>
                <pre className="overflow-auto rounded-md bg-muted p-3 text-xs">
                  {JSON.stringify(candidate.bbox, null, 2)}
                </pre>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
