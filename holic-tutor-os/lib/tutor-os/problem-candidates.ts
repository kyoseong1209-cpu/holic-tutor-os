export const PROBLEM_CANDIDATE_BUCKET = "problem-candidates";

export const REVIEW_STATUSES = [
  "pending",
  "approved",
  "needs_edit",
  "rejected",
] as const;

export const REVIEW_GRADES = ["A", "B", "C"] as const;

export type ReviewStatus = (typeof REVIEW_STATUSES)[number];
export type ReviewGrade = (typeof REVIEW_GRADES)[number];

export type ProblemCandidateBBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CropImportBatch = {
  id: string;
  user_id: string;
  source_pdf_name: string | null;
  crop_version: string;
  output_run_id: string | null;
  expected_count: number | null;
  detected_anchor_count: number | null;
  generated_crop_count: number | null;
  missing_question_numbers: number[];
  duplicate_question_numbers: number[];
  coordinates_path: string | null;
  contact_sheet_path: string | null;
  summary_path: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type ProblemCandidate = {
  id: string;
  user_id: string;
  batch_id: string;
  candidate_id: string;
  question_number_guess: number | null;
  page_number: number;
  image_path: string;
  source_pdf_name: string | null;
  crop_version: string;
  bbox: ProblemCandidateBBox;
  confidence: number | null;
  notes: string[];
  review_status: ReviewStatus;
  review_grade: ReviewGrade | null;
  review_memo: string | null;
  rejected_reason: string | null;
  reviewed_at: string | null;
  approved_at: string | null;
  promoted_at: string | null;
  promoted_problem_id: string | null;
  created_at: string;
  updated_at: string;
};

export type CandidateWithSignedUrl = ProblemCandidate & {
  signedUrl: string | null;
};

export type CropCoordinatesCandidate = {
  candidate_id: string;
  page_number: number;
  question_number_guess: number | null;
  bbox: ProblemCandidateBBox;
  confidence: number | null;
  notes: string[];
  status?: string;
  output_path?: string;
};

export type CropCoordinatesFile = {
  input_pdf?: string;
  crop_version?: string;
  expected_count?: number | null;
  detected_anchor_count?: number | null;
  generated_crop_count?: number | null;
  missing_question_numbers_guess?: number[];
  duplicate_question_numbers?: number[];
  candidates: CropCoordinatesCandidate[];
};

export function reviewStatusLabel(status: ReviewStatus) {
  if (status === "approved") return "승인";
  if (status === "needs_edit") return "보류";
  if (status === "rejected") return "반려";
  return "대기";
}

export function reviewGradeLabel(grade: ReviewGrade | null) {
  return grade ?? "미평가";
}

export function isReviewStatus(value: string): value is ReviewStatus {
  return REVIEW_STATUSES.includes(value as ReviewStatus);
}

export function isReviewGrade(value: string): value is ReviewGrade {
  return REVIEW_GRADES.includes(value as ReviewGrade);
}
