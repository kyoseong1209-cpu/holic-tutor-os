"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { isProblemDifficulty } from "@/lib/tutor-os/problems";

export type ProblemMutationState = {
  status: "idle" | "success" | "error";
  message: string;
  mutationId?: number;
};

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

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function nullableText(formData: FormData, key: string) {
  const value = text(formData, key);
  return value.length > 0 ? value : null;
}

function nullableInteger(formData: FormData, key: string) {
  const value = text(formData, key);
  if (!value) return null;

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function lines(formData: FormData, key: string) {
  return text(formData, key)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function mutationId() {
  return Date.now();
}

function failure(message: string): ProblemMutationState {
  return {
    status: "error",
    message,
    mutationId: mutationId(),
  };
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;

  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }

  return "알 수 없는 오류가 발생했습니다.";
}

export async function updateProblem(
  problemId: string,
  _prevState: ProblemMutationState,
  formData: FormData,
): Promise<ProblemMutationState> {
  const { supabase, user } = await requireUser();

  try {
    const title = text(formData, "title");
    const difficulty = nullableText(formData, "difficulty");

    if (!title) {
      return failure("문항 정보 저장에 실패했습니다. 제목은 필수입니다.");
    }

    if (difficulty && !isProblemDifficulty(difficulty)) {
      return failure("문항 정보 저장에 실패했습니다. 난이도는 하, 중, 중상, 상, 최상, 킬러 중에서 선택해주세요.");
    }

    const { data, error } = await supabase
      .from("problems")
      .update({
        title,
        school: nullableText(formData, "school"),
        grade: nullableText(formData, "grade"),
        year: nullableInteger(formData, "year"),
        semester: nullableText(formData, "semester"),
        exam_name: nullableText(formData, "exam_name"),
        unit: nullableText(formData, "unit"),
        problem_type: nullableText(formData, "problem_type"),
        difficulty,
        answer: nullableText(formData, "answer"),
        core_idea: nullableText(formData, "core_idea"),
        standard_solution: nullableText(formData, "standard_solution"),
        elegant_solution: nullableText(formData, "elegant_solution"),
        mistake_points: lines(formData, "mistake_points"),
        teacher_note: nullableText(formData, "teacher_note"),
      })
      .eq("id", problemId)
      .eq("user_id", user.id)
      .select("id")
      .single();

    if (error || !data) {
      return failure(`문항 정보 저장에 실패했습니다. ${errorMessage(error)}`);
    }

    revalidatePath("/protected/problems");
    revalidatePath(`/protected/problems/${problemId}`);
    revalidatePath(`/protected/problems/${problemId}/edit`);

    return {
      status: "success",
      message: "문항 정보가 저장되었습니다",
      mutationId: mutationId(),
    };
  } catch (error) {
    return failure(`문항 정보 저장에 실패했습니다. ${errorMessage(error)}`);
  }
}

