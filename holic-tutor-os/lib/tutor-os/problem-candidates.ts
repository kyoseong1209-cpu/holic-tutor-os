export const PROBLEM_CANDIDATE_BUCKET = "problem-candidates";

export const REVIEW_STATUSES = [
  "pending",
  "approved",
  "needs_edit",
  "rejected",
] as const;

export const REVIEW_GRADES = ["A", "B", "C"] as const;

export const REVIEW_SOURCES = [
  "rule_based",
  "local_vlm",
  "openai",
  "manual",
] as const;

export const RULE_BASED_REVIEW_VERSION = "rule_based_crop_v1";

export type ReviewStatus = (typeof REVIEW_STATUSES)[number];
export type ReviewGrade = (typeof REVIEW_GRADES)[number];
export type ReviewSource = (typeof REVIEW_SOURCES)[number];

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
  auto_review_grade: ReviewGrade | null;
  auto_review_score: number | null;
  auto_review_reason: string | null;
  manual_review_grade: ReviewGrade | null;
  final_review_grade: ReviewGrade | null;
  review_source: ReviewSource | null;
  review_version: string | null;
  review_memo: string | null;
  rejected_reason: string | null;
  reviewed_by: string | null;
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

export type CropPageBounds = Record<
  string,
  {
    width: number;
    height: number;
  }
>;

export type AutoReviewResult = {
  grade: ReviewGrade;
  score: number;
  status: ReviewStatus;
  reason: string;
  source: "rule_based";
  version: typeof RULE_BASED_REVIEW_VERSION;
};

export type AutoReviewContext = {
  duplicateQuestionNumbers?: number[];
  missingQuestionNumbers?: number[];
  pageBounds?: CropPageBounds;
  hasImage?: boolean;
};

const HARD_FAIL_NOTE_KEYWORDS = [
  "header_only",
  "empty_region",
  "multiple_question_anchors_inside",
  "multiple_question_anchors",
  "mixed_columns",
  "left_right_mixed",
  "column_mixed",
  "header_overlap",
  "failed",
  "invalid_bbox",
  "full_page",
  "page_full",
  "page_crop",
];

const NEEDS_EDIT_NOTE_KEYWORDS = [
  "large_area_candidate",
  "large_margin",
  "excessive_margin",
  "right_margin",
  "footer",
  "page_line",
  "bottom_line",
  "whitespace",
  "long_answer",
  "서답형",
];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeNote(note: string) {
  return note.toLowerCase().replace(/\s+/g, "_");
}

function hasKeyword(notes: string[], keywords: string[]) {
  const normalizedNotes = notes.map(normalizeNote);
  return keywords.some((keyword) =>
    normalizedNotes.some((note) => note.includes(normalizeNote(keyword))),
  );
}

function bboxAreaRatio(
  bbox: ProblemCandidateBBox,
  pageNumber: number,
  pageBounds?: CropPageBounds,
) {
  const bounds = pageBounds?.[String(pageNumber)];
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null;
  return (bbox.width * bbox.height) / (bounds.width * bounds.height);
}

function statusForAutoGrade(grade: ReviewGrade): ReviewStatus {
  if (grade === "A") return "approved";
  if (grade === "B") return "needs_edit";
  return "rejected";
}

export function buildCropPageBounds(
  candidates: Pick<CropCoordinatesCandidate, "page_number" | "bbox">[],
): CropPageBounds {
  return candidates.reduce<CropPageBounds>((bounds, candidate) => {
    const key = String(candidate.page_number);
    const current = bounds[key] ?? { width: 0, height: 0 };
    const width = Math.max(current.width, candidate.bbox.x + candidate.bbox.width);
    const height = Math.max(current.height, candidate.bbox.y + candidate.bbox.height);

    bounds[key] = { width, height };
    return bounds;
  }, {});
}

export function autoReviewCropCandidate(
  candidate: CropCoordinatesCandidate,
  context: AutoReviewContext = {},
): AutoReviewResult {
  const reasons: string[] = [];
  const bbox = candidate.bbox;
  const confidence = candidate.confidence;
  const notes = candidate.notes ?? [];
  const areaRatio = bboxAreaRatio(bbox, candidate.page_number, context.pageBounds);
  const duplicateNumbers = new Set(context.duplicateQuestionNumbers ?? []);
  let grade: ReviewGrade = "A";
  let score = confidence ?? 0.82;

  if (context.hasImage === false) {
    grade = "C";
    score -= 0.45;
    reasons.push("crop 이미지가 없습니다");
  }

  if (!Number.isFinite(bbox.x) || !Number.isFinite(bbox.y) || bbox.width <= 0 || bbox.height <= 0) {
    grade = "C";
    score -= 0.45;
    reasons.push("bbox 값이 비정상입니다");
  }

  if (!candidate.question_number_guess) {
    grade = "C";
    score -= 0.35;
    reasons.push("문항 번호 추정값이 없습니다");
  }

  if (
    candidate.question_number_guess &&
    duplicateNumbers.has(candidate.question_number_guess)
  ) {
    grade = "C";
    score -= 0.35;
    reasons.push(`${candidate.question_number_guess}번 중복 의심`);
  }

  if (hasKeyword(notes, HARD_FAIL_NOTE_KEYWORDS)) {
    grade = "C";
    score -= 0.4;
    reasons.push("header/빈 영역/복수 문항/column 혼합 같은 실패 신호가 있습니다");
  }

  if (areaRatio !== null) {
    if (areaRatio >= 0.6) {
      grade = "C";
      score -= 0.35;
      reasons.push("crop 면적이 페이지 전체에 가깝습니다");
    } else if (areaRatio >= 0.38 && grade !== "C") {
      grade = "B";
      score -= 0.12;
      reasons.push("crop 면적이 커서 여백 확인이 필요합니다");
    } else if (areaRatio <= 0.0015) {
      grade = "C";
      score -= 0.35;
      reasons.push("crop 면적이 지나치게 작습니다");
    } else if (areaRatio <= 0.006 && grade !== "C") {
      grade = "B";
      score -= 0.08;
      reasons.push("crop 면적이 작아 문항 잘림 여부 확인이 필요합니다");
    }
  }

  if (typeof confidence === "number") {
    if (confidence < 0.45) {
      grade = "C";
      score -= 0.3;
      reasons.push("confidence가 낮습니다");
    } else if (confidence < 0.9 && grade !== "C") {
      grade = "B";
      score -= 0.1;
      reasons.push("confidence가 자동 승인 기준보다 낮습니다");
    }
  } else if (grade !== "C") {
    grade = "B";
    score -= 0.08;
    reasons.push("confidence 값이 없습니다");
  }

  if (hasKeyword(notes, NEEDS_EDIT_NOTE_KEYWORDS) && grade !== "C") {
    grade = "B";
    score -= 0.1;
    reasons.push("여백/하단선/긴 서답형 등 사람이 확인하면 좋은 신호가 있습니다");
  }

  if (reasons.length === 0) {
    reasons.push("문항 번호, confidence, notes, bbox가 자동 승인 기준을 만족합니다");
  }

  const normalizedScore = clamp(Number(score.toFixed(2)), 0, 1);

  return {
    grade,
    score: normalizedScore,
    status: statusForAutoGrade(grade),
    reason: reasons.join("; "),
    source: "rule_based",
    version: RULE_BASED_REVIEW_VERSION,
  };
}

export function statusForFinalGrade(grade: ReviewGrade | null): ReviewStatus {
  if (grade === "A") return "approved";
  if (grade === "B") return "needs_edit";
  if (grade === "C") return "rejected";
  return "pending";
}

export function effectiveReviewGrade(
  candidate: Pick<
    ProblemCandidate,
    "final_review_grade" | "manual_review_grade" | "review_grade" | "auto_review_grade"
  >,
) {
  return (
    candidate.final_review_grade ??
    candidate.manual_review_grade ??
    candidate.review_grade ??
    candidate.auto_review_grade ??
    null
  );
}

export function canPromoteCandidate(
  candidate: Pick<ProblemCandidate, "review_status" | "final_review_grade">,
) {
  if (candidate.review_status === "needs_edit" || candidate.review_status === "rejected") {
    return false;
  }

  return candidate.review_status === "approved" || candidate.final_review_grade === "A";
}

export function reviewStatusLabel(status: ReviewStatus) {
  if (status === "approved") return "승인";
  if (status === "needs_edit") return "검수 필요";
  if (status === "rejected") return "반려 의심";
  return "대기";
}

export function reviewGradeLabel(grade: ReviewGrade | null | undefined) {
  return grade ?? "미평가";
}

export function reviewSourceLabel(source: ReviewSource | null | undefined) {
  if (source === "rule_based") return "규칙 기반";
  if (source === "local_vlm") return "로컬 VLM";
  if (source === "openai") return "OpenAI";
  if (source === "manual") return "수동";
  return "미지정";
}

export function isReviewStatus(value: string): value is ReviewStatus {
  return REVIEW_STATUSES.includes(value as ReviewStatus);
}

export function isReviewGrade(value: string): value is ReviewGrade {
  return REVIEW_GRADES.includes(value as ReviewGrade);
}

export function isReviewSource(value: string): value is ReviewSource {
  return REVIEW_SOURCES.includes(value as ReviewSource);
}
