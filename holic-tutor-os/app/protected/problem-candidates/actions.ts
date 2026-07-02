"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import {
  PROBLEM_CANDIDATE_BUCKET,
  isReviewGrade,
  isReviewStatus,
  statusForFinalGrade,
  type ReviewGrade,
  type ReviewStatus,
} from "@/lib/tutor-os/problem-candidates";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect("/auth/login");
  }

  return { supabase, user };
}

function formString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function nullableFormString(formData: FormData, key: string) {
  const value = formString(formData, key);
  return value.length > 0 ? value : null;
}

function manualGradeFromForm(formData: FormData): ReviewGrade | null | undefined {
  const key = formData.has("manual_review_grade") ? "manual_review_grade" : "review_grade";
  if (!formData.has(key)) return undefined;

  const value = formString(formData, key);
  if (!value) return null;
  if (isReviewGrade(value)) return value;

  throw new Error("A/B/C 평가값이 올바르지 않습니다.");
}

function statusFromForm(formData: FormData): ReviewStatus | undefined {
  if (!formData.has("review_status")) return undefined;

  const value = formString(formData, "review_status");
  if (isReviewStatus(value)) return value;

  throw new Error("검수 상태값이 올바르지 않습니다.");
}

type ReviewStateRow = {
  auto_review_grade: ReviewGrade | null;
  manual_review_grade: ReviewGrade | null;
  final_review_grade: ReviewGrade | null;
  review_grade: ReviewGrade | null;
};

function effectiveGrade(candidate: ReviewStateRow, nextManualGrade?: ReviewGrade | null) {
  if (nextManualGrade !== undefined) {
    return nextManualGrade ?? candidate.auto_review_grade ?? null;
  }

  return (
    candidate.final_review_grade ??
    candidate.manual_review_grade ??
    candidate.review_grade ??
    candidate.auto_review_grade ??
    null
  );
}

export async function updateProblemCandidateReview(
  candidateId: string,
  formData: FormData,
) {
  const { supabase, user } = await requireUser();
  const manualGrade = manualGradeFromForm(formData);
  const reviewStatus = statusFromForm(formData);

  const { data: currentData, error: currentError } = await supabase
    .from("problem_candidates")
    .select("auto_review_grade,manual_review_grade,final_review_grade,review_grade")
    .eq("id", candidateId)
    .eq("user_id", user.id)
    .single();

  if (currentError || !currentData) {
    throw new Error(currentError?.message ?? "후보를 찾지 못했습니다.");
  }

  const current = currentData as ReviewStateRow;
  const nextFinalGrade = effectiveGrade(current, manualGrade);
  const now = new Date().toISOString();
  const updates: Record<string, string | null> = {};
  const hasManualReviewInput =
    manualGrade !== undefined ||
    reviewStatus !== undefined ||
    formData.has("review_memo") ||
    formData.has("rejected_reason");

  if (manualGrade !== undefined) {
    updates.manual_review_grade = manualGrade;
    updates.review_grade = manualGrade;
    updates.final_review_grade = nextFinalGrade;
  }

  if (reviewStatus !== undefined) {
    updates.review_status = reviewStatus;
  } else if (manualGrade !== undefined) {
    updates.review_status = statusForFinalGrade(nextFinalGrade);
  }

  if (updates.review_status !== undefined) {
    updates.approved_at = updates.review_status === "approved" ? now : null;
  }

  if (formData.has("review_memo")) {
    updates.review_memo = nullableFormString(formData, "review_memo");
  }
  if (formData.has("rejected_reason")) {
    updates.rejected_reason = nullableFormString(formData, "rejected_reason");
  }

  if (hasManualReviewInput) {
    updates.reviewed_by = user.id;
    updates.reviewed_at = now;
    updates.review_source = "manual";
    updates.review_version = "manual_override_v1";
  }

  if (Object.keys(updates).length === 0) {
    return;
  }

  const { error } = await supabase
    .from("problem_candidates")
    .update(updates)
    .eq("id", candidateId)
    .eq("user_id", user.id);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/protected/problem-candidates");
  revalidatePath(`/protected/problem-candidates/${candidateId}`);
}

export type BatchDeleteResult = {
  status: "success" | "partial" | "error";
  message: string;
};

type StoragePathRow = {
  image_path: string | null;
};

type ProblemImagePathRow = {
  image_storage_path: string | null;
};

type BatchStorageRow = {
  id: string;
  coordinates_path: string | null;
  contact_sheet_path: string | null;
  summary_path: string | null;
};

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }

  return "알 수 없는 오류가 발생했습니다.";
}

function uniqueStoragePaths(paths: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      paths
        .map((path) => path?.trim())
        .filter((path): path is string => Boolean(path)),
    ),
  );
}

export async function deleteProblemCandidateBatch(
  batchId: string,
): Promise<BatchDeleteResult> {
  const { supabase, user } = await requireUser();

  const { data: batchData, error: batchError } = await supabase
    .from("crop_import_batches")
    .select("id,coordinates_path,contact_sheet_path,summary_path")
    .eq("id", batchId)
    .eq("user_id", user.id)
    .single();

  if (batchError || !batchData) {
    return {
      status: "error",
      message: `DB batch 조회 실패: ${errorMessage(batchError)}`,
    };
  }

  const batch = batchData as BatchStorageRow;
  const { data: candidateRows, error: candidatesSelectError } = await supabase
    .from("problem_candidates")
    .select("image_path")
    .eq("batch_id", batch.id)
    .eq("user_id", user.id);

  if (candidatesSelectError) {
    return {
      status: "error",
      message: `DB 후보 조회 실패: ${errorMessage(candidatesSelectError)}`,
    };
  }

  const imagePaths = ((candidateRows ?? []) as StoragePathRow[]).map(
    (candidate) => candidate.image_path,
  );
  const existingImagePaths = uniqueStoragePaths(imagePaths);
  let protectedImagePaths = new Set<string>();
  if (existingImagePaths.length > 0) {
    const { data: problemRows, error: problemRowsError } = await supabase
      .from("problems")
      .select("image_storage_path")
      .eq("user_id", user.id)
      .in("image_storage_path", existingImagePaths);

    if (problemRowsError) {
      return {
        status: "error",
        message: `문항 DB 이미지 보호 조회 실패: ${errorMessage(problemRowsError)}`,
      };
    }

    protectedImagePaths = new Set(
      ((problemRows ?? []) as ProblemImagePathRow[])
        .map((problem) => problem.image_storage_path)
        .filter((path): path is string => Boolean(path)),
    );
  }

  const storagePaths = uniqueStoragePaths([
    batch.coordinates_path,
    batch.contact_sheet_path,
    batch.summary_path,
    ...imagePaths.filter((path) => !protectedImagePaths.has(path ?? "")),
  ]);

  let storageDeleteMessage: string | null = null;
  if (storagePaths.length > 0) {
    const { error } = await supabase.storage
      .from(PROBLEM_CANDIDATE_BUCKET)
      .remove(storagePaths);

    if (error) {
      storageDeleteMessage = `Storage 파일 삭제 실패: ${errorMessage(error)}`;
    }
  }

  const { error: candidatesDeleteError } = await supabase
    .from("problem_candidates")
    .delete()
    .eq("batch_id", batch.id)
    .eq("user_id", user.id);

  if (candidatesDeleteError) {
    return {
      status: "error",
      message: `DB 후보 삭제 실패: ${errorMessage(candidatesDeleteError)}${
        storageDeleteMessage ? ` / ${storageDeleteMessage}` : ""
      }`,
    };
  }

  const { error: batchDeleteError } = await supabase
    .from("crop_import_batches")
    .delete()
    .eq("id", batch.id)
    .eq("user_id", user.id);

  if (batchDeleteError) {
    return {
      status: "error",
      message: `DB batch 삭제 실패: ${errorMessage(batchDeleteError)}${
        storageDeleteMessage ? ` / ${storageDeleteMessage}` : ""
      }`,
    };
  }

  revalidatePath("/protected/problem-candidates");

  if (storageDeleteMessage) {
    return {
      status: "partial",
      message: `DB에서는 가져오기 묶음을 삭제했습니다. ${storageDeleteMessage}`,
    };
  }

  return {
    status: "success",
    message: "가져오기 묶음이 삭제되었습니다",
  };
}

export type PromotionResult = {
  status: "success" | "error";
  message: string;
  promotedCount: number;
  skippedCount: number;
  failedCount: number;
};

type PromotionCandidateRow = {
  id: string;
  batch_id: string;
  candidate_id: string;
  question_number_guess: number | null;
  image_path: string;
  source_pdf_name: string | null;
  crop_version: string;
  bbox: unknown;
  review_status: ReviewStatus;
  review_grade: ReviewGrade | null;
  auto_review_grade: ReviewGrade | null;
  manual_review_grade: ReviewGrade | null;
  final_review_grade: ReviewGrade | null;
  promoted_at: string | null;
  promoted_problem_id: string | null;
};

type PromotionBatchRow = {
  id: string;
  source_pdf_name: string | null;
  crop_version: string;
};

function problemTitle(input: {
  sourcePdfName: string | null;
  questionNumber: number | null;
}) {
  const sourceName = input.sourcePdfName || "출처 미상";
  return input.questionNumber ? `${sourceName} ${input.questionNumber}번` : sourceName;
}

function emptyPromotionResult(message: string, status: "success" | "error" = "success"): PromotionResult {
  return {
    status,
    message,
    promotedCount: 0,
    skippedCount: 0,
    failedCount: status === "error" ? 1 : 0,
  };
}

function candidateFinalGrade(candidate: PromotionCandidateRow) {
  return (
    candidate.final_review_grade ??
    candidate.manual_review_grade ??
    candidate.review_grade ??
    candidate.auto_review_grade ??
    null
  );
}

function candidateCanPromote(candidate: PromotionCandidateRow) {
  if (candidate.review_status === "needs_edit" || candidate.review_status === "rejected") {
    return false;
  }

  return candidate.review_status === "approved" || candidateFinalGrade(candidate) === "A";
}

async function promoteCandidateRows(
  rows: PromotionCandidateRow[],
  batch: PromotionBatchRow,
): Promise<PromotionResult> {
  const { supabase, user } = await requireUser();
  let promotedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  const failures: string[] = [];

  for (const candidate of rows) {
    if (!candidateCanPromote(candidate)) {
      skippedCount += 1;
      continue;
    }

    if (candidate.promoted_at || candidate.promoted_problem_id) {
      skippedCount += 1;
      continue;
    }

    const finalGrade = candidateFinalGrade(candidate);
    const { data: existingProblem, error: existingProblemError } = await supabase
      .from("problems")
      .select("id")
      .eq("source_candidate_id", candidate.id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (existingProblemError) {
      failedCount += 1;
      failures.push(`${candidate.candidate_id}: 중복 확인 실패`);
      continue;
    }

    if (existingProblem) {
      skippedCount += 1;
      await supabase
        .from("problem_candidates")
        .update({
          promoted_at: new Date().toISOString(),
          promoted_problem_id: existingProblem.id,
        })
        .eq("id", candidate.id)
        .eq("user_id", user.id);
      continue;
    }

    const { data: problem, error: insertError } = await supabase
      .from("problems")
      .insert({
        user_id: user.id,
        source_candidate_id: candidate.id,
        source_batch_id: candidate.batch_id,
        title: problemTitle({
          sourcePdfName: batch.source_pdf_name ?? candidate.source_pdf_name,
          questionNumber: candidate.question_number_guess,
        }),
        source_pdf_name: batch.source_pdf_name ?? candidate.source_pdf_name,
        question_number: candidate.question_number_guess,
        image_storage_path: candidate.image_path,
        bbox: candidate.bbox,
        crop_version: candidate.crop_version ?? batch.crop_version,
        review_grade: finalGrade,
      })
      .select("id")
      .single();

    if (insertError || !problem) {
      failedCount += 1;
      failures.push(`${candidate.candidate_id}: ${errorMessage(insertError)}`);
      continue;
    }

    const { error: updateCandidateError } = await supabase
      .from("problem_candidates")
      .update({
        promoted_at: new Date().toISOString(),
        promoted_problem_id: problem.id,
      })
      .eq("id", candidate.id)
      .eq("user_id", user.id);

    if (updateCandidateError) {
      failedCount += 1;
      failures.push(`${candidate.candidate_id}: 후보 승격 표시 실패`);
      continue;
    }

    promotedCount += 1;
  }

  revalidatePath("/protected/problem-candidates");
  revalidatePath("/protected/problems");

  const message = [
    `정식 문항 등록 완료: 성공 ${promotedCount}개, 건너뜀 ${skippedCount}개, 실패 ${failedCount}개`,
    failures.length > 0 ? failures.slice(0, 3).join(" / ") : null,
  ]
    .filter(Boolean)
    .join(" / ");

  return {
    status: failedCount > 0 ? "error" : "success",
    message,
    promotedCount,
    skippedCount,
    failedCount,
  };
}

export async function promoteApprovedBatchCandidates(
  batchId: string,
): Promise<PromotionResult> {
  const { supabase, user } = await requireUser();

  const { data: batchData, error: batchError } = await supabase
    .from("crop_import_batches")
    .select("id,source_pdf_name,crop_version")
    .eq("id", batchId)
    .eq("user_id", user.id)
    .single();

  if (batchError || !batchData) {
    return emptyPromotionResult(`batch 조회 실패: ${errorMessage(batchError)}`, "error");
  }

  const { data: candidatesData, error: candidatesError } = await supabase
    .from("problem_candidates")
    .select("*")
    .eq("batch_id", batchId)
    .eq("user_id", user.id)
    .order("question_number_guess", { ascending: true, nullsFirst: false });

  if (candidatesError) {
    return emptyPromotionResult(`승격 후보 조회 실패: ${errorMessage(candidatesError)}`, "error");
  }

  const rows = ((candidatesData ?? []) as PromotionCandidateRow[]).filter(candidateCanPromote);
  if (rows.length === 0) {
    return emptyPromotionResult("정식 DB로 보낼 자동 승인 또는 최종 A 후보가 없습니다.");
  }

  return promoteCandidateRows(rows, batchData as PromotionBatchRow);
}

export async function promoteProblemCandidate(
  candidateId: string,
): Promise<PromotionResult> {
  const { supabase, user } = await requireUser();

  const { data: candidateData, error: candidateError } = await supabase
    .from("problem_candidates")
    .select("*")
    .eq("id", candidateId)
    .eq("user_id", user.id)
    .single();

  if (candidateError || !candidateData) {
    return emptyPromotionResult(`후보 조회 실패: ${errorMessage(candidateError)}`, "error");
  }

  const candidate = candidateData as PromotionCandidateRow;
  if (!candidateCanPromote(candidate)) {
    return emptyPromotionResult("최종 A 또는 approved 상태인 후보만 정식 문항으로 등록할 수 있습니다.", "error");
  }

  const { data: batchData, error: batchError } = await supabase
    .from("crop_import_batches")
    .select("id,source_pdf_name,crop_version")
    .eq("id", candidate.batch_id)
    .eq("user_id", user.id)
    .single();

  if (batchError || !batchData) {
    return emptyPromotionResult(`batch 조회 실패: ${errorMessage(batchError)}`, "error");
  }

  return promoteCandidateRows([candidate], batchData as PromotionBatchRow);
}
