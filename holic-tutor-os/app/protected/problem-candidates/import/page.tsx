import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { ProblemCandidateImportForm } from "@/components/problem-candidate-import-form";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";

export default async function ProblemCandidateImportPage() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect("/auth/login");
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
            문항 후보 검수함
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-normal">
            crop 결과 가져오기
          </h1>
        </div>
        <Button asChild variant="outline">
          <Link href="/protected/problem-candidates">
            <ArrowLeft />
            검수함으로
          </Link>
        </Button>
      </section>

      <ProblemCandidateImportForm />
    </div>
  );
}
