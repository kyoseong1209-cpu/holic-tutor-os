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
from PIL import Image, ImageDraw, ImageFont


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = PROJECT_ROOT / "crop_inputs" / "sample.pdf"
DEFAULT_OUTPUT_ROOT = PROJECT_ROOT / "crop_outputs_v4"

ANCHOR_PATTERNS = (
    ("number_dot_essay", re.compile(r"^\s*(?P<number>\d{1,2})\s*\.\s*(?P<label>\[서답형\s*\d+\])?")),
    ("number_paren_essay", re.compile(r"^\s*(?P<number>\d{1,2})\s*\)\s*(?P<label>\[서답형\s*\d+\])?")),
    ("number_essay_space", re.compile(r"^\s*(?P<number>\d{1,2})\s+(?P<label>\[서답형\s*\d+\])")),
    ("number_space_body", re.compile(r"^\s*(?P<number>\d{1,2})\s+(?P<body>\S.*)")),
    ("essay_label_only", re.compile(r"^\s*(?P<label>\[서답형\s*(?P<number>\d{1,2})\])")),
)


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
class Column:
    name: str
    x1: int
    y1: int
    x2: int
    y2: int

    @property
    def width(self) -> int:
        return self.x2 - self.x1

    @property
    def height(self) -> int:
        return self.y2 - self.y1

    def contains_line(self, line: TextLine) -> bool:
        line_center_x = (line.px_x0 + line.px_x1) // 2
        line_center_y = (line.px_y0 + line.px_y1) // 2
        return self.x1 <= line_center_x <= self.x2 and self.y1 <= line_center_y <= self.y2


@dataclass
class Layout:
    header_y2: int
    footer_y1: int
    content_bbox: tuple[int, int, int, int]
    split_x: int
    split_source: str
    left: Column
    right: Column


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
    status: str
    output_path: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Layout-first recall-focused crop benchmark. Hard-excludes header/footer, splits "
            "left/right columns, then uses PDF text anchors only inside each column."
        )
    )
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT, help=f"Input PDF. Default: {DEFAULT_INPUT}")
    parser.add_argument(
        "--output-root",
        type=Path,
        default=DEFAULT_OUTPUT_ROOT,
        help=f"Root folder for timestamped v4 outputs. Default: {DEFAULT_OUTPUT_ROOT}",
    )
    parser.add_argument("--dpi", type=int, default=300, help="PDF render DPI. Default: 300")
    parser.add_argument(
        "--header-ratio",
        type=float,
        default=0.10,
        help="Hard excluded top page ratio. Default: 0.10",
    )
    parser.add_argument(
        "--footer-ratio",
        type=float,
        default=0.055,
        help="Hard excluded bottom page ratio. Default: 0.055",
    )
    parser.add_argument(
        "--large-area-threshold",
        type=float,
        default=0.40,
        help="Candidates above this page-area ratio with <=1 anchor are rejected. Default: 0.40",
    )
    parser.add_argument(
        "--expected-count",
        type=int,
        default=None,
        help="Expected total question count for sequence/missing-number reporting.",
    )
    return parser.parse_args()


def make_run_dir(output_root: Path) -> Path:
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    run_dir = output_root / timestamp
    suffix = 1
    while run_dir.exists():
        run_dir = output_root / f"{timestamp}_{suffix:02d}"
        suffix += 1

    for name in ("pages", "crops", "rejected_candidates", "unassigned_regions", "failed_pages", "layout_debug"):
        (run_dir / name).mkdir(parents=True, exist_ok=True)
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


def extract_text_lines(input_pdf: Path, pages: list[PageRender]) -> dict[int, list[TextLine]]:
    page_lookup = {page.page_number: page for page in pages}
    lines_by_page: dict[int, list[TextLine]] = {}

    with fitz.open(input_pdf) as document:
        for page_index, page in enumerate(document, start=1):
            rendered = page_lookup[page_index]
            page_lines: list[TextLine] = []

            for block in page.get_text("dict").get("blocks", []):
                if block.get("type") != 0:
                    continue
                for line in block.get("lines", []):
                    spans = [span for span in line.get("spans", []) if str(span.get("text", "")).strip()]
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


def usable_content_bbox(
    mask: np.ndarray,
    header_y2: int,
    footer_y1: int,
) -> tuple[int, int, int, int]:
    page_height, page_width = mask.shape
    y1 = clamp(header_y2, 0, page_height - 1)
    y2 = clamp(footer_y1, y1 + 1, page_height)
    region = mask[y1:y2, :]
    rows = np.where((region > 0).sum(axis=1) > max(8, int(page_width * 0.002)))[0]
    cols = np.where((region > 0).sum(axis=0) > max(8, int((y2 - y1) * 0.002)))[0]

    margin_x = max(35, int(page_width * 0.035))
    if len(rows) == 0 or len(cols) == 0:
        return (margin_x, y1, page_width - margin_x * 2, y2 - y1)

    pad_x = max(18, int(page_width * 0.008))
    pad_y = max(20, int(page_height * 0.008))
    x_start = clamp(int(cols[0]) - pad_x, margin_x, page_width - margin_x - 1)
    x_end = clamp(int(cols[-1]) + pad_x, x_start + 1, page_width - margin_x)
    y_start = clamp(y1 + int(rows[0]) - pad_y, y1, y2 - 1)
    y_end = clamp(y1 + int(rows[-1]) + pad_y, y_start + 1, y2)
    return (x_start, y_start, x_end - x_start, y_end - y_start)


def detect_vertical_divider(mask: np.ndarray, header_y2: int, footer_y1: int) -> int | None:
    page_height, page_width = mask.shape
    center = page_width // 2
    half_window = int(page_width * 0.08)
    x1 = max(0, center - half_window)
    x2 = min(page_width, center + half_window)
    region = mask[header_y2:footer_y1, x1:x2]
    if region.size == 0:
        return None

    height = max(1, footer_y1 - header_y2)
    profile = (region > 0).sum(axis=0)
    threshold = height * 0.22
    candidates = np.where(profile > threshold)[0]
    if len(candidates) == 0:
        return None

    absolute = [x1 + int(index) for index in candidates]
    return min(absolute, key=lambda value: abs(value - center))


def detect_gutter(mask: np.ndarray, content: tuple[int, int, int, int]) -> int | None:
    x, y, width, height = content
    if width <= 0 or height <= 0:
        return None

    region = mask[y : y + height, x : x + width]
    if region.size == 0:
        return None

    profile = rolling_mean((region > 0).sum(axis=0), max(35, width // 80))
    threshold = max(4, float(np.percentile(profile, 12)))
    low_runs = ranges_from_bool(profile <= threshold)
    center_min = int(width * 0.35)
    center_max = int(width * 0.65)
    min_width = max(45, int(mask.shape[1] * 0.025))

    best: tuple[int, int] | None = None
    for run_start, run_end in low_runs:
        run_width = run_end - run_start
        run_center = (run_start + run_end) // 2
        if run_width >= min_width and center_min <= run_center <= center_max:
            best = (run_start, run_end)
            break

    if not best:
        return None

    return x + (best[0] + best[1]) // 2


def build_layout(
    mask: np.ndarray,
    page: PageRender,
    header_ratio: float,
    footer_ratio: float,
) -> Layout:
    header_y2 = int(page.height * header_ratio)
    footer_y1 = int(page.height * (1 - footer_ratio))
    content = usable_content_bbox(mask, header_y2, footer_y1)
    divider_x = detect_vertical_divider(mask, header_y2, footer_y1)

    if divider_x is not None:
        split_x = divider_x
        split_source = "vertical_divider_detected"
        gutter_half = max(24, int(page.width * 0.008))
    else:
        gutter_x = detect_gutter(mask, content)
        if gutter_x is not None:
            split_x = gutter_x
            split_source = "projection_gutter_detected"
            gutter_half = max(32, int(page.width * 0.012))
        else:
            split_x = page.width // 2
            split_source = "forced_midline_split"
            gutter_half = max(38, int(page.width * 0.014))

    margin_x = max(35, int(page.width * 0.035))
    content_x1, _, content_width, _ = content
    content_x2 = content_x1 + content_width
    page_left = min(content_x1, margin_x)
    page_right = max(content_x2, page.width - margin_x)
    col_y1 = header_y2
    col_y2 = footer_y1

    left = Column(
        name="left",
        x1=clamp(page_left, 0, page.width - 1),
        y1=col_y1,
        x2=clamp(split_x - gutter_half, page_left + 1, page.width),
        y2=col_y2,
    )
    right = Column(
        name="right",
        x1=clamp(split_x + gutter_half, 0, max(1, page_right - 1)),
        y1=col_y1,
        x2=clamp(page_right, split_x + gutter_half + 1, page.width),
        y2=col_y2,
    )

    return Layout(
        header_y2=header_y2,
        footer_y1=footer_y1,
        content_bbox=content,
        split_x=split_x,
        split_source=split_source,
        left=left,
        right=right,
    )



def match_anchor_text(text: str) -> tuple[int, str, str] | None:
    for pattern_name, pattern in ANCHOR_PATTERNS:
        match = pattern.match(text)
        if not match:
            continue

        question_number = int(match.group("number"))
        matched_text = match.group(0).strip()
        return question_number, matched_text, pattern_name
    return None


def has_supporting_ink_below(mask: np.ndarray, page: PageRender, column: Column, y: int) -> bool:
    y1 = clamp(y + max(8, int(page.height * 0.003)), column.y1, column.y2 - 1)
    y2 = clamp(y + max(160, int(page.height * 0.105)), y1 + 1, column.y2)
    region = mask[y1:y2, column.x1:column.x2]
    if region.size == 0:
        return False

    ink_pixels = int((region > 0).sum())
    density = ink_pixels / max(1, region.shape[0] * region.shape[1])
    row_hits = int(((region > 0).sum(axis=1) > max(4, int(column.width * 0.0015))).sum())
    return density > 0.00055 and row_hits >= max(8, int(region.shape[0] * 0.035))


def has_supporting_text_below(lines: list[TextLine], column: Column, line: TextLine, page: PageRender) -> bool:
    lower_bound = line.px_y1
    upper_bound = min(column.y2, line.px_y0 + max(180, int(page.height * 0.12)))
    nearby = [
        item
        for item in lines
        if item is not line and column.contains_line(item) and lower_bound <= item.px_y0 <= upper_bound
    ]
    return len(nearby) >= 1


def detect_anchors_in_column(
    lines: list[TextLine],
    page: PageRender,
    column: Column,
    mask: np.ndarray,
) -> list[Anchor]:
    column_lines = [line for line in lines if column.contains_line(line)]
    if not column_lines:
        return []

    font_sizes = [line.font_size for line in column_lines if line.font_size > 0]
    median_size = float(np.median(font_sizes or [1.0]))
    anchors: list[Anchor] = []

    for line in column_lines:
        match_info = match_anchor_text(line.text)
        if not match_info:
            continue

        question_number, matched_text, pattern_name = match_info
        if not 1 <= question_number <= 60:
            continue

        left_indent_ratio = (line.px_x0 - column.x1) / max(1, column.width)
        if left_indent_ratio > 0.68:
            continue

        if pattern_name == "number_space_body" and left_indent_ratio > 0.50:
            continue

        if line.px_y0 < column.y1 or line.px_y0 > column.y2:
            continue

        notes: list[str] = [f"layout_first_{column.name}_column", f"anchor_pattern_{pattern_name}"]
        confidence = 0.88
        if pattern_name in {"number_dot_essay", "number_paren_essay", "number_essay_space"}:
            confidence = 0.90
            notes.append("essay_label_anchor")
        elif pattern_name == "number_space_body":
            confidence = 0.74
            notes.append("loose_number_space_anchor")
        elif pattern_name == "essay_label_only":
            confidence = 0.66
            notes.append("essay_label_anchor_without_leading_number")

        if left_indent_ratio <= 0.18:
            notes.append("near_column_left")
        elif left_indent_ratio <= 0.34:
            confidence -= 0.08
            notes.append("moderately_indented_anchor")
        elif left_indent_ratio <= 0.52:
            confidence -= 0.20
            notes.append("indented_anchor_review")
        else:
            confidence -= 0.32
            notes.append("anchor_far_from_column_left")

        if line.font_size < median_size * 0.58:
            continue
        if line.font_size < median_size * 0.75:
            confidence -= 0.18
            notes.append("small_font_possible_footnote")
        elif line.font_size >= median_size * 1.08:
            confidence += 0.04
            notes.append("font_size_supports_anchor")

        supporting_ink = has_supporting_ink_below(mask, page, column, line.px_y0)
        supporting_text = has_supporting_text_below(column_lines, column, line, page)
        if supporting_ink:
            confidence += 0.04
            notes.append("supporting_ink_below")
        if supporting_text:
            confidence += 0.03
            notes.append("supporting_text_below")
        if not supporting_ink and not supporting_text:
            confidence -= 0.22
            notes.append("weak_content_below_anchor")

        if line.px_y0 <= column.y1 + max(70, int(page.height * 0.025)):
            confidence += 0.03
            notes.append("header_adjacent_first_question_kept")

        if line.px_y0 >= column.y2 - max(120, int(page.height * 0.045)):
            confidence -= 0.03
            notes.append("bottom_page_anchor")

        if len(line.text) <= len(matched_text) + 1:
            confidence -= 0.08
            notes.append("anchor_line_has_little_text")

        if pattern_name == "number_space_body" and confidence < 0.52:
            continue
        if confidence < 0.47:
            continue

        anchors.append(
            Anchor(
                page_number=page.page_number,
                question_number=question_number,
                x=clamp(line.px_x0, column.x1, column.x2),
                y=clamp(line.px_y0, column.y1, column.y2),
                text=matched_text,
                column=column.name,
                confidence=round(max(0.05, min(0.98, confidence)), 2),
                line=line,
                notes=notes,
            )
        )

    anchors.sort(key=lambda anchor: (anchor.y, anchor.x, -anchor.confidence, anchor.question_number))
    deduped: list[Anchor] = []
    for anchor in anchors:
        duplicate_index: int | None = None
        for index, existing in enumerate(deduped):
            if (
                existing.question_number == anchor.question_number
                and abs(existing.y - anchor.y) < 32
                and abs(existing.x - anchor.x) < 60
            ):
                duplicate_index = index
                break

        if duplicate_index is None:
            deduped.append(anchor)
        elif anchor.confidence > deduped[duplicate_index].confidence:
            deduped[duplicate_index] = anchor

    return sorted(deduped, key=lambda anchor: (anchor.y, anchor.x, anchor.question_number))


def detect_anchors(lines: list[TextLine], page: PageRender, layout: Layout, mask: np.ndarray) -> list[Anchor]:
    anchors = detect_anchors_in_column(lines, page, layout.left, mask)
    anchors.extend(detect_anchors_in_column(lines, page, layout.right, mask))
    return sorted(anchors, key=lambda anchor: (anchor.column, anchor.y, anchor.x))

def column_ink_bottom(mask: np.ndarray, column: Column, start_y: int) -> int:
    y1 = clamp(start_y, column.y1, column.y2 - 1)
    region = mask[y1:column.y2, column.x1:column.x2]
    if region.size == 0:
        return column.y2

    rows = np.where((region > 0).sum(axis=1) > max(4, int(column.width * 0.002)))[0]
    if len(rows) == 0:
        return min(column.y2, y1 + max(60, int(mask.shape[0] * 0.03)))

    return clamp(y1 + int(rows[-1]), y1 + 1, column.y2)


def anchors_inside_bbox(anchors: Iterable[Anchor], bbox: tuple[int, int, int, int]) -> list[Anchor]:
    x, y, width, height = bbox
    return [anchor for anchor in anchors if x <= anchor.x <= x + width and y <= anchor.y <= y + height]


def refine_bbox_to_ink(
    mask: np.ndarray,
    rough_bbox: tuple[int, int, int, int],
    column: Column,
    anchor: Anchor,
    next_anchor_y: int | None,
) -> tuple[int, int, int, int]:
    page_height, page_width = mask.shape
    x, y, width, height = rough_bbox
    region = mask[y : y + height, x : x + width]
    margin_x = max(32, int(page_width * 0.010))
    margin_y = max(38, int(page_height * 0.011))

    if region.size == 0:
        return rough_bbox

    rows = np.where((region > 0).sum(axis=1) > max(3, int(width * 0.0015)))[0]
    cols = np.where((region > 0).sum(axis=0) > max(3, int(height * 0.0015)))[0]
    if len(rows) == 0 or len(cols) == 0:
        return rough_bbox

    tight_x1 = min(anchor.x - margin_x, x + int(cols[0]) - margin_x)
    tight_x2 = x + int(cols[-1]) + margin_x
    tight_y1 = min(anchor.y - margin_y, y + int(rows[0]) - margin_y)
    tight_y2 = max(anchor.y + margin_y, y + int(rows[-1]) + margin_y)

    if next_anchor_y is not None:
        tight_y2 = min(tight_y2, next_anchor_y - max(14, margin_y // 3))

    final_x1 = clamp(tight_x1, column.x1, column.x2 - 1)
    final_x2 = clamp(tight_x2, final_x1 + 1, column.x2)
    final_y1 = clamp(tight_y1, column.y1, column.y2 - 1)
    final_y2 = clamp(tight_y2, final_y1 + 1, column.y2)
    return (final_x1, final_y1, final_x2 - final_x1, final_y2 - final_y1)


def classify_candidate(
    page: PageRender,
    mask: np.ndarray,
    layout: Layout,
    anchor: Anchor,
    bbox: tuple[int, int, int, int],
    anchors_inside: list[Anchor],
    large_area_threshold: float,
) -> tuple[str, float, list[str]]:
    x, y, width, height = bbox
    area_ratio = (width * height) / max(1, page.width * page.height)
    region = mask[y : y + height, x : x + width]
    ink_pixels = int((region > 0).sum()) if region.size else 0
    ink_density = ink_pixels / max(1, width * height)
    notes = anchor.notes + [f"anchor_question_{anchor.question_number}", f"column_{anchor.column}"]
    confidence = min(0.96, anchor.confidence + 0.04)
    status = "ok"

    if y < layout.header_y2:
        confidence -= 0.35
        notes.append("header_overlap_suspected")
        status = "rejected"

    if y + height > layout.footer_y1:
        confidence -= 0.20
        notes.append("footer_overlap_suspected")

    if x < layout.left.x1 or x + width > layout.right.x2:
        confidence -= 0.25
        notes.append("outside_layout_bounds")
        status = "rejected"

    if anchor.column == "left" and x + width > layout.left.x2 + 2:
        confidence -= 0.40
        notes.append("crosses_center_split")
        status = "rejected"
    if anchor.column == "right" and x < layout.right.x1 - 2:
        confidence -= 0.40
        notes.append("crosses_center_split")
        status = "rejected"

    if any(other.column != anchor.column for other in anchors_inside):
        confidence -= 0.50
        notes.append("cross_column_anchor_inside")
        status = "rejected"

    if len(anchors_inside) > 1:
        confidence -= 0.35
        notes.append("multiple_question_anchors_inside")
        status = "rejected"

    if area_ratio >= large_area_threshold and len(anchors_inside) <= 1:
        confidence -= 0.40
        notes.append("large_area_candidate")
        status = "rejected"
    elif area_ratio > 0.28:
        confidence -= 0.12
        notes.append("large_but_allowed_review")

    if ink_density < 0.0012:
        confidence -= 0.45
        notes.append("blank_or_low_ink_candidate")
        status = "rejected"

    if height < page.height * 0.025:
        confidence -= 0.25
        notes.append("very_short_candidate")
        status = "rejected"

    return status, round(max(0.05, min(0.98, confidence)), 2), notes


def create_candidates_for_column(
    page: PageRender,
    mask: np.ndarray,
    image: np.ndarray,
    layout: Layout,
    column: Column,
    column_anchors: list[Anchor],
    all_anchors: list[Anchor],
    run_dir: Path,
    start_index: int,
    large_area_threshold: float,
) -> tuple[list[Candidate], int]:
    candidates: list[Candidate] = []
    next_index = start_index
    if not column_anchors:
        return candidates, next_index

    margin_y = max(42, int(page.height * 0.012))
    column_anchors = sorted(column_anchors, key=lambda anchor: anchor.y)

    for index, anchor in enumerate(column_anchors):
        next_anchor = column_anchors[index + 1] if index + 1 < len(column_anchors) else None
        top = clamp(anchor.y - margin_y, column.y1, column.y2 - 1)
        if next_anchor:
            bottom = clamp(next_anchor.y - max(16, margin_y // 2), top + 1, column.y2)
            next_anchor_y = next_anchor.y
        else:
            bottom = clamp(column_ink_bottom(mask, column, anchor.y) + margin_y, top + 1, column.y2)
            next_anchor_y = None

        rough_bbox = (column.x1, top, column.width, bottom - top)
        bbox = refine_bbox_to_ink(mask, rough_bbox, column, anchor, next_anchor_y)
        inside = anchors_inside_bbox(all_anchors, bbox)
        status, confidence, notes = classify_candidate(
            page,
            mask,
            layout,
            anchor,
            bbox,
            inside,
            large_area_threshold,
        )

        candidate_id = f"q_{next_index:03d}"
        next_index += 1
        x, y, width, height = bbox
        crop = image[y : y + height, x : x + width]
        folder = "crops" if status == "ok" else "rejected_candidates"
        filename = f"{candidate_id}.png" if status == "ok" else f"{candidate_id}_rejected.png"
        output_path = run_dir / folder / filename
        imwrite(output_path, crop)

        candidates.append(
            Candidate(
                candidate_id=candidate_id,
                page_number=page.page_number,
                question_number_guess=anchor.question_number,
                bbox={"x": x, "y": y, "width": width, "height": height},
                confidence=confidence,
                notes=notes,
                status=status,
                output_path=str(output_path.relative_to(run_dir)).replace("\\", "/"),
            )
        )

    return candidates, next_index



def merge_ranges(ranges: list[tuple[int, int]], max_gap: int) -> list[tuple[int, int]]:
    if not ranges:
        return []

    merged = [ranges[0]]
    for start, end in ranges[1:]:
        prev_start, prev_end = merged[-1]
        if start - prev_end <= max_gap:
            merged[-1] = (prev_start, max(prev_end, end))
        else:
            merged.append((start, end))
    return merged


def bbox_for_candidate(candidate: Candidate) -> tuple[int, int, int, int]:
    bbox = candidate.bbox
    return (bbox["x"], bbox["y"], bbox["width"], bbox["height"])


def candidate_in_column(candidate: Candidate, column: Column) -> bool:
    x, _, width, _ = bbox_for_candidate(candidate)
    center_x = x + width // 2
    return column.x1 <= center_x <= column.x2


def overlap_ratio(a: tuple[int, int], b: tuple[int, int]) -> float:
    start = max(a[0], b[0])
    end = min(a[1], b[1])
    overlap = max(0, end - start)
    return overlap / max(1, a[1] - a[0])


def refine_unassigned_bbox_to_ink(
    mask: np.ndarray,
    rough_bbox: tuple[int, int, int, int],
    column: Column,
    page: PageRender,
) -> tuple[int, int, int, int] | None:
    x, y, width, height = rough_bbox
    region = mask[y : y + height, x : x + width]
    if region.size == 0:
        return None

    rows = np.where((region > 0).sum(axis=1) > max(4, int(width * 0.0015)))[0]
    cols = np.where((region > 0).sum(axis=0) > max(4, int(height * 0.0012)))[0]
    if len(rows) == 0 or len(cols) == 0:
        return None

    margin_x = max(34, int(page.width * 0.010))
    margin_y = max(42, int(page.height * 0.012))
    x1 = clamp(x + int(cols[0]) - margin_x, column.x1, column.x2 - 1)
    x2 = clamp(x + int(cols[-1]) + margin_x, x1 + 1, column.x2)
    y1 = clamp(y + int(rows[0]) - margin_y, column.y1, column.y2 - 1)
    y2 = clamp(y + int(rows[-1]) + margin_y, y1 + 1, column.y2)
    return (x1, y1, x2 - x1, y2 - y1)


def create_unassigned_regions_for_column(
    page: PageRender,
    mask: np.ndarray,
    image: np.ndarray,
    column: Column,
    existing_candidates: list[Candidate],
    run_dir: Path,
    start_index: int,
    large_area_threshold: float,
) -> tuple[list[Candidate], int]:
    next_index = start_index
    column_region = mask[column.y1 : column.y2, column.x1 : column.x2]
    if column_region.size == 0:
        return [], next_index

    row_counts = (column_region > 0).sum(axis=1)
    row_threshold = max(7, int(column.width * 0.002))
    active = rolling_mean(row_counts, max(7, int(page.height * 0.002))) > row_threshold
    ranges = [(column.y1 + start, column.y1 + end) for start, end in ranges_from_bool(active)]
    ranges = merge_ranges(ranges, max_gap=max(42, int(page.height * 0.014)))

    covered = [
        (candidate.bbox["y"], candidate.bbox["y"] + candidate.bbox["height"])
        for candidate in existing_candidates
        if candidate.page_number == page.page_number and candidate_in_column(candidate, column)
    ]

    candidates: list[Candidate] = []
    min_height = max(85, int(page.height * 0.028))
    min_ink_pixels = max(260, int(column.width * min_height * 0.0012))

    for start, end in ranges:
        height = end - start
        if height < min_height:
            continue

        if any(overlap_ratio((start, end), covered_range) > 0.58 for covered_range in covered):
            continue

        rough_bbox = (column.x1, start, column.width, height)
        refined = refine_unassigned_bbox_to_ink(mask, rough_bbox, column, page)
        if refined is None:
            continue

        x, y, width, refined_height = refined
        refined_region = mask[y : y + refined_height, x : x + width]
        ink_pixels = int((refined_region > 0).sum()) if refined_region.size else 0
        if ink_pixels < min_ink_pixels:
            continue

        area_ratio = (width * refined_height) / max(1, page.width * page.height)
        ink_density = ink_pixels / max(1, width * refined_height)
        if ink_density < 0.0011:
            continue

        candidate_id = f"u_{next_index:03d}"
        next_index += 1
        notes = ["unassigned_ink_region_without_anchor", "recall_safety_candidate", f"column_{column.name}"]
        confidence = 0.46
        if area_ratio >= large_area_threshold:
            confidence -= 0.08
            notes.append("large_area_candidate")
        if refined_height > page.height * 0.20:
            confidence -= 0.05
            notes.append("tall_unassigned_region_review")

        crop = image[y : y + refined_height, x : x + width]
        output_path = run_dir / "unassigned_regions" / f"{candidate_id}_page_{page.page_number:03d}_{column.name}.png"
        imwrite(output_path, crop)

        candidate = Candidate(
            candidate_id=candidate_id,
            page_number=page.page_number,
            question_number_guess=None,
            bbox={"x": x, "y": y, "width": width, "height": refined_height},
            confidence=round(max(0.05, min(0.75, confidence)), 2),
            notes=notes,
            status="unassigned",
            output_path=str(output_path.relative_to(run_dir)).replace("\\", "/"),
        )
        candidates.append(candidate)
        covered.append((y, y + refined_height))

    return candidates, next_index

def save_failed_page(page: PageRender, run_dir: Path, reason: str) -> None:
    image = imread(page.path)
    cv2.putText(
        image,
        reason,
        (60, 120),
        cv2.FONT_HERSHEY_SIMPLEX,
        1.3,
        (0, 0, 255),
        4,
        cv2.LINE_AA,
    )
    imwrite(run_dir / "failed_pages" / f"page_{page.page_number:03d}_failed.png", image)


def draw_layout_debug(page: PageRender, layout: Layout, anchors: list[Anchor], run_dir: Path) -> None:
    image = imread(page.path)
    overlay = image.copy()
    cv2.rectangle(overlay, (0, 0), (page.width, layout.header_y2), (0, 0, 255), -1)
    cv2.rectangle(overlay, (0, layout.footer_y1), (page.width, page.height), (0, 0, 255), -1)
    image = cv2.addWeighted(overlay, 0.18, image, 0.82, 0)

    cv2.rectangle(image, (layout.left.x1, layout.left.y1), (layout.left.x2, layout.left.y2), (255, 150, 0), 5)
    cv2.rectangle(image, (layout.right.x1, layout.right.y1), (layout.right.x2, layout.right.y2), (0, 180, 255), 5)
    cv2.line(image, (layout.split_x, layout.header_y2), (layout.split_x, layout.footer_y1), (0, 255, 255), 5)

    cv2.putText(image, "HEADER EXCLUDE", (50, max(60, layout.header_y2 // 2)), cv2.FONT_HERSHEY_SIMPLEX, 1.3, (0, 0, 180), 4)
    cv2.putText(image, "FOOTER EXCLUDE", (50, min(page.height - 50, layout.footer_y1 + 75)), cv2.FONT_HERSHEY_SIMPLEX, 1.3, (0, 0, 180), 4)
    cv2.putText(image, f"split: {layout.split_source}", (50, layout.header_y2 + 60), cv2.FONT_HERSHEY_SIMPLEX, 1.1, (0, 120, 120), 3)

    for anchor in anchors:
        color = (0, 0, 255) if anchor.column == "left" else (255, 0, 255)
        cv2.circle(image, (anchor.x, anchor.y), 18, color, 4)
        label = f"{anchor.question_number}. {anchor.column} {anchor.confidence:.2f}"
        cv2.putText(image, label, (anchor.x + 22, max(layout.header_y2 + 28, anchor.y - 12)), cv2.FONT_HERSHEY_SIMPLEX, 0.9, color, 3, cv2.LINE_AA)

    imwrite(run_dir / "layout_debug" / f"page_{page.page_number:03d}_layout.png", image)


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
        "status": candidate.status,
        "output_path": candidate.output_path,
    }


def markdown_list(items: Iterable[str]) -> str:
    lines = [f"- {item}" for item in items]
    return "\n".join(lines) if lines else "- 없음"


def load_contact_sheet_font(size: int) -> ImageFont.ImageFont:
    for font_name in ("malgun.ttf", "arial.ttf"):
        try:
            return ImageFont.truetype(font_name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def wrap_text(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont, max_width: int) -> list[str]:
    words = text.split()
    if not words:
        return [""]

    lines: list[str] = []
    current = words[0]
    for word in words[1:]:
        test = f"{current} {word}"
        bbox = draw.textbbox((0, 0), test, font=font)
        if bbox[2] - bbox[0] <= max_width:
            current = test
        else:
            lines.append(current)
            current = word
    lines.append(current)
    return lines



def write_contact_sheet_pdf(
    run_dir: Path,
    candidates: list[Candidate],
    detected_numbers: list[int],
    missing_numbers: list[int],
    duplicate_numbers: list[int],
    rejected_count: int,
    unassigned_count: int,
) -> None:
    page_width = 1654
    page_height = 2339
    margin = 70
    gutter = 35
    columns = 2
    rows = 3
    per_page = columns * rows
    cell_width = (page_width - margin * 2 - gutter) // columns
    cell_height = (page_height - margin * 2 - gutter * 2) // rows
    label_height = 170
    image_padding = 12
    title_font = load_contact_sheet_font(28)
    note_font = load_contact_sheet_font(21)
    summary_font = load_contact_sheet_font(26)
    pages: list[Image.Image] = []

    sorted_candidates = sorted(
        candidates,
        key=lambda candidate: (
            candidate.page_number,
            candidate.bbox["y"],
            candidate.bbox["x"],
            candidate.candidate_id,
        ),
    )
    if not sorted_candidates:
        page = Image.new("RGB", (page_width, page_height), "white")
        draw = ImageDraw.Draw(page)
        draw.text((margin, margin), "No crop candidates generated.", fill="black", font=title_font)
        pages.append(page)
    else:
        for page_start in range(0, len(sorted_candidates), per_page):
            page_candidates = sorted_candidates[page_start : page_start + per_page]
            page = Image.new("RGB", (page_width, page_height), "white")
            draw = ImageDraw.Draw(page)

            for index, candidate in enumerate(page_candidates):
                row = index // columns
                col = index % columns
                x = margin + col * (cell_width + gutter)
                y = margin + row * (cell_height + gutter)
                image_box_height = cell_height - label_height
                outline = (60, 150, 85) if candidate.status == "ok" else (210, 150, 60)
                if candidate.status == "unassigned":
                    outline = (65, 105, 190)
                draw.rectangle((x, y, x + cell_width, y + cell_height), outline=outline, width=3)

                image_path = run_dir / candidate.output_path
                try:
                    crop_image = Image.open(image_path).convert("RGB")
                    crop_image.thumbnail(
                        (cell_width - image_padding * 2, image_box_height - image_padding * 2),
                        Image.Resampling.LANCZOS,
                    )
                    image_x = x + (cell_width - crop_image.width) // 2
                    image_y = y + image_padding + max(0, (image_box_height - crop_image.height) // 2)
                    page.paste(crop_image, (image_x, image_y))
                except OSError:
                    draw.text((x + image_padding, y + image_padding), "image load failed", fill=(180, 0, 0), font=note_font)

                label_y = y + image_box_height + 10
                title = (
                    f"{candidate.candidate_id} | page {candidate.page_number} | "
                    f"q={candidate.question_number_guess} | {candidate.status} | conf={candidate.confidence:.2f}"
                )
                draw.text((x + image_padding, label_y), title, fill="black", font=title_font)
                note_text = "notes: " + (", ".join(candidate.notes) if candidate.notes else "none")
                for line_index, line in enumerate(wrap_text(draw, note_text, note_font, cell_width - image_padding * 2)[:4]):
                    draw.text(
                        (x + image_padding, label_y + 36 + line_index * 27),
                        line,
                        fill=(70, 70, 70),
                        font=note_font,
                    )

            pages.append(page)

    summary_page = Image.new("RGB", (page_width, page_height), "white")
    draw = ImageDraw.Draw(summary_page)
    summary_lines = [
        "Crop Benchmark V4 Contact Sheet Summary",
        f"detected question numbers: {', '.join(map(str, detected_numbers)) or 'none'}",
        f"missing question numbers guess: {', '.join(map(str, missing_numbers)) or 'none'}",
        f"duplicate question numbers: {', '.join(map(str, duplicate_numbers)) or 'none'}",
        f"rejected candidate count: {rejected_count}",
        f"unassigned region count: {unassigned_count}",
    ]
    y = margin
    for line in summary_lines:
        for wrapped in wrap_text(draw, line, summary_font, page_width - margin * 2):
            draw.text((margin, y), wrapped, fill="black", font=summary_font)
            y += 42
        y += 14
    pages.append(summary_page)

    contact_sheet_path = run_dir / "contact_sheet.pdf"
    first, *rest = pages
    first.save(contact_sheet_path, "PDF", save_all=True, append_images=rest, resolution=150.0)


def sequence_report(anchors: list[Anchor], expected_count: int | None) -> tuple[list[int], list[int], list[int]]:
    counts = Counter(anchor.question_number for anchor in anchors)
    detected_numbers = sorted(counts)
    duplicate_numbers = sorted(number for number, count in counts.items() if count > 1)
    if expected_count is None:
        return detected_numbers, [], duplicate_numbers
    missing_numbers = [number for number in range(1, expected_count + 1) if number not in counts]
    return detected_numbers, missing_numbers, duplicate_numbers


def write_outputs(
    run_dir: Path,
    input_pdf: Path,
    dpi: int,
    pages: list[PageRender],
    anchors: list[Anchor],
    candidates: list[Candidate],
    failed_pages: list[int],
    expected_count: int | None,
) -> None:
    normal = [candidate for candidate in candidates if candidate.status == "ok"]
    rejected = [candidate for candidate in candidates if candidate.status == "rejected"]
    unassigned = [candidate for candidate in candidates if candidate.status == "unassigned"]
    multiple_anchor = [candidate for candidate in candidates if "multiple_question_anchors_inside" in candidate.notes]
    large_area = [candidate for candidate in candidates if "large_area_candidate" in candidate.notes]
    header_overlap = [candidate for candidate in candidates if "header_overlap_suspected" in candidate.notes]
    cross_column = [candidate for candidate in candidates if "cross_column_anchor_inside" in candidate.notes or "crosses_center_split" in candidate.notes]
    blank_or_low_ink = [candidate for candidate in candidates if "blank_or_low_ink_candidate" in candidate.notes]
    per_page = Counter(candidate.page_number for candidate in candidates)
    detected_numbers, missing_numbers, duplicate_numbers = sequence_report(anchors, expected_count)

    (run_dir / "anchors_debug.json").write_text(
        json.dumps(
            {
                "input_pdf": str(input_pdf),
                "dpi": dpi,
                "method": "v4_layout_first_relaxed_anchor_recall",
                "expected_count": expected_count,
                "detected_anchor_count": len(anchors),
                "detected_question_numbers": detected_numbers,
                "missing_question_numbers_guess": missing_numbers,
                "duplicate_question_numbers": duplicate_numbers,
                "anchors": [anchor_to_json(anchor) for anchor in anchors],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    (run_dir / "crop_coordinates.json").write_text(
        json.dumps(
            {
                "input_pdf": str(input_pdf),
                "dpi": dpi,
                "method": "v4_layout_first_relaxed_anchor_recall",
                "coordinate_system": "pixel coordinates on rendered page PNGs",
                "page_count": len(pages),
                "expected_count": expected_count,
                "detected_anchor_count": len(anchors),
                "generated_crop_count": len(normal),
                "rejected_candidate_count": len(rejected),
                "unassigned_region_count": len(unassigned),
                "detected_question_numbers": detected_numbers,
                "missing_question_numbers_guess": missing_numbers,
                "duplicate_question_numbers": duplicate_numbers,
                "candidates": [candidate_to_json(candidate) for candidate in candidates],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    summary = f"""# Crop Benchmark V4 Summary

## 기본 정보
- 입력 PDF명: `{input_pdf.name}`
- 입력 PDF 경로: `{input_pdf}`
- 출력 폴더: `{run_dir}`
- 렌더링 DPI: {dpi}
- 페이지 수: {len(pages)}
- expected_count: {expected_count if expected_count is not None else "not provided"}
- detected_anchor_count: {len(anchors)}
- generated_crop_count: {len(normal)}
- rejected_candidate_count: {len(rejected)}
- unassigned_region_count: {len(unassigned)}
- failed_pages count: {len(set(failed_pages))}

## 문항 번호 sequence 검사
- detected question numbers: {", ".join(map(str, detected_numbers)) if detected_numbers else "none"}
- missing_question_numbers_guess: {", ".join(map(str, missing_numbers)) if missing_numbers else "none"}
- duplicate_question_numbers: {", ".join(map(str, duplicate_numbers)) if duplicate_numbers else "none"}

## 페이지별 후보 수
{markdown_list([f"page_{page.page_number:03d}: total {per_page.get(page.page_number, 0)} candidates" for page in pages])}

## failed_pages
{markdown_list([f"page_{page_number:03d}" for page_number in sorted(set(failed_pages))])}

## rejected_candidates 주요 목록
{markdown_list([f"{candidate.candidate_id} page {candidate.page_number} q{candidate.question_number_guess} confidence {candidate.confidence} notes: {', '.join(candidate.notes)}" for candidate in rejected])}

## unassigned_regions 주요 목록
{markdown_list([f"{candidate.candidate_id} page {candidate.page_number} confidence {candidate.confidence} notes: {', '.join(candidate.notes)}" for candidate in unassigned])}

## multiple anchor 포함 후보
{markdown_list([f"{candidate.candidate_id} page {candidate.page_number} q{candidate.question_number_guess}" for candidate in multiple_anchor])}

## large area 후보
{markdown_list([f"{candidate.candidate_id} page {candidate.page_number} q{candidate.question_number_guess}" for candidate in large_area])}

## header overlap 의심 후보
{markdown_list([f"{candidate.candidate_id} page {candidate.page_number} q{candidate.question_number_guess}" for candidate in header_overlap])}

## 좌우 column 섞임 의심 후보
{markdown_list([f"{candidate.candidate_id} page {candidate.page_number} q{candidate.question_number_guess}" for candidate in cross_column])}

## 빈 영역/header-only 의심 후보
{markdown_list([f"{candidate.candidate_id} page {candidate.page_number} q{candidate.question_number_guess}" for candidate in blank_or_low_ink])}

## v4 개선 의도
- v3의 header hard exclude (default 10%), footer exclude, left/right column boundary, center split 방어를 유지합니다.
- 문항 번호 anchor 탐지 패턴을 `1.`, `1)`, `1 `, `17.[서답형1]`, `17) [서답형1]`, `17 [서답형1]`, `[서답형 1]`까지 넓혔습니다.
- anchor가 column 왼쪽 경계 근처인지, line start인지, 본문과 비슷한 글자 크기인지, 아래에 충분한 text/ink가 있는지 함께 봅니다.
- anchor가 없는 구간이라도 column 내부에 큰 ink 영역이 남아 있으면 `unassigned_regions/`에 보존합니다. 누락 문항 후보를 빠르게 확인하기 위한 recall 안전장치입니다.
- `--expected-count`가 있으면 탐지된 문항 번호와 누락 의심 번호를 sequence로 비교합니다.

## Holic A/B/C 평가 기준
- A: 바로 사용 가능. 한 문항이 온전히 들어오고 보기, 도형, 그래프, 표가 빠지지 않으며 header/footer가 거의 없음.
- B: 약간 보정하면 사용 가능. 문항은 들어왔지만 여백이 과하거나 페이지선/경계가 조금 섞임.
- C: 실패. 문항이 잘리거나, 좌우 column 문항이 섞이거나, header-only/blank/large-area 후보임.

목표는 A+B 95% 이상입니다. 이번 v4는 precision을 조금 희생하더라도 recall을 높이는 것이 우선입니다.

## 빠른 검수 순서
1. `contact_sheet.pdf`를 열어 일반 crops와 unassigned 후보를 함께 A/B/C로 평가합니다.
2. `summary.md`의 `missing_question_numbers_guess`가 실제 누락과 맞는지 봅니다.
3. `layout_debug/page_###_layout.png`에서 header/footer exclusion과 좌우 column boundary가 맞는지 확인합니다.
4. `anchors_debug.json`에서 느슨한 anchor가 footnote를 잘못 잡지 않았는지 확인합니다.
5. `unassigned_regions/`에 실제 누락 문항이 들어왔는지 확인합니다.

## 실행 방법
```powershell
.\\.venv-crop\\Scripts\\python.exe scripts\\crop_benchmark_v4.py --input crop_inputs\\sample.pdf --expected-count 22
```

## 이번 단계에서 하지 않는 것
- OpenAI API 사용
- 로컬 LLM 사용
- Supabase 업로드
- 웹앱 UI 통합
- 문항 DB 저장
- 자동 해설 생성
"""
    (run_dir / "summary.md").write_text(summary, encoding="utf-8")
    write_contact_sheet_pdf(
        run_dir,
        candidates,
        detected_numbers,
        missing_numbers,
        duplicate_numbers,
        len(rejected),
        len(unassigned),
    )


def run(
    input_pdf: Path,
    output_root: Path,
    dpi: int,
    header_ratio: float,
    footer_ratio: float,
    large_area_threshold: float,
    expected_count: int | None,
) -> Path:
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
    next_unassigned_index = 1

    for page in pages:
        image = imread(page.path)
        mask = build_ink_mask(image)
        layout = build_layout(mask, page, header_ratio, footer_ratio)
        page_lines = lines_by_page.get(page.page_number, [])
        page_anchors = detect_anchors(page_lines, page, layout, mask)
        all_anchors.extend(page_anchors)
        draw_layout_debug(page, layout, page_anchors, run_dir)

        if not page_anchors:
            failed_pages.append(page.page_number)
            save_failed_page(page, run_dir, "no_question_anchor_after_layout_split")

        for column in (layout.left, layout.right):
            column_anchors = [anchor for anchor in page_anchors if anchor.column == column.name]
            column_candidates, next_candidate_index = create_candidates_for_column(
                page=page,
                mask=mask,
                image=image,
                layout=layout,
                column=column,
                column_anchors=column_anchors,
                all_anchors=page_anchors,
                run_dir=run_dir,
                start_index=next_candidate_index,
                large_area_threshold=large_area_threshold,
            )
            all_candidates.extend(column_candidates)

        for column in (layout.left, layout.right):
            existing_column_candidates = [
                candidate
                for candidate in all_candidates
                if candidate.page_number == page.page_number and candidate_in_column(candidate, column)
            ]
            unassigned_candidates, next_unassigned_index = create_unassigned_regions_for_column(
                page=page,
                mask=mask,
                image=image,
                column=column,
                existing_candidates=existing_column_candidates,
                run_dir=run_dir,
                start_index=next_unassigned_index,
                large_area_threshold=large_area_threshold,
            )
            all_candidates.extend(unassigned_candidates)

        if not any(candidate.page_number == page.page_number and candidate.status == "ok" for candidate in all_candidates):
            failed_pages.append(page.page_number)

    write_outputs(run_dir, input_pdf, dpi, pages, all_anchors, all_candidates, failed_pages, expected_count)
    return run_dir


def main() -> None:
    args = parse_args()
    run_dir = run(
        input_pdf=args.input,
        output_root=args.output_root,
        dpi=args.dpi,
        header_ratio=args.header_ratio,
        footer_ratio=args.footer_ratio,
        large_area_threshold=args.large_area_threshold,
        expected_count=args.expected_count,
    )
    print(f"Crop benchmark v4 complete: {run_dir}")
    print(f"- pages: {run_dir / 'pages'}")
    print(f"- crops: {run_dir / 'crops'}")
    print(f"- rejected_candidates: {run_dir / 'rejected_candidates'}")
    print(f"- unassigned_regions: {run_dir / 'unassigned_regions'}")
    print(f"- failed_pages: {run_dir / 'failed_pages'}")
    print(f"- layout_debug: {run_dir / 'layout_debug'}")
    print(f"- anchors_debug.json: {run_dir / 'anchors_debug.json'}")
    print(f"- coordinates: {run_dir / 'crop_coordinates.json'}")
    print(f"- summary: {run_dir / 'summary.md'}")
    print(f"- contact_sheet: {run_dir / 'contact_sheet.pdf'}")


if __name__ == "__main__":
    main()

