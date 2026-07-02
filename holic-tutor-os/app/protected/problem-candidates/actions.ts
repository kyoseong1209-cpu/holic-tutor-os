"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import {
  PROBLEM_CANDIDATE_BUCKET,
  isReviewGrade,
  isReviewStatus,
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

function gradeFromForm(formData: FormData): ReviewGrade | null | undefined {
  if (!formData.has("review_grade")) return undefined;

  const value = formString(formData, "review_grade");
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

export async function updateProblemCandidateReview(
  candidateId: string,
  formData: FormData,
) {
  const { supabase, user } = await requireUser();
  const reviewGrade = gradeFromForm(formData);
  const reviewStatus = statusFromForm(formData);

  const updates: Record<string, string | null> = {};
  if (reviewGrade !== undefined) {
    updates.review_grade = reviewGrade;
  }
  if (reviewStatus !== undefined) {
    const now = new Date().toISOString();
    updates.review_status = reviewStatus;
    updates.reviewed_at = now;
    updates.approved_at = reviewStatus === "approved" ? now : null;
  }
  if (formData.has("review_memo")) {
    updates.review_memo = nullableFormString(formData, "review_memo");
  }
  if (formData.has("rejected_reason")) {
    updates.rejected_reason = nullableFormString(formData, "rejected_reason");
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
  const storagePaths = uniqueStoragePaths([
    batch.coordinates_path,
    batch.contact_sheet_path,
    batch.summary_path,
    ...imagePaths,
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

