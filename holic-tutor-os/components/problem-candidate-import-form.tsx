"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FileJson, ImageUp, UploadCloud } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import {
  metadataConfidenceLabel,
  parseExamFilename,
  type ParsedExamFilename,
} from "@/lib/parse-exam-filename";
import {
  PROBLEM_CANDIDATE_BUCKET,
  autoReviewCropCandidate,
  buildCropPageBounds,
  type CropCoordinatesCandidate,
  type CropCoordinatesFile,
  type ProblemCandidateBBox,
} from "@/lib/tutor-os/problem-candidates";

type Message = {
  type: "success" | "error";
  text: string;
};

type MetadataFormState = {
  school: string;
  grade: string;
  year: string;
  semester: string;
  exam_name: string;
  subject: string;
  unit_scope: string;
  exam_sections: string;
  file_kind: string;
  source_note: string;
};

const EMPTY_METADATA: MetadataFormState = {
  school: "",
  grade: "",
  year: "",
  semester: "",
  exam_name: "",
  subject: "",
  unit_scope: "",
  exam_sections: "",
  file_kind: "",
  source_note: "",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function numberArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is number => typeof item === "number" && Number.isFinite(item))
    : [];
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function parseBBox(value: unknown): ProblemCandidateBBox | null {
  if (!isRecord(value)) return null;
  const x = numberOrNull(value.x);
  const y = numberOrNull(value.y);
  const width = numberOrNull(value.width);
  const height = numberOrNull(value.height);

  if (x === null || y === null || width === null || height === null) {
    return null;
  }

  return { x, y, width, height };
}

function parseCandidate(value: unknown): CropCoordinatesCandidate | null {
  if (!isRecord(value)) return null;
  if (typeof value.candidate_id !== "string") return null;

  const pageNumber = numberOrNull(value.page_number);
  const bbox = parseBBox(value.bbox);
  if (pageNumber === null || !bbox) return null;

  const notes = Array.isArray(value.notes)
    ? value.notes.filter((note): note is string => typeof note === "string")
    : [];

  return {
    candidate_id: value.candidate_id,
    page_number: pageNumber,
    question_number_guess: numberOrNull(value.question_number_guess),
    bbox,
    confidence: numberOrNull(value.confidence),
    notes,
    status: typeof value.status === "string" ? value.status : undefined,
    output_path: typeof value.output_path === "string" ? value.output_path : undefined,
  };
}

function parsedMetadataFromJson(value: unknown): ParsedExamFilename | null {
  if (!isRecord(value)) return null;

  return {
    school: typeof value.school === "string" ? value.school : null,
    grade: typeof value.grade === "string" ? value.grade : null,
    year: numberOrNull(value.year),
    semester: typeof value.semester === "string" ? value.semester : null,
    exam_name: typeof value.exam_name === "string" ? value.exam_name : null,
    subject: typeof value.subject === "string" ? value.subject : null,
    unit_scope: typeof value.unit_scope === "string" ? value.unit_scope : null,
    exam_sections: stringArray(value.exam_sections),
    file_kind: typeof value.file_kind === "string" ? value.file_kind : null,
    confidence: numberOrNull(value.confidence) ?? 0,
    warnings: stringArray(value.warnings),
  };
}

function parseCoordinatesJson(raw: string): CropCoordinatesFile {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed) || !Array.isArray(parsed.candidates)) {
    throw new Error("crop_coordinates.json 형식이 올바르지 않습니다.");
  }

  const candidates = parsed.candidates
    .map(parseCandidate)
    .filter((candidate): candidate is CropCoordinatesCandidate => candidate !== null);

  if (candidates.length === 0) {
    throw new Error("가져올 crop 후보가 없습니다.");
  }

  return {
    input_pdf: typeof parsed.input_pdf === "string" ? parsed.input_pdf : undefined,
    source_pdf_name: typeof parsed.source_pdf_name === "string" ? parsed.source_pdf_name : undefined,
    parsed_metadata: parsedMetadataFromJson(parsed.parsed_metadata),
    crop_version: typeof parsed.crop_version === "string" ? parsed.crop_version : undefined,
    expected_count: numberOrNull(parsed.expected_count),
    detected_anchor_count: numberOrNull(parsed.detected_anchor_count),
    generated_crop_count: numberOrNull(parsed.generated_crop_count),
    missing_question_numbers_guess: numberArray(parsed.missing_question_numbers_guess),
    duplicate_question_numbers: numberArray(parsed.duplicate_question_numbers),
    candidates,
  };
}

function fileStem(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "");
}

function basename(path: string | undefined) {
  if (!path) return "";
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? "";
}

function sourcePdfNameFromCoordinates(coordinates: CropCoordinatesFile) {
  return coordinates.source_pdf_name || basename(coordinates.input_pdf) || "";
}

function metadataToForm(metadata: ParsedExamFilename): MetadataFormState {
  return {
    school: metadata.school ?? "",
    grade: metadata.grade ?? "",
    year: metadata.year ? String(metadata.year) : "",
    semester: metadata.semester ?? "",
    exam_name: metadata.exam_name ?? "",
    subject: metadata.subject ?? "",
    unit_scope: metadata.unit_scope ?? "",
    exam_sections: metadata.exam_sections.join(","),
    file_kind: metadata.file_kind ?? "",
    source_note: "",
  };
}

function splitSections(value: string) {
  return value
    .split(/[,，\/\r\n]+/)
    .map((section) => section.trim())
    .filter(Boolean);
}

function yearNumber(value: string) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function metadataPayload(
  sourcePdfName: string,
  metadata: MetadataFormState,
  confidence: number | null,
  warnings: string[],
): ParsedExamFilename {
  const reparsed = parseExamFilename(sourcePdfName);

  return {
    school: metadata.school.trim() || null,
    grade: metadata.grade.trim() || null,
    year: yearNumber(metadata.year),
    semester: metadata.semester.trim() || null,
    exam_name: metadata.exam_name.trim() || null,
    subject: metadata.subject.trim() || null,
    unit_scope: metadata.unit_scope.trim() || null,
    exam_sections: splitSections(metadata.exam_sections),
    file_kind: metadata.file_kind.trim() || null,
    confidence: confidence ?? reparsed.confidence,
    warnings,
  };
}

type SupabaseLikeError = {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
  status?: number;
  statusCode?: number | string;
  name?: string;
};

function formatStepError(step: string, error: unknown) {
  const supabaseError = error as SupabaseLikeError;
  const parts = [
    `${step} 실패`,
    supabaseError.message,
    supabaseError.code ? `code=${supabaseError.code}` : null,
    supabaseError.details ? `details=${supabaseError.details}` : null,
    supabaseError.hint ? `hint=${supabaseError.hint}` : null,
    supabaseError.status ? `status=${supabaseError.status}` : null,
    supabaseError.statusCode ? `statusCode=${supabaseError.statusCode}` : null,
    supabaseError.name ? `name=${supabaseError.name}` : null,
  ].filter(Boolean);

  return parts.join(" / ");
}

function throwStepError(step: string, error: unknown): never {
  console.error(step, error);
  throw new Error(formatStepError(step, error));
}

function autoReviewNotice(input: {
  approved: number;
  needsEdit: number;
  rejected: number;
  missing: number;
  duplicate: number;
}) {
  return [
    `자동 승인 ${input.approved}개`,
    `검수 필요 ${input.needsEdit}개`,
    `반려 의심 ${input.rejected}개`,
    `누락 의심 ${input.missing}개`,
    `중복 의심 ${input.duplicate}개`,
  ].join(" · ");
}

export function ProblemCandidateImportForm() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [coordinatesFile, setCoordinatesFile] = useState<File | null>(null);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [sourcePdfName, setSourcePdfName] = useState("");
  const [cropVersion, setCropVersion] = useState("v4");
  const [expectedCount, setExpectedCount] = useState("22");
  const [metadata, setMetadata] = useState<MetadataFormState>(EMPTY_METADATA);
  const [metadataConfidence, setMetadataConfidence] = useState<number | null>(null);
  const [metadataWarnings, setMetadataWarnings] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  async function handleCoordinatesChange(file: File | null) {
    setCoordinatesFile(file);
    setMessage(null);
    if (!file) return;

    try {
      const coordinates = parseCoordinatesJson(await file.text());
      const detectedSourcePdfName =
        sourcePdfNameFromCoordinates(coordinates) || sourcePdfName.trim() || "unknown.pdf";
      const parsedMetadata = coordinates.parsed_metadata ?? parseExamFilename(detectedSourcePdfName);

      setSourcePdfName(detectedSourcePdfName);
      setCropVersion((current) => coordinates.crop_version || current || "v4");
      setExpectedCount((current) =>
        coordinates.expected_count ? String(coordinates.expected_count) : current,
      );
      setMetadata(metadataToForm(parsedMetadata));
      setMetadataConfidence(parsedMetadata.confidence);
      setMetadataWarnings(parsedMetadata.warnings);
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "crop_coordinates.json을 읽지 못했습니다.",
      });
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);

    if (!coordinatesFile) {
      setMessage({ type: "error", text: "crop_coordinates.json을 선택해 주세요." });
      return;
    }
    if (imageFiles.length === 0) {
      setMessage({ type: "error", text: "q_001.png 같은 crop 이미지를 선택해 주세요." });
      return;
    }

    setIsUploading(true);

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        throwStepError("[0/5 auth.getUser]", userError ?? new Error("로그인이 필요합니다."));
      }

      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !sessionData.session?.access_token) {
        throwStepError(
          "[0/5 auth.getSession]",
          sessionError ?? new Error("브라우저 Supabase 세션이 없습니다. 로그아웃 후 다시 로그인해 주세요."),
        );
      }

      const coordinates = parseCoordinatesJson(await coordinatesFile.text());
      const finalSourcePdfName =
        sourcePdfName.trim() || sourcePdfNameFromCoordinates(coordinates) || "unknown.pdf";
      const finalCropVersion = cropVersion.trim() || coordinates.crop_version || "v4";
      const parsedExpectedCount = Number.parseInt(expectedCount, 10);
      const finalExpectedCount = Number.isFinite(parsedExpectedCount)
        ? parsedExpectedCount
        : coordinates.expected_count;
      const finalMetadata = metadataPayload(
        finalSourcePdfName,
        metadata,
        metadataConfidence,
        metadataWarnings,
      );

      const imagesByStem = new Map(imageFiles.map((file) => [fileStem(file.name), file]));
      const missingImages = coordinates.candidates
        .filter((candidate) => !imagesByStem.has(candidate.candidate_id))
        .map((candidate) => candidate.candidate_id);

      if (missingImages.length > 0) {
        throw new Error(`이미지가 없는 후보가 있습니다: ${missingImages.join(", ")}`);
      }

      const outputRunId = new Date().toISOString().replace(/[:.]/g, "-");
      const { data: batch, error: batchError } = await supabase
        .from("crop_import_batches")
        .insert({
          source_pdf_name: finalSourcePdfName,
          school: finalMetadata.school,
          grade: finalMetadata.grade,
          year: finalMetadata.year,
          semester: finalMetadata.semester,
          exam_name: finalMetadata.exam_name,
          subject: finalMetadata.subject,
          unit_scope: finalMetadata.unit_scope,
          exam_sections: finalMetadata.exam_sections,
          file_kind: finalMetadata.file_kind,
          source_note: metadata.source_note.trim() || null,
          parsed_metadata: finalMetadata,
          crop_version: finalCropVersion,
          output_run_id: outputRunId,
          expected_count: finalExpectedCount,
          detected_anchor_count: coordinates.detected_anchor_count,
          generated_crop_count: coordinates.generated_crop_count ?? coordinates.candidates.length,
          missing_question_numbers: coordinates.missing_question_numbers_guess ?? [],
          duplicate_question_numbers: coordinates.duplicate_question_numbers ?? [],
        })
        .select("id,user_id")
        .single();

      if (batchError || !batch) {
        throwStepError(
          "[1/5 crop_import_batches insert]",
          batchError ?? new Error("가져오기 묶음을 만들지 못했습니다."),
        );
      }

      const basePath = `${user.id}/${batch.id}`;
      const coordinatesPath = `${basePath}/crop_coordinates.json`;
      const { error: coordinatesUploadError } = await supabase.storage
        .from(PROBLEM_CANDIDATE_BUCKET)
        .upload(coordinatesPath, coordinatesFile, {
          contentType: "application/json",
          upsert: false,
        });

      if (coordinatesUploadError) {
        throwStepError(`[2/5 storage.objects upload crop_coordinates.json path=${coordinatesPath}]`, coordinatesUploadError);
      }

      const pageBounds = buildCropPageBounds(coordinates.candidates);
      const autoCounts = {
        approved: 0,
        needsEdit: 0,
        rejected: 0,
      };
      const candidateRows = [];
      const reviewedAt = new Date().toISOString();

      for (const candidate of coordinates.candidates) {
        const imageFile = imagesByStem.get(candidate.candidate_id);
        if (!imageFile) continue;

        const imagePath = `${basePath}/crops/${imageFile.name}`;
        const { error: imageUploadError } = await supabase.storage
          .from(PROBLEM_CANDIDATE_BUCKET)
          .upload(imagePath, imageFile, {
            contentType: imageFile.type || "image/png",
            upsert: false,
          });

        if (imageUploadError) {
          throwStepError(
            `[3/5 storage.objects upload ${candidate.candidate_id} path=${imagePath}]`,
            imageUploadError,
          );
        }

        const autoReview = autoReviewCropCandidate(candidate, {
          duplicateQuestionNumbers: coordinates.duplicate_question_numbers ?? [],
          missingQuestionNumbers: coordinates.missing_question_numbers_guess ?? [],
          pageBounds,
          hasImage: true,
        });

        if (autoReview.grade === "A") autoCounts.approved += 1;
        if (autoReview.grade === "B") autoCounts.needsEdit += 1;
        if (autoReview.grade === "C") autoCounts.rejected += 1;

        candidateRows.push({
          batch_id: batch.id,
          candidate_id: candidate.candidate_id,
          question_number_guess: candidate.question_number_guess,
          page_number: candidate.page_number,
          image_path: imagePath,
          source_pdf_name: finalSourcePdfName,
          crop_version: finalCropVersion,
          bbox: candidate.bbox,
          confidence: candidate.confidence,
          notes: candidate.notes,
          review_status: autoReview.status,
          auto_review_grade: autoReview.grade,
          auto_review_score: autoReview.score,
          auto_review_reason: autoReview.reason,
          manual_review_grade: null,
          final_review_grade: autoReview.grade,
          review_source: autoReview.source,
          review_version: autoReview.version,
          reviewed_at: reviewedAt,
          approved_at: autoReview.status === "approved" ? reviewedAt : null,
        });
      }

      const { error: candidatesError } = await supabase
        .from("problem_candidates")
        .insert(candidateRows);

      if (candidatesError) {
        throwStepError("[4/5 problem_candidates bulk insert]", candidatesError);
      }

      const { error: batchUpdateError } = await supabase
        .from("crop_import_batches")
        .update({ coordinates_path: coordinatesPath })
        .eq("id", batch.id)
        .eq("user_id", user.id);

      if (batchUpdateError) {
        throwStepError("[5/5 crop_import_batches update coordinates_path]", batchUpdateError);
      }

      const notice = autoReviewNotice({
        ...autoCounts,
        missing: coordinates.missing_question_numbers_guess?.length ?? 0,
        duplicate: coordinates.duplicate_question_numbers?.length ?? 0,
      });

      setMessage({ type: "success", text: `문항 후보를 가져왔습니다. ${notice}` });
      const params = new URLSearchParams({
        batch: batch.id,
        filter: "needs_review",
        notice,
        noticeType: "success",
      });
      router.push(`/protected/problem-candidates?${params.toString()}`);
      router.refresh();
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "업로드에 실패했습니다.",
      });
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <Card className="rounded-lg">
      <CardHeader>
        <CardTitle>crop 결과 가져오기</CardTitle>
        <CardDescription>
          파일명에서 시험지 공통 정보를 자동 추출하고, 업로드 즉시 규칙 기반 자동 검수를 실행합니다.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-5" onSubmit={handleSubmit}>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2 md:col-span-2">
              <Label htmlFor="source_pdf_name">원본 PDF 이름</Label>
              <Input
                id="source_pdf_name"
                value={sourcePdfName}
                onChange={(event) => setSourcePdfName(event.target.value)}
                placeholder="예: 숭문고등학교_1학년_2026_1학기중간_공통수학1_선택,공통_문제.pdf"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="crop_version">crop 버전</Label>
              <Input
                id="crop_version"
                value={cropVersion}
                onChange={(event) => setCropVersion(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="expected_count">예상 문항 수</Label>
              <Input
                id="expected_count"
                inputMode="numeric"
                value={expectedCount}
                onChange={(event) => setExpectedCount(event.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2 rounded-lg border p-4">
              <Label className="flex items-center gap-2" htmlFor="coordinates">
                <FileJson className="size-4" />
                crop_coordinates.json
              </Label>
              <Input
                id="coordinates"
                accept="application/json,.json"
                type="file"
                onChange={(event) => void handleCoordinatesChange(event.target.files?.[0] ?? null)}
              />
              {coordinatesFile ? (
                <p className="text-sm text-muted-foreground">{coordinatesFile.name}</p>
              ) : null}
            </div>
            <div className="grid gap-2 rounded-lg border p-4">
              <Label className="flex items-center gap-2" htmlFor="crop_images">
                <ImageUp className="size-4" />
                crop 이미지
              </Label>
              <Input
                id="crop_images"
                accept="image/png"
                multiple
                type="file"
                onChange={(event) => setImageFiles(Array.from(event.target.files ?? []))}
              />
              <p className="text-sm text-muted-foreground">{imageFiles.length}개 선택됨</p>
            </div>
          </div>

          <Card className="rounded-lg border-dashed">
            <CardHeader>
              <CardTitle className="text-base">파일명 자동 추출 정보</CardTitle>
              <CardDescription>
                confidence {metadataConfidence ?? "-"}
                {metadataConfidence !== null ? ` (${metadataConfidenceLabel(metadataConfidence)})` : ""}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <MetadataInput label="학교" name="school" value={metadata.school} onChange={(value) => setMetadata((current) => ({ ...current, school: value }))} />
              <MetadataInput label="학년" name="grade" value={metadata.grade} onChange={(value) => setMetadata((current) => ({ ...current, grade: value }))} />
              <MetadataInput label="연도" name="year" value={metadata.year} onChange={(value) => setMetadata((current) => ({ ...current, year: value }))} />
              <MetadataInput label="학기" name="semester" value={metadata.semester} onChange={(value) => setMetadata((current) => ({ ...current, semester: value }))} />
              <MetadataInput label="시험명" name="exam_name" value={metadata.exam_name} onChange={(value) => setMetadata((current) => ({ ...current, exam_name: value }))} />
              <MetadataInput label="과목" name="subject" value={metadata.subject} onChange={(value) => setMetadata((current) => ({ ...current, subject: value }))} />
              <MetadataInput label="단원 범위" name="unit_scope" value={metadata.unit_scope} onChange={(value) => setMetadata((current) => ({ ...current, unit_scope: value }))} />
              <MetadataInput label="문제 범위/구성" name="exam_sections" value={metadata.exam_sections} onChange={(value) => setMetadata((current) => ({ ...current, exam_sections: value }))} />
              <MetadataInput label="파일 종류" name="file_kind" value={metadata.file_kind} onChange={(value) => setMetadata((current) => ({ ...current, file_kind: value }))} />
              <div className="grid gap-2 md:col-span-2">
                <Label htmlFor="source_note">출처 메모</Label>
                <Textarea
                  id="source_note"
                  value={metadata.source_note}
                  onChange={(event) => setMetadata((current) => ({ ...current, source_note: event.target.value }))}
                  placeholder="예: 파일명 자동 추출 후 직접 확인 완료"
                />
              </div>
              {metadataWarnings.length > 0 ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100 md:col-span-2">
                  <p className="font-medium">확인 필요</p>
                  <ul className="mt-2 list-inside list-disc">
                    {metadataWarnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </div>
              ) : metadataConfidence !== null ? (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200 md:col-span-2">
                  자동 추출 완료
                </div>
              ) : null}
            </CardContent>
          </Card>

          {message ? (
            <div
              className={
                message.type === "success"
                  ? "rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
                  : "rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
              }
            >
              {message.text}
            </div>
          ) : null}

          <div>
            <Button disabled={isUploading} type="submit">
              <UploadCloud />
              {isUploading ? "업로드 중..." : "업로드 및 자동 검수"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function MetadataInput({
  label,
  name,
  value,
  onChange,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}
