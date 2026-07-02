"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

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

export async function updateProblem(problemId: string, formData: FormData) {
  const { supabase, user } = await requireUser();
  const title = text(formData, "title");

  if (!title) {
    throw new Error("제목은 필수입니다.");
  }

  const { error } = await supabase
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
      difficulty: nullableText(formData, "difficulty"),
      answer: nullableText(formData, "answer"),
      core_idea: nullableText(formData, "core_idea"),
      standard_solution: nullableText(formData, "standard_solution"),
      elegant_solution: nullableText(formData, "elegant_solution"),
      mistake_points: lines(formData, "mistake_points"),
      teacher_note: nullableText(formData, "teacher_note"),
    })
    .eq("id", problemId)
    .eq("user_id", user.id);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/protected/problems");
  revalidatePath(`/protected/problems/${problemId}`);
}
