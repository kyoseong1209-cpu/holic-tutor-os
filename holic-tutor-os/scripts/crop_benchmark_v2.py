from __future__ import annotations

import argparse
import json
import re
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
DEFAULT_OUTPUT_ROOT = PROJECT_ROOT / "crop_outputs_v2"
ANCHOR_PATTERN = re.compile(r"^\s*(?P<number>\d{1,2})\s*\.\s*(?P<label>\[서답형\s*\d+\])?")


@dataclass
class PageRender:
    page_number: int
    path: Path
    width: int
    height: int
    scale: float


@dataclass
class TextLine:
    page_number: int
    text: str
    x0: float
    y0: float
    x1: float
    y1: float
    px_x0: int
    px_y0: int
    px_x1: int
    px_y1: int
    font_size: float


@dataclass
class Anchor:
    page_number: int
    question_number: int
    x: int
    y: int
    text: str
    column: str
    confidence: float
    line: TextLine
    notes: list[str]


@dataclass
class Candidate:
    candidate_id: str
    page_number: int
    question_number_guess: int | None
    bbox: dict[str, int]
    confidence: float
    notes: list[str]
    output_path: str
    failed: bool


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "PDF text-anchor based crop benchmark. Detects question-number "
            "anchors with PyMuPDF text coordinates before making conservative crops."
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
        help=f"Root folder for timestamped v2 outputs. Default: {DEFAULT_OUTPUT_ROOT}",
    )
    parser.add_argument("--dpi", type=int, default=300, help="PDF render DPI. Default: 300")
    parser.add_argument(
        "--large-area-threshold",
        type=float,
        default=0.60,
        help="Candidates above this page-area ratio are written to failed_pages. Default: 0.60",
    )
    return parser.parse_args()


def make_run_dir(output_root: Path) -> Path:
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    run_dir = output_root / timestamp
    suffix = 1
    while run_dir.exists():
        run_dir = output_root / f"{timestamp}_{suffix:02d}"
        suffix += 1

    for folder in ("pages", "crops", "failed_pages", "anchors_debug"):
        (run_dir / folder).mkdir(parents=True, exist_ok=True)
    return run_dir


def render_pdf(input_pdf: Path, pages_dir: Path, dpi: int) -> list[PageRender]:
    scale = dpi / 72
    matrix = fitz.Matrix(scale, scale)
    pages: list[PageRender] = []

    with fitz.open(input_pdf) as document:
        for page_index, page in enumerate(document, start=1):
            pixmap = page.get_pixmap(matrix=matrix, colorspace=fitz.csRGB, alpha=False)
            page_path = pages_dir / f"page_{page_index:03d}.png"
            pixmap.save(page_path)
            pages.append(
                PageRender(
                    page_number=page_index,
                    path=page_path,
                    width=pixmap.width,
                    height=pixmap.height,
                    scale=scale,
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


def build_ink_mask(image_bgr: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (3, 3), 0)
    _, mask = cv2.threshold(blurred, 245, 255, cv2.THRESH_BINARY_INV)
    return cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))


def content_bbox(mask: np.ndarray) -> tuple[int, int, int, int]:
    height, width = mask.shape
    rows = np.where((mask > 0).sum(axis=1) > max(8, int(width * 0.002)))[0]
    cols = np.where((mask > 0).sum(axis=0) > max(8, int(height * 0.002)))[0]
    if len(rows) == 0 or len(cols) == 0:
        return (0, 0, width, height)

    pad = max(20, int(min(width, height) * 0.008))
    x1 = clamp(int(cols[0]) - pad, 0, width - 1)
    y1 = clamp(int(rows[0]) - pad, 0, height - 1)
    x2 = clamp(int(cols[-1]) + pad, x1 + 1, width)
    y2 = clamp(int(rows[-1]) + pad, y1 + 1, height)
    return (x1, y1, x2 - x1, y2 - y1)


def extract_text_lines(input_pdf: Path, pages: list[PageRender]) -> dict[int, list[TextLine]]:
    page_lookup = {page.page_number: page for page in pages}
    lines_by_page: dict[int, list[TextLine]] = {}

    with fitz.open(input_pdf) as document:
        for page_index, page in enumerate(document, start=1):
            rendered = page_lookup[page_index]
            page_lines: list[TextLine] = []
            text_dict = page.get_text("dict")

            for block in text_dict.get("blocks", []):
                if block.get("type") != 0:
                    continue
                for line in block.get("lines", []):
                    spans = [
                        span
                        for span in line.get("spans", [])
                        if str(span.get("text", "")).strip()
                    ]
                    if not spans:
                        continue

                    text = "".join(str(span.get("text", "")) for span in spans).strip()
                    if not text:
                        continue

                    x0 = min(float(span["bbox"][0]) for span in spans)
                    y0 = min(float(span["bbox"][1]) for span in spans)
                    x1 = max(float(span["bbox"][2]) for span in spans)
                    y1 = max(float(span["bbox"][3]) for span in spans)
                    font_size = float(np.median([float(span.get("size", 0)) for span in spans]))

                    page_lines.append(
                        TextLine(
                            page_number=page_index,
                            text=text,
                            x0=x0,
                            y0=y0,
                            x1=x1,
                            y1=y1,
                            px_x0=int(round(x0 * rendered.scale)),
                            px_y0=int(round(y0 * rendered.scale)),
                            px_x1=int(round(x1 * rendered.scale)),
                            px_y1=int(round(y1 * rendered.scale)),
                            font_size=font_size,
                        )
                    )

            lines_by_page[page_index] = sorted(page_lines, key=lambda item: (item.px_y0, item.px_x0))

    return lines_by_page


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


def detect_gutter_x(mask: np.ndarray, bbox: tuple[int, int, int, int]) -> int | None:
    x, y, width, height = bbox
    body_y1 = y + int(height * 0.10)
    body_y2 = y + int(height * 0.96)
    body = mask[body_y1:body_y2, x : x + width]
    if body.size == 0:
        return None

    projection = (body > 0).sum(axis=0)
    smooth = rolling_mean(projection, max(35, width // 80))
    threshold = max(4, float(np.percentile(smooth, 10)))
    low_runs = ranges_from_bool(smooth <= threshold)
    center_min = int(width * 0.38)
    center_max = int(width * 0.62)
    min_width = max(45, int(mask.shape[1] * 0.025))

    best_run: tuple[int, int] | None = None
    for run_start, run_end in low_runs:
        run_width = run_end - run_start
        run_center = (run_start + run_end) // 2
        if run_width >= min_width and center_min <= run_center <= center_max:
            best_run = (run_start, run_end)
            break

    if not best_run:
        return None

    return x + (best_run[0] + best_run[1]) // 2


def assign_columns(
    anchors: list[Anchor],
    page_width: int,
    content: tuple[int, int, int, int],
    gutter_x: int | None,
) -> tuple[dict[str, tuple[int, int]], list[Anchor]]:
    if not anchors:
        return {"full": (content[0], content[0] + content[2])}, anchors

    xs = [anchor.x for anchor in anchors]
    content_x, _, content_width, _ = content
    split_x = gutter_x if gutter_x is not None else content_x + content_width // 2
    has_left = any(x < split_x - page_width * 0.04 for x in xs)
    has_right = any(x > split_x + page_width * 0.04 for x in xs)
    two_column = has_left and has_right

    if not two_column:
        for anchor in anchors:
            anchor.column = "full"
            anchor.notes.append("single_column_text_anchor")
        return {"full": (content_x, content_x + content_width)}, anchors

    gutter_pad = max(18, int(page_width * 0.008))
    bounds = {
        "left": (content_x, max(content_x + 1, split_x - gutter_pad)),
        "right": (min(content_x + content_width - 1, split_x + gutter_pad), content_x + content_width),
    }
    for anchor in anchors:
        anchor.column = "left" if anchor.x < split_x else "right"
        anchor.notes.append(f"two_column_{anchor.column}")
    return bounds, anchors


def detect_page_anchors(
    lines: list[TextLine],
    rendered: PageRender,
    content: tuple[int, int, int, int],
) -> list[Anchor]:
    if not lines:
        return []

    median_size = float(np.median([line.font_size for line in lines if line.font_size > 0] or [1]))
    header_zone_y = int(rendered.height * 0.08)
    footer_zone_y = int(rendered.height * 0.975)
    content_left = content[0]
    content_right = content[0] + content[2]
    anchors: list[Anchor] = []

    for line in lines:
        match = ANCHOR_PATTERN.match(line.text)
        if not match:
            continue

        number = int(match.group("number"))
        notes: list[str] = []
        confidence = 0.86

        if line.px_y0 < header_zone_y:
            confidence -= 0.35
            notes.append("inside_header_zone")
        if line.px_y0 > footer_zone_y:
            confidence -= 0.30
            notes.append("inside_footer_zone")
        if line.font_size < median_size * 0.72:
            confidence -= 0.22
            notes.append("small_font_possible_footnote")
        if line.px_x0 < content_left - rendered.width * 0.04 or line.px_x0 > content_right:
            confidence -= 0.16
            notes.append("outside_content_x_bounds")
        if len(line.text) <= len(match.group(0)) + 1:
            confidence -= 0.08
            notes.append("anchor_line_has_little_text")

        # Keep a conservative threshold. False anchors tend to be small, high, or far from the text column.
        if confidence < 0.45:
            continue

        anchors.append(
            Anchor(
                page_number=line.page_number,
                question_number=number,
                x=line.px_x0,
                y=line.px_y0,
                text=match.group(0).strip(),
                column="unknown",
                confidence=round(max(0.05, min(0.98, confidence)), 2),
                line=line,
                notes=notes,
            )
        )

    anchors.sort(key=lambda item: (item.y, item.x, item.question_number))
    deduped: list[Anchor] = []
    for anchor in anchors:
        duplicate = next(
            (
                existing
                for existing in deduped
                if existing.question_number == anchor.question_number
                and abs(existing.x - anchor.x) < 30
                and abs(existing.y - anchor.y) < 24
            ),
            None,
        )
        if duplicate:
            continue
        deduped.append(anchor)

    return deduped


def column_ink_bottom(mask: np.ndarray, x1: int, x2: int, start_y: int, fallback: int) -> int:
    page_height = mask.shape[0]
    y1 = clamp(start_y, 0, page_height - 1)
    y2 = clamp(fallback, y1 + 1, page_height)
    region = mask[y1:y2, x1:x2]
    if region.size == 0:
        return y2

    rows = np.where((region > 0).sum(axis=1) > max(3, int((x2 - x1) * 0.002)))[0]
    if len(rows) == 0:
        return y2
    return y1 + int(rows[-1])


def tight_bbox_from_ink(
    mask: np.ndarray,
    bbox: tuple[int, int, int, int],
    anchor: Anchor,
    column_bounds: tuple[int, int],
    next_anchor_y: int | None,
) -> tuple[int, int, int, int]:
    page_height, page_width = mask.shape
    x, y, width, height = bbox
    region = mask[y : y + height, x : x + width]
    margin_x = max(34, int(page_width * 0.011))
    margin_y = max(44, int(page_height * 0.012))
    col_x1, col_x2 = column_bounds

    if region.size == 0:
        return bbox

    rows = np.where((region > 0).sum(axis=1) > max(2, int(width * 0.0015)))[0]
    cols = np.where((region > 0).sum(axis=0) > max(2, int(height * 0.0015)))[0]
    if len(rows) == 0 or len(cols) == 0:
        return bbox

    tight_x1 = min(anchor.x - margin_x, x + int(cols[0]) - margin_x)
    tight_x2 = x + int(cols[-1]) + margin_x
    tight_y1 = min(anchor.y - margin_y, y + int(rows[0]) - margin_y)
    tight_y2 = max(y + int(rows[-1]) + margin_y, anchor.y + margin_y)

    if next_anchor_y is not None:
        tight_y2 = min(tight_y2, next_anchor_y - max(12, margin_y // 3))

    final_x1 = clamp(tight_x1, col_x1, max(col_x1 + 1, col_x2 - 1))
    final_x2 = clamp(tight_x2, final_x1 + 1, col_x2)
    final_y1 = clamp(tight_y1, 0, page_height - 1)
    final_y2 = clamp(tight_y2, final_y1 + 1, page_height)
    return (final_x1, final_y1, final_x2 - final_x1, final_y2 - final_y1)


def anchors_inside_bbox(anchors: Iterable[Anchor], bbox: tuple[int, int, int, int]) -> list[Anchor]:
    x, y, width, height = bbox
    return [
        anchor
        for anchor in anchors
        if x <= anchor.x <= x + width and y <= anchor.y <= y + height
    ]


def score_crop(
    anchor: Anchor,
    page: PageRender,
    bbox: tuple[int, int, int, int],
    anchors_inside: list[Anchor],
    notes: list[str],
    large_area_threshold: float,
) -> tuple[float, list[str], bool]:
    x, y, width, height = bbox
    area_ratio = (width * height) / max(1, page.width * page.height)
    confidence = min(0.95, anchor.confidence + 0.05)
    crop_notes = notes.copy()
    failed = False

    if area_ratio >= large_area_threshold:
        confidence -= 0.45
        failed = True
        crop_notes.append("large_area_candidate")
    elif area_ratio > 0.35:
        confidence -= 0.20
        crop_notes.append("tall_or_wide_candidate_review")

    if len(anchors_inside) > 1:
        confidence -= 0.35
        crop_notes.append("multiple_question_anchors_inside")

    if y < page.height * 0.08:
        confidence -= 0.20
        crop_notes.append("header_overlap_suspected")

    if height < page.height * 0.025:
        confidence -= 0.20
        crop_notes.append("very_short_candidate")

    if x <= 2 or x + width >= page.width - 2 or y + height >= page.height - 2:
        confidence -= 0.10
        crop_notes.append("touches_page_edge")

    return round(max(0.05, min(0.98, confidence)), 2), crop_notes, failed


def create_candidates_for_page(
    page: PageRender,
    anchors: list[Anchor],
    column_bounds: dict[str, tuple[int, int]],
    run_dir: Path,
    next_candidate_index: int,
    large_area_threshold: float,
) -> tuple[list[Candidate], int]:
    image = imread(page.path)
    mask = build_ink_mask(image)
    content = content_bbox(mask)
    bottom_limit = min(page.height - 1, int(page.height * 0.97), content[1] + content[3])
    margin_y = max(45, int(page.height * 0.014))
    candidates: list[Candidate] = []

    if not anchors:
        failed_path = run_dir / "failed_pages" / f"page_{page.page_number:03d}_failed.png"
        imwrite(failed_path, image)
        return candidates, next_candidate_index

    first_anchor_y = min(anchor.y for anchor in anchors)
    header_boundary = max(0, first_anchor_y - margin_y)

    for column_name in ("left", "right", "full"):
        column_anchors = [anchor for anchor in anchors if anchor.column == column_name]
        if not column_anchors:
            continue

        column_anchors.sort(key=lambda item: item.y)
        col_x1, col_x2 = column_bounds[column_name]

        for index, anchor in enumerate(column_anchors):
            next_anchor = column_anchors[index + 1] if index + 1 < len(column_anchors) else None
            top = max(header_boundary, anchor.y - margin_y)
            if next_anchor:
                bottom = max(top + 1, next_anchor.y - max(18, margin_y // 2))
                next_anchor_y = next_anchor.y
            else:
                bottom = column_ink_bottom(mask, col_x1, col_x2, anchor.y, bottom_limit) + margin_y
                next_anchor_y = None

            bottom = clamp(bottom, top + 1, bottom_limit)
            rough_bbox = (col_x1, top, col_x2 - col_x1, bottom - top)
            bbox_tuple = tight_bbox_from_ink(mask, rough_bbox, anchor, (col_x1, col_x2), next_anchor_y)
            inside = anchors_inside_bbox(anchors, bbox_tuple)
            notes = anchor.notes + [f"anchor_question_{anchor.question_number}", f"column_{anchor.column}"]
            confidence, scored_notes, failed = score_crop(
                anchor,
                page,
                bbox_tuple,
                inside,
                notes,
                large_area_threshold,
            )

            candidate_id = f"q_{next_candidate_index:03d}"
            next_candidate_index += 1
            x, y, width, height = bbox_tuple
            crop = image[y : y + height, x : x + width]
            output_folder = "failed_pages" if failed else "crops"
            output_name = (
                f"{candidate_id}_page_{page.page_number:03d}_failed.png"
                if failed
                else f"{candidate_id}.png"
            )
            output_path = run_dir / output_folder / output_name
            imwrite(output_path, crop)

            candidates.append(
                Candidate(
                    candidate_id=candidate_id,
                    page_number=page.page_number,
                    question_number_guess=anchor.question_number,
                    bbox={"x": x, "y": y, "width": width, "height": height},
                    confidence=confidence,
                    notes=scored_notes,
                    output_path=str(output_path.relative_to(run_dir)).replace("\\", "/"),
                    failed=failed,
                )
            )

    return candidates, next_candidate_index


def draw_anchor_debug(
    page: PageRender,
    anchors: list[Anchor],
    column_bounds: dict[str, tuple[int, int]],
    output_dir: Path,
) -> None:
    image = imread(page.path)
    for column, (x1, x2) in column_bounds.items():
        color = (90, 180, 255) if column == "left" else (255, 180, 90)
        if column == "full":
            color = (120, 220, 120)
        cv2.line(image, (x1, 0), (x1, page.height), color, 3)
        cv2.line(image, (x2, 0), (x2, page.height), color, 3)

    for anchor in anchors:
        cv2.circle(image, (anchor.x, anchor.y), 18, (0, 0, 255), 4)
        label = f"{anchor.question_number}. {anchor.column} {anchor.confidence:.2f}"
        cv2.putText(
            image,
            label,
            (anchor.x + 20, max(28, anchor.y - 12)),
            cv2.FONT_HERSHEY_SIMPLEX,
            1.0,
            (0, 0, 255),
            3,
            cv2.LINE_AA,
        )

    imwrite(output_dir / f"page_{page.page_number:03d}_anchors.png", image)


def anchor_to_json(anchor: Anchor) -> dict[str, object]:
    return {
        "page_number": anchor.page_number,
        "question_number": anchor.question_number,
        "x": anchor.x,
        "y": anchor.y,
        "text": anchor.text,
        "column": anchor.column,
        "confidence": anchor.confidence,
        "notes": anchor.notes,
    }


def candidate_to_json(candidate: Candidate) -> dict[str, object]:
    return {
        "candidate_id": candidate.candidate_id,
        "page_number": candidate.page_number,
        "question_number_guess": candidate.question_number_guess,
        "bbox": candidate.bbox,
        "confidence": candidate.confidence,
        "notes": candidate.notes,
        "output_path": candidate.output_path,
        "failed": candidate.failed,
    }


def markdown_list(items: Iterable[str]) -> str:
    lines = [f"- {item}" for item in items]
    return "\n".join(lines) if lines else "- 없음"


def write_outputs(
    run_dir: Path,
    input_pdf: Path,
    dpi: int,
    pages: list[PageRender],
    anchors: list[Anchor],
    candidates: list[Candidate],
    failed_pages: list[int],
) -> None:
    anchors_payload = {
        "input_pdf": str(input_pdf),
        "dpi": dpi,
        "method": "v2_text_anchor_based",
        "anchors": [anchor_to_json(anchor) for anchor in anchors],
    }
    (run_dir / "anchors_debug.json").write_text(
        json.dumps(anchors_payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    coordinate_payload = {
        "input_pdf": str(input_pdf),
        "dpi": dpi,
        "method": "v2_text_anchor_based",
        "coordinate_system": "pixel coordinates on rendered page PNGs",
        "page_count": len(pages),
        "candidates": [candidate_to_json(candidate) for candidate in candidates],
    }
    (run_dir / "crop_coordinates.json").write_text(
        json.dumps(coordinate_payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    per_page = Counter(candidate.page_number for candidate in candidates)
    multiple_anchor = [
        candidate
        for candidate in candidates
        if "multiple_question_anchors_inside" in candidate.notes
    ]
    large_area = [
        candidate for candidate in candidates if "large_area_candidate" in candidate.notes
    ]
    header_overlap = [
        candidate for candidate in candidates if "header_overlap_suspected" in candidate.notes
    ]
    failed_candidates = [candidate for candidate in candidates if candidate.failed]

    summary = f"""# Crop Benchmark V2 Summary

## 기본 정보
- 입력 PDF명: `{input_pdf.name}`
- 입력 PDF 경로: `{input_pdf}`
- 출력 폴더: `{run_dir}`
- 렌더링 DPI: {dpi}
- 페이지 수: {len(pages)}
- 탐지된 anchor 개수: {len(anchors)}
- 생성된 crop 개수: {len([candidate for candidate in candidates if not candidate.failed])}
- failed_pages 개수: {len(set(failed_pages + [candidate.page_number for candidate in failed_candidates]))}

## 페이지별 후보 수
{markdown_list([f"page_{page.page_number:03d}: {per_page.get(page.page_number, 0)}개" for page in pages])}

## failed_pages
{markdown_list([f"page_{page_number:03d}" for page_number in sorted(set(failed_pages))])}

## multiple anchor 포함 후보
{markdown_list([f"{candidate.candidate_id} page {candidate.page_number} q{candidate.question_number_guess} confidence {candidate.confidence}" for candidate in multiple_anchor])}

## large area 후보
{markdown_list([f"{candidate.candidate_id} page {candidate.page_number} q{candidate.question_number_guess} confidence {candidate.confidence}" for candidate in large_area])}

## header overlap 의심 후보
{markdown_list([f"{candidate.candidate_id} page {candidate.page_number} q{candidate.question_number_guess} confidence {candidate.confidence}" for candidate in header_overlap])}

## v1 대비 개선 의도
- v1은 contour/projection 중심이라 학교명, 연도, 단원 표 같은 header가 crop에 섞이거나 여러 문항이 한 crop으로 붙는 문제가 있었습니다.
- v2는 PyMuPDF text extraction으로 문항 번호 `1.`, `10.`, `17.[서답형1]` 같은 anchor를 먼저 탐지합니다.
- 같은 column 안에서 현재 문항 anchor부터 다음 문항 anchor 직전까지 crop하여 5번/6번/7번이 붙는 문제를 줄입니다.
- 첫 문항 anchor 이전 영역과 페이지 상단 header zone을 문제 crop에서 최대한 배제합니다.
- crop 면적이 페이지의 60% 이상이면 정상 crop이 아니라 failed_pages로 분리하고 `large_area_candidate` note를 남깁니다.

## Holic A/B/C 평가 기준
- A: 바로 사용 가능. 문제 번호, 조건, 보기, 도형, 그래프, 표가 모두 포함되고 인접 문항이나 학교 header가 거의 없음.
- B: 약간 보정하면 사용 가능. 문항은 포함됐지만 여백이 과하거나 인접 요소가 조금 섞여 수동 보정이 필요함.
- C: 실패. 문항 일부가 잘렸거나, 여러 문항이 붙었거나, 학교명/연도/단원 header가 크게 섞였거나, 페이지 전체 crop에 가까움.

1차 목표는 A+B 95% 이상입니다. A만 95%를 기대하지 않습니다.

## 검수 순서
1. `anchors_debug.json`에서 문항 번호 anchor가 맞게 잡혔는지 봅니다.
2. `anchors_debug/page_001_anchors.png` 같은 시각화 이미지에서 빨간 anchor가 실제 문항 번호 위에 찍혔는지 봅니다.
3. `crops/q_001.png`부터 A/B/C로 평가합니다.
4. `failed_pages/` 후보는 large area 또는 anchor 실패 후보로 보고 따로 원인을 기록합니다.

## 실행 방법
```powershell
.\\.venv-crop\\Scripts\\python.exe scripts\\crop_benchmark_v2.py --input crop_inputs\\sample.pdf
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


def save_failed_page(page: PageRender, run_dir: Path, reason: str) -> None:
    image = imread(page.path)
    cv2.putText(
        image,
        reason,
        (60, 120),
        cv2.FONT_HERSHEY_SIMPLEX,
        1.4,
        (0, 0, 255),
        4,
        cv2.LINE_AA,
    )
    imwrite(run_dir / "failed_pages" / f"page_{page.page_number:03d}_failed.png", image)


def run(input_pdf: Path, output_root: Path, dpi: int, large_area_threshold: float) -> Path:
    input_pdf = input_pdf.resolve()
    output_root = output_root.resolve()

    if not input_pdf.exists():
        raise FileNotFoundError(
            f"Input PDF not found: {input_pdf}\n"
            "Put a PDF at crop_inputs/sample.pdf or pass --input <path>."
        )

    run_dir = make_run_dir(output_root)
    pages = render_pdf(input_pdf, run_dir / "pages", dpi)
    lines_by_page = extract_text_lines(input_pdf, pages)
    all_anchors: list[Anchor] = []
    all_candidates: list[Candidate] = []
    failed_pages: list[int] = []
    next_candidate_index = 1

    for page in pages:
        image = imread(page.path)
        mask = build_ink_mask(image)
        content = content_bbox(mask)
        raw_anchors = detect_page_anchors(lines_by_page.get(page.page_number, []), page, content)
        gutter_x = detect_gutter_x(mask, content)
        column_bounds, page_anchors = assign_columns(raw_anchors, page.width, content, gutter_x)
        all_anchors.extend(page_anchors)
        draw_anchor_debug(page, page_anchors, column_bounds, run_dir / "anchors_debug")

        if not page_anchors:
            failed_pages.append(page.page_number)
            save_failed_page(page, run_dir, "no_question_anchor_detected")
            continue

        page_candidates, next_candidate_index = create_candidates_for_page(
            page,
            page_anchors,
            column_bounds,
            run_dir,
            next_candidate_index,
            large_area_threshold,
        )
        all_candidates.extend(page_candidates)

    write_outputs(run_dir, input_pdf, dpi, pages, all_anchors, all_candidates, failed_pages)
    return run_dir


def main() -> None:
    args = parse_args()
    run_dir = run(args.input, args.output_root, args.dpi, args.large_area_threshold)
    print(f"Crop benchmark v2 complete: {run_dir}")
    print(f"- pages: {run_dir / 'pages'}")
    print(f"- crops: {run_dir / 'crops'}")
    print(f"- failed_pages: {run_dir / 'failed_pages'}")
    print(f"- anchors_debug: {run_dir / 'anchors_debug'}")
    print(f"- anchors_debug.json: {run_dir / 'anchors_debug.json'}")
    print(f"- coordinates: {run_dir / 'crop_coordinates.json'}")
    print(f"- summary: {run_dir / 'summary.md'}")


if __name__ == "__main__":
    main()
