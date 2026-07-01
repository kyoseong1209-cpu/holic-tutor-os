export type StudentStatus = "active" | "paused" | "archived";

export type Student = {
  id: string;
  user_id: string;
  name: string;
  school: string | null;
  grade: string | null;
  student_phone: string | null;
  parent_phone: string | null;
  memo: string | null;
  status: StudentStatus;
  created_at: string;
  updated_at: string;
};

export type LessonRecord = {
  id: string;
  user_id: string;
  student_id: string;
  lesson_date: string;
  duration_minutes: number | null;
  topic: string;
  content: string | null;
  performance: string | null;
  homework: string | null;
  next_plan: string | null;
  weakness_tags: string[];
  parent_feedback_draft: string | null;
  created_at: string;
};

export type WeaknessCount = {
  tag: string;
  count: number;
};
