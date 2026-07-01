import { EnvVarWarning } from "@/components/env-var-warning";
import { AuthButton } from "@/components/auth-button";
import { hasEnvVars } from "@/lib/utils";
import Link from "next/link";
import { Suspense } from "react";

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-screen flex-col items-center">
      <div className="flex w-full flex-1 flex-col items-center">
        <nav className="flex h-16 w-full justify-center border-b border-b-foreground/10">
          <div className="flex w-full max-w-6xl items-center justify-between p-3 px-5 text-sm">
            <div className="flex items-center gap-5">
              <Link className="font-semibold" href="/protected">
                Holic Tutor OS
              </Link>
              <Link
                className="text-muted-foreground hover:text-foreground"
                href="/protected"
              >
                대시보드
              </Link>
              <Link
                className="text-muted-foreground hover:text-foreground"
                href="/protected/students"
              >
                학생
              </Link>
            </div>
            {!hasEnvVars ? (
              <EnvVarWarning />
            ) : (
              <Suspense>
                <AuthButton />
              </Suspense>
            )}
          </div>
        </nav>
        <div className="flex w-full max-w-6xl flex-1 flex-col p-5">
          {children}
        </div>
      </div>
    </main>
  );
}
