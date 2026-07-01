"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Copy } from "lucide-react";

import { createLessonRecord } from "@/app/protected/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const ERROR_TAGS = [
  "조건 해석",
  "경우 누락",
  "계산 실수",
  "부등호 방향",
  "정수조건",
  "그래프 해석",
  "식 변형 목적 부족",
  "문제 독해 오류",
  "개념 기억 부족",
  "풀이 전략 부재",
  "검산 부족",
  "시간 관리 실패",
];

function splitTags(value: string) {
  return value
    .split(/[,\n]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function uniqueTags(tags: string[]) {
  return Array.from(new Set(tags));
}

export function LessonRecordForm({
  defaultDate,
  studentId,
}: {
  defaultDate: string;
  studentId: string;
}) {
  const [lessonDate, setLessonDate] = useState(defaultDate);
  const [topic, setTopic] = useState("");
  const [content, setContent] = useState("");
  const [strengths, setStrengths] = useState("");
  const [weaknessText, setWeaknessText] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [homework, setHomework] = useState("");
  const [nextPlan, setNextPlan] = useState("");
  const [parentNote, setParentNote] = useState("");
  const [internalMemo, setInternalMemo] = useState("");
  const [copied, setCopied] = useState(false);

  const combinedTags = useMemo(
    () => uniqueTags([...splitTags(weaknessText), ...selectedTags]),
    [selectedTags, weaknessText],
  );

  const parentDraft = useMemo(() => {
    const draftTopic = topic.trim() || "오늘 수업";
    const lines = [`안녕하세요. 오늘은 ${draftTopic} 단원을 중심으로 수업했습니다.`];

    if (content.trim()) {
      lines.push(`오늘 다룬 내용은 ${content.trim()}입니다.`);
    }

    if (strengths.trim()) {
      lines.push(`좋았던 점은 ${strengths.trim()}입니다.`);
    }

    if (combinedTags.length > 0) {
      lines.push(`반복해서 점검할 부분은 ${combinedTags.join(", ")}입니다.`);
    }

    if (parentNote.trim()) {
      lines.push(parentNote.trim());
    }

    if (homework.trim()) {
      lines.push(`과제는 ${homework.trim()}입니다.`);
    }

    if (nextPlan.trim()) {
      lines.push(`다음 수업에서는 ${nextPlan.trim()}을 우선 확인하겠습니다.`);
    }

    return lines.join("\n");
  }, [combinedTags, content, homework, nextPlan, parentNote, strengths, topic]);

  function toggleTag(tag: string) {
    setSelectedTags((current) =>
      current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag],
    );
  }

  async function copyDraft() {
    await navigator.clipboard.writeText(parentDraft);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Card className="rounded-lg" id="new-lesson">
      <CardHeader>
        <CardTitle>새 수업 기록</CardTitle>
        <CardDescription>
          수업 직후 빠르게 남기는 기록입니다. 선생님 내부 메모는 학부모 피드백에 포함되지 않습니다.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={createLessonRecord.bind(null, studentId)} className="grid gap-6">
          <input name="weakness_tags" type="hidden" value={combinedTags.join(", ")} />

          <div className="grid gap-4 md:grid-cols-[180px_1fr]">
            <div className="space-y-2">
              <Label htmlFor="lesson_date">수업 날짜</Label>
              <Input
                id="lesson_date"
                name="lesson_date"
                onChange={(event) => setLessonDate(event.target.value)}
                required
                type="date"
                value={lessonDate}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="topic">수업 단원</Label>
              <Input
                id="topic"
                name="topic"
                onChange={(event) => setTopic(event.target.value)}
                placeholder="예: 이차함수의 그래프, 확률과 경우의 수"
                required
                value={topic}
              />
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="content">오늘 다룬 내용</Label>
              <Textarea
                className="min-h-28"
                id="content"
                name="content"
                onChange={(event) => setContent(event.target.value)}
                placeholder="핵심 개념, 대표 문제, 풀이 흐름을 짧게 적어주세요."
                value={content}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="strengths">학생이 잘한 점</Label>
              <Textarea
                className="min-h-28"
                id="strengths"
                name="strengths"
                onChange={(event) => setStrengths(event.target.value)}
                placeholder="예: 그래프 개형 판단이 빨라졌고, 조건을 식으로 옮기는 과정이 안정적이었습니다."
                value={strengths}
              />
            </div>
          </div>

          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="weakness_text">반복 약점</Label>
              <Textarea
                className="min-h-24"
                id="weakness_text"
                onChange={(event) => setWeaknessText(event.target.value)}
                placeholder="직접 적거나 아래 태그를 눌러 추가하세요. 쉼표 또는 줄바꿈으로 여러 개 입력할 수 있습니다."
                value={weaknessText}
              />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">오답 유형 태그</p>
              <div className="flex flex-wrap gap-2">
                {ERROR_TAGS.map((tag) => {
                  const selected = selectedTags.includes(tag);
                  return (
                    <button
                      aria-pressed={selected}
                      className={cn(
                        "min-h-9 rounded-md border px-3 py-1.5 text-sm font-medium transition",
                        selected
                          ? "border-foreground bg-foreground text-background"
                          : "border-border bg-background text-foreground hover:bg-muted",
                      )}
                      key={tag}
                      onClick={() => toggleTag(tag)}
                      type="button"
                    >
                      {tag}
                    </button>
                  );
                })}
              </div>
            </div>
            {combinedTags.length > 0 ? (
              <p className="text-sm text-muted-foreground">저장될 약점: {combinedTags.join(", ")}</p>
            ) : null}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="homework">숙제</Label>
              <Textarea
                className="min-h-24"
                id="homework"
                name="homework"
                onChange={(event) => setHomework(event.target.value)}
                placeholder="예: 쎈 B단계 45-52번, 오답 노트 3문항 다시 풀기"
                value={homework}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="next_plan">다음 수업 우선순위</Label>
              <Textarea
                className="min-h-24"
                id="next_plan"
                name="next_plan"
                onChange={(event) => setNextPlan(event.target.value)}
                placeholder="예: 조건 누락이 많은 함수 활용 문제를 먼저 점검"
                value={nextPlan}
              />
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="parent_note">학부모 전달 메모</Label>
              <Textarea
                className="min-h-28"
                id="parent_note"
                name="parent_note"
                onChange={(event) => setParentNote(event.target.value)}
                placeholder="학부모님께 꼭 전달할 생활 태도, 과제 상태, 시험 대비 포인트를 적어주세요."
                value={parentNote}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="internal_memo">선생님 내부 메모</Label>
              <Textarea
                className="min-h-28"
                id="internal_memo"
                name="internal_memo"
                onChange={(event) => setInternalMemo(event.target.value)}
                placeholder="수업료, 일정 조율, 민감한 관찰 등 내부용 메모만 적어주세요."
                value={internalMemo}
              />
              {internalMemo.trim() ? (
                <p className="text-xs text-muted-foreground">이 내용은 학부모 피드백 초안에 들어가지 않습니다.</p>
              ) : null}
            </div>
          </div>

          <div className="rounded-lg border bg-muted/30 p-4">
            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium">학부모 피드백 초안</p>
                <p className="text-sm text-muted-foreground">입력한 공개용 내용만 모아 복사하기 좋게 정리합니다.</p>
              </div>
              <Button className="w-full sm:w-auto" onClick={copyDraft} type="button" variant="outline">
                {copied ? <CheckCircle2 className="size-4" /> : <Copy className="size-4" />}
                {copied ? "복사됨" : "복사"}
              </Button>
            </div>
            <Textarea className="min-h-40 bg-background" readOnly value={parentDraft} />
          </div>

          <div className="flex justify-end">
            <Button className="w-full sm:w-auto" size="lg" type="submit">
              수업 기록 저장
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
