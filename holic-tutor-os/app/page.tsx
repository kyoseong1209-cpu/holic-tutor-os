import { EnvVarWarning } from "@/components/env-var-warning";
import { AuthButton } from "@/components/auth-button";
import { Button } from "@/components/ui/button";
import { hasEnvVars } from "@/lib/utils";
import { BookOpenCheck, LogIn, UsersRound } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center">
      <div className="flex w-full flex-1 flex-col">
        <nav className="flex h-16 w-full justify-center border-b border-b-foreground/10">
          <div className="flex w-full max-w-6xl items-center justify-between p-3 px-5 text-sm">
            <Link className="font-semibold" href="/">
              Holic Tutor OS
            </Link>
            {!hasEnvVars ? (
              <EnvVarWarning />
            ) : (
              <Suspense>
                <AuthButton />
              </Suspense>
            )}
          </div>
        </nav>
        <section className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center gap-8 px-5 py-12">
          <div className="max-w-2xl">
            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
              개인 수학 튜터 관리자 앱
            </p>
            <h1 className="mt-3 text-4xl font-semibold tracking-normal sm:text-5xl">
              Holic Tutor OS
            </h1>
            <p className="mt-4 text-base leading-7 text-muted-foreground">
              학생 정보, 수업 기록, 반복 약점, 학부모 피드백 초안을 한곳에서
              관리합니다.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button asChild>
              <Link href={hasEnvVars ? "/protected" : "#setup-needed"}>
                <BookOpenCheck />
                운영 시작
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/auth/login">
                <LogIn />
                관리자 로그인
              </Link>
            </Button>
            <Button asChild variant="ghost">
              <Link href="/protected/students">
                <UsersRound />
                학생 관리
              </Link>
            </Button>
          </div>

          {!hasEnvVars ? (
            <div
              className="max-w-xl rounded-lg border bg-muted/50 p-4 text-sm text-muted-foreground"
              id="setup-needed"
            >
              Supabase 환경 변수를 연결하면 로그인과 데이터 저장이 활성화됩니다.
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
