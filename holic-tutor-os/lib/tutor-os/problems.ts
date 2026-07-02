import type { ParsedExamFilename } from "@/lib/parse-exam-filename";
import type {
  ProblemCandidateBBox,
  ReviewGrade,
} from "@/lib/tutor-os/problem-candidates";

export const PROBLEM_DIFFICULTIES = ["하", "중", "중상", "상", "최상", "킬러"] as const;

export type ProblemDifficulty = (typeof PROBLEM_DIFFICULTIES)[number];

export function isProblemDifficulty(value: string): value is ProblemDifficulty {
  return (PROBLEM_DIFFICULTIES as readonly string[]).includes(value);
}

export type Problem = {
  id: string;
  user_id: string;
  source_candidate_id: string;
  source_batch_id: string | null;
  title: string;
  school: string | null;
  grade: string | null;
  year: number | null;
  semester: string | null;
  exam_name: string | null;
  subject: string | null;
  unit_scope: string | null;
  exam_sections: string[];
  file_kind: string | null;
  source_note: string | null;
  parsed_metadata: ParsedExamFilename | null;
  source_pdf_name: string | null;
  question_number: number | null;
  unit: string | null;
  problem_type: string | null;
  difficulty: string | null;
  answer: string | null;
  core_idea: string | null;
  standard_solution: string | null;
  elegant_solution: string | null;
  mistake_points: string[];
  teacher_note: string | null;
  image_storage_path: string;
  bbox: ProblemCandidateBBox | null;
  crop_version: string | null;
  review_grade: ReviewGrade | null;
  created_at: string;
  updated_at: string;
};

export type ProblemWithSignedUrl = Problem & {
  signedUrl: string | null;
};


