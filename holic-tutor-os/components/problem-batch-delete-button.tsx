"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

import { deleteProblemCandidateBatch } from "@/app/protected/problem-candidates/actions";
import { Button } from "@/components/ui/button";

const CONFIRM_MESSAGE =
  "이 가져오기 묶음을 삭제할까요? 포함된 후보와 업로드 이미지도 함께 삭제됩니다. 이 작업은 되돌릴 수 없습니다.";

export function ProblemBatchDeleteButton({
  batchId,
  batchName,
}: {
  batchId: string;
  batchName: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function handleDelete() {
    setMessage(null);
    if (!window.confirm(CONFIRM_MESSAGE)) {
      return;
    }

    startTransition(async () => {
      const result = await deleteProblemCandidateBatch(batchId);
      const params = new URLSearchParams({
        notice: result.message,
        noticeType: result.status,
      });

      if (result.status === "error") {
        setMessage(result.message);
        return;
      }

      router.push(`/protected/problem-candidates?${params.toString()}`);
      router.refresh();
    });
  }

  return (
    <div className="grid gap-2">
      <Button
        aria-label={`${batchName} 삭제`}
        disabled={isPending}
        onClick={handleDelete}
        size="sm"
        type="button"
        variant="destructive"
      >
        <Trash2 />
        {isPending ? "삭제 중..." : "삭제"}
      </Button>
      {message ? (
        <p className="text-xs text-destructive" role="alert">
          {message}
        </p>
      ) : null}
    </div>
  );
}
