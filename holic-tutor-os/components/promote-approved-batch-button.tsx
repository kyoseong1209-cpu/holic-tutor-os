"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";

import { promoteApprovedBatchCandidates } from "@/app/protected/problem-candidates/actions";
import { Button } from "@/components/ui/button";

export function PromoteApprovedBatchButton({
  batchId,
}: {
  batchId: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function handlePromote() {
    setMessage(null);
    startTransition(async () => {
      const result = await promoteApprovedBatchCandidates(batchId);
      const params = new URLSearchParams({
        batch: batchId,
        notice: result.message,
        noticeType: result.status === "error" ? "error" : "success",
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
      <Button disabled={isPending} onClick={handlePromote} type="button">
        <Send />
        {isPending ? "등록 중..." : "승인 후보 정식 DB로 보내기"}
      </Button>
      {message ? (
        <p className="text-sm text-destructive" role="alert">
          {message}
        </p>
      ) : null}
    </div>
  );
}
