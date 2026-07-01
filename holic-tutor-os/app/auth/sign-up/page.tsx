import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function Page() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">회원가입이 닫혀 있습니다</CardTitle>
            <CardDescription>
              Holic Tutor OS는 개인 관리자 전용 앱입니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <p className="text-sm text-muted-foreground">
              이미 생성된 관리자 계정으로만 로그인할 수 있습니다.
            </p>
            <Button asChild>
              <Link href="/auth/login">로그인으로 이동</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
