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
import { createClient } from "@/lib/supabase/client";
import {
  PROBLEM_CANDIDATE_BUCKET,
  type CropCoordinatesCandidate,
  type CropCoordinatesFile,
  type ProblemCandidateBBox,
} from "@/lib/tutor-os/problem-candidates";

type Message = {
  type: "success" | "error";
  text: string;
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
  return basename(coordinates.input_pdf) || "";
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

export function ProblemCandidateImportForm() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [coordinatesFile, setCoordinatesFile] = useState<File | null>(null);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [sourcePdfName, setSourcePdfName] = useState("");
  const [cropVersion, setCropVersion] = useState("v4");
  const [expectedCount, setExpectedCount] = useState("22");
  const [isUploading, setIsUploading] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

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

      const candidateRows = [];
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
          review_status: "pending",
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

      setMessage({ type: "success", text: "문항 후보를 가져왔습니다." });
      router.push(`/protected/problem-candidates?batch=${batch.id}`);
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
          브라우저 파일 선택으로 crop_coordinates.json과 q_001.png 형식의 이미지를 업로드합니다.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-5" onSubmit={handleSubmit}>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="source_pdf_name">원본 PDF 이름</Label>
              <Input
                id="source_pdf_name"
                value={sourcePdfName}
                onChange={(event) => setSourcePdfName(event.target.value)}
                placeholder="예: 홍익여고_1학년_1학기.pdf"
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
                onChange={(event) => setCoordinatesFile(event.target.files?.[0] ?? null)}
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
              {isUploading ? "업로드 중..." : "업로드"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
