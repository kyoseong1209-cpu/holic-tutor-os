"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import {
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
