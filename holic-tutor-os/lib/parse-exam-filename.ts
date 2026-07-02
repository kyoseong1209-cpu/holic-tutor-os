export type ParsedExamFilename = {
  school: string | null;
  grade: string | null;
  year: number | null;
  semester: string | null;
  exam_name: string | null;
  subject: string | null;
  unit_scope: string | null;
  exam_sections: string[];
  file_kind: string | null;
  confidence: number;
  warnings: string[];
};

const SUBJECTS = [
  "확률과통계",
  "확률과 통계",
  "공통수학1",
  "공통수학2",
  "공통수학",
  "미적분",
  "기하",
  "대수",
  "수학",
];

const FILE_KINDS = ["문제", "해설", "정답"];
const SECTION_KEYWORDS = ["선택", "공통", "서답형", "객관식"];

function withoutExtension(fileName: string) {
  return fileName
    .split(/[\\/]/)
    .filter(Boolean)
    .at(-1)
    ?.replace(/\.[^.]+$/, "") ?? fileName;
}

function splitTokens(fileName: string) {
  return withoutExtension(fileName)
    .split(/[_\s]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function normalizeSubject(value: string) {
  return value.replace(/\s+/g, "");
}

function isHighSchoolName(school: string | null) {
  if (!school) return false;
  return /고등학교|여고|남고|고$/.test(school);
}

function isMiddleSchoolName(school: string | null) {
  if (!school) return false;
  return /중학교|중$/.test(school);
}

function parseGrade(token: string, school: string | null) {
  const direct = token.match(/^(고|중)\s*([1-3])$/);
  if (direct) return `${direct[1]}${direct[2]}`;

  const gradeOnly = token.match(/^([1-3])학년$/);
  if (!gradeOnly) return null;

  if (isHighSchoolName(school)) return `고${gradeOnly[1]}`;
  if (isMiddleSchoolName(school)) return `중${gradeOnly[1]}`;
  return `${gradeOnly[1]}학년`;
}

function parseYear(token: string) {
  return /^\d{4}$/.test(token) ? Number.parseInt(token, 10) : null;
}

function parseSemester(token: string) {
  const match = token.match(/([12])학기/);
  return match ? `${match[1]}학기` : null;
}

function parseExamName(token: string) {
  if (token.includes("중간")) return "중간고사";
  if (token.includes("기말")) return "기말고사";
  return null;
}

function parseFileKind(token: string) {
  return FILE_KINDS.find((kind) => token.includes(kind)) ?? null;
}

function parseSections(token: string) {
  if (SUBJECTS.some((subject) => normalizeSubject(subject) === normalizeSubject(token))) {
    return [];
  }

  const parts = token
    .split(/[,，\/]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  return parts.filter((part) => {
    const compact = normalizeSubject(part);
    return SECTION_KEYWORDS.some(
      (keyword) => compact === keyword || (keyword !== "공통" && compact.startsWith(keyword)),
    );
  });
}

function findSubject(token: string) {
  const normalized = normalizeSubject(token);
  return SUBJECTS.find((subject) => normalizeSubject(subject) === normalized) ?? null;
}

function isKnownMetadataToken(token: string, school: string | null) {
  return Boolean(
    parseGrade(token, school) ||
      parseYear(token) ||
      parseSemester(token) ||
      parseExamName(token) ||
      parseFileKind(token) ||
      findSubject(token) ||
      parseSections(token).length > 0,
  );
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function score(parsed: Omit<ParsedExamFilename, "confidence" | "warnings">) {
  let value = 0.18;
  if (parsed.school) value += 0.12;
  if (parsed.grade) value += 0.1;
  if (parsed.year) value += 0.12;
  if (parsed.semester) value += 0.1;
  if (parsed.exam_name) value += 0.12;
  if (parsed.subject) value += 0.12;
  if (parsed.file_kind) value += 0.08;
  if (parsed.exam_sections.length > 0) value += 0.04;
  if (parsed.unit_scope) value += 0.04;

  return Math.min(1, Number(value.toFixed(2)));
}

export function parseExamFilename(sourceName: string): ParsedExamFilename {
  const tokens = splitTokens(sourceName);
  let school: string | null = null;
  let grade: string | null = null;
  let year: number | null = null;
  let semester: string | null = null;
  let exam_name: string | null = null;
  let subject: string | null = null;
  let file_kind: string | null = null;
  const examSections: string[] = [];
  const unitScopeTokens: string[] = [];
  let subjectIndex = -1;

  const firstMetadataIndex = tokens.findIndex((token) =>
    Boolean(
      parseGrade(token, null) ||
        parseYear(token) ||
        parseSemester(token) ||
        parseExamName(token) ||
        findSubject(token) ||
        parseFileKind(token) ||
        parseSections(token).length > 0,
    ),
  );

  if (firstMetadataIndex > 0) {
    school = tokens.slice(0, firstMetadataIndex).join("_");
  } else if (tokens.length > 0 && !isKnownMetadataToken(tokens[0], null)) {
    school = tokens[0];
  }

  tokens.forEach((token, index) => {
    grade = grade ?? parseGrade(token, school);
    year = year ?? parseYear(token);
    semester = semester ?? parseSemester(token);
    exam_name = exam_name ?? parseExamName(token);
    file_kind = file_kind ?? parseFileKind(token);

    const tokenSubject = findSubject(token);
    if (!subject && tokenSubject) {
      subject = tokenSubject;
      subjectIndex = index;
    }

    examSections.push(...parseSections(token));
  });

  tokens.forEach((token, index) => {
    if (subjectIndex < 0 || index <= subjectIndex) return;
    if (parseFileKind(token)) return;
    if (parseSections(token).length > 0) return;
    if (parseSemester(token) || parseExamName(token) || parseYear(token) || parseGrade(token, school)) return;
    if (findSubject(token)) return;
    unitScopeTokens.push(token);
  });

  const parsedBase = {
    school,
    grade,
    year,
    semester,
    exam_name,
    subject,
    unit_scope: unitScopeTokens.length > 0 ? unitScopeTokens.join("_") : null,
    exam_sections: unique(examSections),
    file_kind,
  };
  const warnings: string[] = [];

  if (!parsedBase.school) warnings.push("학교명을 확인해 주세요.");
  if (!parsedBase.grade) warnings.push("학년을 확인해 주세요.");
  if (!parsedBase.year) warnings.push("연도를 확인해 주세요.");
  if (!parsedBase.semester) warnings.push("학기를 확인해 주세요.");
  if (!parsedBase.exam_name) warnings.push("시험명을 확인해 주세요.");
  if (!parsedBase.subject) warnings.push("과목을 확인해 주세요.");
  if (!parsedBase.file_kind) warnings.push("문제/해설/정답 여부를 확인해 주세요.");

  return {
    ...parsedBase,
    confidence: score(parsedBase),
    warnings,
  };
}

export function metadataConfidenceLabel(confidence: number) {
  if (confidence >= 0.82) return "높음";
  if (confidence >= 0.58) return "보통";
  return "낮음";
}
