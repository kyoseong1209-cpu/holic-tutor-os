"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";

import { promoteProblemCandidate } from "@/app/protected/problem-candidates/actions";
import { Button } from "@/components/ui/button";

export function PromoteProblemCandidateButton({
  candidateId,
  disabled,
}: {
  candidateId: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function handlePromote() {
    setMessage(null);
    startTransition(async () => {
      const result = await promoteProblemCandidate(candidateId);
      setMessage(result.message);
      if (result.status !== "error") {
        router.refresh();
      }
    });
  }

  return (
    <div className="grid gap-2">
      <Button disabled={disabled || isPending} onClick={handlePromote} type="button">
        <Send />
        {isPending ? "등록 중..." : "이 후보를 정식 문항으로 등록"}
      </Button>
      {message ? (
        <p
          className={
            message.includes("실패")
              ? "text-sm text-destructive"
              : "text-sm text-emerald-700 dark:text-emerald-300"
          }
          role="status"
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
