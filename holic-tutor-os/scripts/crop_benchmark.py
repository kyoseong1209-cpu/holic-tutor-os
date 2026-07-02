from __future__ import annotations

import argparse
import json
from collections import Counter
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Iterable

import cv2
import fitz
import numpy as np
from PIL import Image


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = PROJECT_ROOT / "crop_inputs" / "sample.pdf"
DEFAULT_OUTPUT_ROOT = PROJECT_ROOT / "crop_outputs"


@dataclass
class PageImage:
    page_number: int
    path: Path
    width: int
    height: int


@dataclass
class Candidate:
    candidate_id: str
    page_number: int
    question_number_guess: None
    bbox: dict[str, int]
    confidence: float
    notes: list[str]
    crop_path: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Render a math exam PDF at 300dpi and create conservative question "
            "crop candidates for manual A/B/C quality review."
        )
    )
    parser.add_argument(
        "--input",
        type=Path,
        default=DEFAULT_INPUT,
        help=f"Input PDF path. Default: {DEFAULT_INPUT}",
    )
    parser.add_argument(
        "--output-root",
        type=Path,
        default=DEFAULT_OUTPUT_ROOT,
        help=f"Root folder for timestamped outputs. Default: {DEFAULT_OUTPUT_ROOT}",
    )
    parser.add_argument(
        "--dpi",
        type=int,
        default=300,
        help="PDF render DPI. Default: 300",
    )
    parser.add_argument(
        "--min-confidence-risk",
        type=float,
        default=0.45,
        help="Candidates below this confidence are listed as high-risk. Default: 0.45",
    )
    return parser.parse_args()


def make_run_dir(output_root: Path) -> Path:
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    run_dir = output_root / timestamp
    suffix = 1
    while run_dir.exists():
        run_dir = output_root / f"{timestamp}_{suffix:02d}"
        suffix += 1

    (run_dir / "pages").mkdir(parents=True, exist_ok=True)
    (run_dir / "crops").mkdir(parents=True, exist_ok=True)
    return run_dir


def render_pdf(input_pdf: Path, pages_dir: Path, dpi: int) -> list[PageImage]:
    zoom = dpi / 72
    matrix = fitz.Matrix(zoom, zoom)
    pages: list[PageImage] = []

    with fitz.open(input_pdf) as document:
        for page_index, page in enumerate(document, start=1):
            pixmap = page.get_pixmap(matrix=matrix, colorspace=fitz.csRGB, alpha=False)
            page_path = pages_dir / f"page_{page_index:03d}.png"
            pixmap.save(page_path)
            pages.append(
                PageImage(
                    page_number=page_index,
                    path=page_path,
                    width=pixmap.width,
                    height=pixmap.height,
                )
            )

    return pages


def imread(path: Path) -> np.ndarray:
    data = np.fromfile(str(path), dtype=np.uint8)
    image = cv2.imdecode(data, cv2.IMREAD_COLOR)
    if image is None:
        raise RuntimeError(f"Failed to read image: {path}")
    return image


def imwrite(path: Path, image_bgr: np.ndarray) -> None:
    image_rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
    Image.fromarray(image_rgb).save(path)


def clamp(value: int, low: int, high: int) -> int:
    return max(low, min(value, high))


def rolling_mean(values: np.ndarray, window: int) -> np.ndarray:
    window = max(1, int(window))
    if window <= 1:
        return values.astype(np.float32)

    kernel = np.ones(window, dtype=np.float32) / window
    return np.convolve(values.astype(np.float32), kernel, mode="same")


def ranges_from_bool(flags: np.ndarray) -> list[tuple[int, int]]:
    ranges: list[tuple[int, int]] = []
    start: int | None = None

    for index, flag in enumerate(flags):
        if flag and start is None:
            start = index
        elif not flag and start is not None:
            ranges.append((start, index))
            start = None

    if start is not None:
        ranges.append((start, len(flags)))

    return ranges


def build_ink_mask(image_bgr: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (3, 3), 0)
    _, mask = cv2.threshold(blurred, 245, 255, cv2.THRESH_BINARY_INV)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    return mask


def content_bbox(mask: np.ndarray) -> tuple[int, int, int, int]:
    height, width = mask.shape
    row_threshold = max(8, int(width * 0.002))
    col_threshold = max(8, int(height * 0.002))
    rows = np.where((mask > 0).sum(axis=1) > row_threshold)[0]
    cols = np.where((mask > 0).sum(axis=0) > col_threshold)[0]

    if len(rows) == 0 or len(cols) == 0:
        return (0, 0, width, height)

    pad = max(25, int(min(width, height) * 0.01))
    x1 = clamp(int(cols[0]) - pad, 0, width - 1)
    x2 = clamp(int(cols[-1]) + pad, x1 + 1, width)
    y1 = clamp(int(rows[0]) - pad, 0, height - 1)
    y2 = clamp(int(rows[-1]) + pad, y1 + 1, height)
    return (x1, y1, x2 - x1, y2 - y1)


def detect_columns(mask: np.ndarray, bbox: tuple[int, int, int, int]) -> list[tuple[int, int, int, int, list[str]]]:
    page_height, page_width = mask.shape
    x, y, width, height = bbox
    notes = ["single_column_projection"]

    body_y1 = y + int(height * 0.08)
    body_y2 = y + int(height * 0.96)
    body = mask[body_y1:body_y2, x : x + width]
    if body.size == 0:
        return [(x, y, width, height, notes)]

    projection = (body > 0).sum(axis=0)
    smooth = rolling_mean(projection, max(25, width // 90))
    low_threshold = max(4, float(np.percentile(smooth, 12)))
    low_runs = ranges_from_bool(smooth <= low_threshold)

    center_min = int(width * 0.38)
    center_max = int(width * 0.62)
    min_gutter_width = max(35, int(page_width * 0.025))
    gutter: tuple[int, int] | None = None

    for run_start, run_end in low_runs:
        run_width = run_end - run_start
        run_center = (run_start + run_end) // 2
        if run_width >= min_gutter_width and center_min <= run_center <= center_max:
            gutter = (run_start, run_end)
            break

    if not gutter:
        return [(x, y, width, height, notes)]

    gutter_start, gutter_end = gutter
    left_width = gutter_start
    right_width = width - gutter_end
    if left_width < width * 0.25 or right_width < width * 0.25:
        return [(x, y, width, height, notes + ["rejected_narrow_column_split"])]

    gutter_pad = max(8, int(page_width * 0.004))
    return [
        (x, y, max(1, left_width - gutter_pad), height, ["two_column_left"]),
        (
            x + gutter_end + gutter_pad,
            y,
            max(1, width - gutter_end - gutter_pad),
            height,
            ["two_column_right"],
        ),
    ]


def merge_short_segments(
    segments: list[tuple[int, int]],
    min_height: int,
) -> list[tuple[int, int]]:
    if not segments:
        return []

    merged: list[tuple[int, int]] = []
    for start, end in segments:
        if merged and end - start < min_height:
            previous_start, _ = merged[-1]
            merged[-1] = (previous_start, end)
        else:
            merged.append((start, end))

    if len(merged) > 1 and merged[0][1] - merged[0][0] < min_height:
        first_start, _ = merged.pop(0)
        second_start, second_end = merged.pop(0)
        merged.insert(0, (min(first_start, second_start), second_end))

    return merged


def split_column_segments(
    mask: np.ndarray,
    column: tuple[int, int, int, int, list[str]],
) -> list[tuple[int, int, list[str]]]:
    page_height, _ = mask.shape
    x, y, width, height, column_notes = column
    column_mask = mask[y : y + height, x : x + width]
    if column_mask.size == 0:
        return []

    work = cv2.dilate(
        column_mask,
        cv2.getStructuringElement(cv2.MORPH_RECT, (11, 5)),
        iterations=1,
    )
    row_profile = rolling_mean((work > 0).sum(axis=1), max(5, page_height // 550))
    active_threshold = max(4, width * 0.004)
    active_rows = row_profile > active_threshold
    bands = ranges_from_bool(active_rows)

    if not bands:
        return [(0, height, column_notes + ["fallback_full_column_no_bands"])]

    split_gap = max(48, int(page_height * 0.014))
    min_segment_height = max(105, int(page_height * 0.032))
    segments: list[tuple[int, int]] = []
    segment_start = bands[0][0]
    previous_end = bands[0][1]

    for band_start, band_end in bands[1:]:
        gap = band_start - previous_end
        current_height = previous_end - segment_start
        if gap >= split_gap and current_height >= min_segment_height:
            segments.append((segment_start, previous_end))
            segment_start = band_start
        previous_end = band_end

    segments.append((segment_start, previous_end))
    segments = merge_short_segments(segments, min_segment_height)

    if not segments:
        return [(0, height, column_notes + ["fallback_full_column_after_merge"])]

    return [(start, end, column_notes.copy()) for start, end in segments]


def score_candidate(
    mask: np.ndarray,
    bbox: tuple[int, int, int, int],
    notes: list[str],
    segment_count: int,
) -> tuple[float, list[str]]:
    page_height, page_width = mask.shape
    x, y, width, height = bbox
    area = max(1, width * height)
    ink_pixels = int((mask[y : y + height, x : x + width] > 0).sum())
    ink_density = ink_pixels / area
    height_ratio = height / page_height
    confidence = 0.48
    scored_notes = notes.copy()

    if any(note.startswith("two_column") for note in notes):
        confidence += 0.08

    if 0.035 <= height_ratio <= 0.32:
        confidence += 0.18
    elif height_ratio > 0.45:
        confidence -= 0.25
        scored_notes.append("very_tall_candidate_check_for_multiple_questions")
    elif height_ratio < 0.028:
        confidence -= 0.18
        scored_notes.append("very_short_candidate")

    if 0.0015 <= ink_density <= 0.08:
        confidence += 0.12
    elif ink_density < 0.0015:
        confidence -= 0.18
        scored_notes.append("low_ink_density")
    else:
        confidence -= 0.08
        scored_notes.append("high_ink_density_possible_table_or_overlap")

    if segment_count > 1:
        confidence += 0.06

    if y < page_height * 0.07 and height < page_height * 0.12:
        confidence -= 0.1
        scored_notes.append("top_of_page_header_possible")

    if x <= 3 or y <= 3 or x + width >= page_width - 3 or y + height >= page_height - 3:
        confidence -= 0.08
        scored_notes.append("touches_page_edge")

    return round(float(max(0.05, min(0.95, confidence))), 2), scored_notes


def make_candidates_for_page(page: PageImage, crops_dir: Path, start_index: int) -> list[Candidate]:
    image = imread(page.path)
    mask = build_ink_mask(image)
    page_bbox = content_bbox(mask)
    columns = detect_columns(mask, page_bbox)
    raw_segments: list[tuple[int, int, int, int, list[str], int]] = []

    for column in columns:
        column_x, column_y, column_width, _, _ = column
        segments = split_column_segments(mask, column)
        segment_count = len(segments)
        for segment_start, segment_end, notes in segments:
            pad_x = max(30, int(page.width * 0.012))
            pad_y = max(42, int(page.height * 0.014))
            x1 = clamp(column_x - pad_x, 0, page.width - 1)
            x2 = clamp(column_x + column_width + pad_x, x1 + 1, page.width)
            y1 = clamp(column_y + segment_start - pad_y, 0, page.height - 1)
            y2 = clamp(column_y + segment_end + pad_y, y1 + 1, page.height)
            raw_segments.append((x1, y1, x2 - x1, y2 - y1, notes, segment_count))

    if not raw_segments:
        x, y, width, height = page_bbox
        raw_segments.append((x, y, width, height, ["fallback_page_content_box"], 1))

    # Two-column exams are usually read down the left column, then down the right column.
    raw_segments.sort(key=lambda item: (item[0], item[1]))
    candidates: list[Candidate] = []

    for offset, (x, y, width, height, notes, segment_count) in enumerate(raw_segments, start=start_index):
        candidate_id = f"q_{offset:03d}"
        confidence, scored_notes = score_candidate(
            mask,
            (x, y, width, height),
            notes,
            segment_count,
        )
        crop = image[y : y + height, x : x + width]
        crop_path = crops_dir / f"{candidate_id}.png"
        imwrite(crop_path, crop)
        candidates.append(
            Candidate(
                candidate_id=candidate_id,
                page_number=page.page_number,
                question_number_guess=None,
                bbox={"x": x, "y": y, "width": width, "height": height},
                confidence=confidence,
                notes=scored_notes,
                crop_path=str(crop_path.relative_to(crops_dir.parent)).replace("\\", "/"),
            )
        )

    return candidates


def candidate_to_json(candidate: Candidate) -> dict[str, object]:
    return {
        "candidate_id": candidate.candidate_id,
        "page_number": candidate.page_number,
        "question_number_guess": candidate.question_number_guess,
        "bbox": candidate.bbox,
        "confidence": candidate.confidence,
        "notes": candidate.notes,
    }


def write_coordinates(
    run_dir: Path,
    input_pdf: Path,
    dpi: int,
    pages: list[PageImage],
    candidates: list[Candidate],
) -> None:
    payload = {
        "input_pdf": str(input_pdf),
        "dpi": dpi,
        "page_count": len(pages),
        "coordinate_system": "pixel coordinates on the rendered 300dpi page PNG",
        "candidates": [candidate_to_json(candidate) for candidate in candidates],
    }
    (run_dir / "crop_coordinates.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def markdown_list(items: Iterable[str]) -> str:
    lines = [f"- {item}" for item in items]
    return "\n".join(lines) if lines else "- 없음"


def write_summary(
    run_dir: Path,
    input_pdf: Path,
    dpi: int,
    pages: list[PageImage],
    candidates: list[Candidate],
    risk_threshold: float,
) -> None:
    per_page = Counter(candidate.page_number for candidate in candidates)
    risky = [
        candidate
        for candidate in candidates
        if candidate.confidence < risk_threshold
        or any("fallback" in note or "very_" in note for note in candidate.notes)
    ]

    page_counts = [
        f"page_{page.page_number:03d}: {per_page.get(page.page_number, 0)}개"
        for page in pages
    ]
    risky_lines = [
        (
            f"{candidate.candidate_id} | page {candidate.page_number} | "
            f"confidence {candidate.confidence:.2f} | notes: "
            f"{', '.join(candidate.notes) if candidate.notes else 'none'}"
        )
        for candidate in risky
    ]

    summary = f"""# Crop Benchmark Summary

## 기본 정보
- 입력 PDF명: `{input_pdf.name}`
- 입력 PDF 경로: `{input_pdf}`
- 출력 폴더: `{run_dir}`
- 페이지 수: {len(pages)}
- 생성된 crop 후보 수: {len(candidates)}

## 페이지별 후보 수
{markdown_list(page_counts)}

## 사용한 주요 기준
- PyMuPDF로 PDF를 {dpi}dpi 기준 PNG로 렌더링
- OpenCV grayscale thresholding으로 잉크 영역 추출
- projection profile로 본문 영역과 상하 공백 탐지
- 중앙 gutter의 저밀도 구간을 이용해 2단 시험지 후보 분리
- 각 column 안에서 수평 projection과 큰 공백 구간으로 문항 후보 분리
- 문항이 잘리는 것보다 넉넉한 crop을 우선하여 상하좌우 padding 추가
- confidence가 낮은 후보는 header, footer, 너무 큰 crop, 너무 작은 crop, 낮은 잉크 밀도 등을 notes에 기록

## 실패 가능성이 높은 후보
{markdown_list(risky_lines)}

## Holic A/B/C 평가 기준
- A: 바로 사용 가능. 문제 번호, 조건, 보기, 도형, 그래프, 표가 모두 포함되고 불필요한 인접 문항이 거의 없음.
- B: 약간 보정하면 사용 가능. 문항은 거의 포함됐지만 여백이 과하거나, 인접 문항 일부가 섞였거나, 수동 crop 보정이 조금 필요함.
- C: 실패. 문항 일부가 잘렸거나, 도형/보기/그래프가 빠졌거나, 여러 문항이 크게 섞여 자동 crop으로 쓰기 어려움.

1차 목표는 A+B 95% 이상입니다. A만 95%를 기대하지 않습니다.

## 검수 방법
1. `crops/` 폴더를 파일명 순서대로 엽니다.
2. 각 `q_001.png`, `q_002.png`를 A/B/C로 빠르게 표시합니다.
3. C가 나온 후보는 `crop_coordinates.json`에서 candidate_id, page_number, bbox, notes를 확인합니다.
4. C가 반복되는 패턴을 알려주면 다음 단계에서 분리 기준을 조정합니다.

## 실행 방법
```bash
python -m venv .venv-crop
.venv-crop\\Scripts\\activate
pip install -r requirements-crop.txt
python scripts/crop_benchmark.py --input crop_inputs/sample.pdf
```

## 이번 단계에서 하지 않는 것
- Supabase 업로드
- 웹앱 UI 통합
- OpenAI API 사용
- 로컬 LLM 사용
- 문항 DB 저장
- 자동 해설 생성
"""
    (run_dir / "summary.md").write_text(summary, encoding="utf-8")


def run(input_pdf: Path, output_root: Path, dpi: int, risk_threshold: float) -> Path:
    input_pdf = input_pdf.resolve()
    output_root = output_root.resolve()

    if not input_pdf.exists():
        raise FileNotFoundError(
            f"Input PDF not found: {input_pdf}\n"
            "Put a PDF at crop_inputs/sample.pdf or pass --input <path>."
        )

    run_dir = make_run_dir(output_root)
    pages = render_pdf(input_pdf, run_dir / "pages", dpi)

    all_candidates: list[Candidate] = []
    next_index = 1
    for page in pages:
        page_candidates = make_candidates_for_page(page, run_dir / "crops", next_index)
        all_candidates.extend(page_candidates)
        next_index += len(page_candidates)

    write_coordinates(run_dir, input_pdf, dpi, pages, all_candidates)
    write_summary(run_dir, input_pdf, dpi, pages, all_candidates, risk_threshold)
    return run_dir


def main() -> None:
    args = parse_args()
    run_dir = run(args.input, args.output_root, args.dpi, args.min_confidence_risk)
    print(f"Crop benchmark complete: {run_dir}")
    print(f"- pages: {run_dir / 'pages'}")
    print(f"- crops: {run_dir / 'crops'}")
    print(f"- coordinates: {run_dir / 'crop_coordinates.json'}")
    print(f"- summary: {run_dir / 'summary.md'}")


if __name__ == "__main__":
    main()
