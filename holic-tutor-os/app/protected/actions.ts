"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import type { StudentStatus } from "@/lib/tutor-os/types";

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function nullableText(formData: FormData, key: string) {
  const value = text(formData, key);
  return value.length > 0 ? value : null;
}

function positiveInteger(formData: FormData, key: string) {
  const value = text(formData, key);
  if (!value) return null;

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function weaknessTags(formData: FormData) {
  return text(formData, "weakness_tags")
    .split(/[,\n]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function statusValue(formData: FormData): StudentStatus {
  const status = text(formData, "status");
  if (status === "paused" || status === "archived") {
    return status;
  }

  return "active";
}

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

function parentFeedbackDraft(input: {
  topic: string;
  content: string | null;
  strengths: string | null;
  parentNote: string | null;
  homework: string | null;
  nextPlan: string | null;
  weaknessTags: string[];
}) {
  const lines = [`안녕하세요. 오늘은 ${input.topic} 단원을 중심으로 수업했습니다.`];

  if (input.content) {
    lines.push(`오늘 다룬 내용은 ${input.content}입니다.`);
  }

  if (input.strengths) {
    lines.push(`좋았던 점은 ${input.strengths}입니다.`);
  }

  if (input.weaknessTags.length > 0) {
    lines.push(`반복해서 점검할 부분은 ${input.weaknessTags.join(", ")}입니다.`);
  }

  if (input.parentNote) {
    lines.push(input.parentNote);
  }

  if (input.homework) {
    lines.push(`과제는 ${input.homework}입니다.`);
  }

  if (input.nextPlan) {
    lines.push(`다음 수업에서는 ${input.nextPlan}을 우선 확인하겠습니다.`);
  }

  return lines.join("\n");
}

export async function createStudent(formData: FormData) {
  const { supabase, user } = await requireUser();
  const name = text(formData, "name");

  if (!name) {
    throw new Error("학생 이름은 필수입니다.");
  }

  const { data, error } = await supabase
    .from("students")
    .insert({
      user_id: user.id,
      name,
      school: nullableText(formData, "school"),
      grade: nullableText(formData, "grade"),
      student_phone: nullableText(formData, "student_phone"),
      parent_phone: nullableText(formData, "parent_phone"),
      memo: nullableText(formData, "memo"),
      status: "active",
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "학생 등록에 실패했습니다.");
  }

  revalidatePath("/protected");
  revalidatePath("/protected/students");
  redirect(`/protected/students/${data.id}`);
}

export async function updateStudent(studentId: string, formData: FormData) {
  const { supabase, user } = await requireUser();
  const name = text(formData, "name");

  if (!name) {
    throw new Error("학생 이름은 필수입니다.");
  }

  const { error } = await supabase
    .from("students")
    .update({
      name,
      school: nullableText(formData, "school"),
      grade: nullableText(formData, "grade"),
      student_phone: nullableText(formData, "student_phone"),
      parent_phone: nullableText(formData, "parent_phone"),
      memo: nullableText(formData, "memo"),
      status: statusValue(formData),
    })
    .eq("id", studentId)
    .eq("user_id", user.id);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/protected");
  revalidatePath("/protected/students");
  revalidatePath(`/protected/students/${studentId}`);
}

export async function deleteStudent(studentId: string) {
  const { supabase, user } = await requireUser();

  const { error } = await supabase
    .from("students")
    .delete()
    .eq("id", studentId)
    .eq("user_id", user.id);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/protected");
  revalidatePath("/protected/students");
  redirect("/protected/students");
}

export async function createLessonRecord(studentId: string, formData: FormData) {
  const { supabase, user } = await requireUser();

  const topic = text(formData, "topic");
  const lessonDate = text(formData, "lesson_date");
  const coveredContent = nullableText(formData, "content");
  const strengths = nullableText(formData, "strengths") ?? nullableText(formData, "performance");
  const parentNote = nullableText(formData, "parent_note");
  const internalMemo = nullableText(formData, "internal_memo");
  const homework = nullableText(formData, "homework");
  const nextPlan = nullableText(formData, "next_plan");

  if (!topic) {
    throw new Error("수업 주제는 필수입니다.");
  }

  const tags = weaknessTags(formData);
  const storedContent =
    [
      coveredContent ? `오늘 다룬 내용\n${coveredContent}` : null,
      internalMemo ? `[선생님 내부 메모]\n${internalMemo}` : null,
    ]
      .filter(Boolean)
      .join("\n\n") || null;

  const { error } = await supabase.from("lesson_records").insert({
    user_id: user.id,
    student_id: studentId,
    lesson_date: lessonDate || new Date().toISOString().slice(0, 10),
    duration_minutes: positiveInteger(formData, "duration_minutes"),
    topic,
    content: storedContent,
    performance: strengths,
    homework,
    next_plan: nextPlan,
    weakness_tags: tags,
    parent_feedback_draft: parentFeedbackDraft({
      topic,
      content: coveredContent,
      strengths,
      parentNote,
      homework,
      nextPlan,
      weaknessTags: tags,
    }),
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/protected");
  revalidatePath("/protected/students");
  revalidatePath(`/protected/students/${studentId}`);
  redirect(`/protected/students/${studentId}`);
}
