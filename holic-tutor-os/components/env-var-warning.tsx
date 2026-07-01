import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

export function EnvVarWarning() {
  return (
    <div className="flex items-center gap-4">
      <Badge variant={"outline"} className="font-normal">
        Supabase 연결 필요
      </Badge>
      <div className="flex gap-2">
        <Button size="sm" variant={"outline"} disabled>
          로그인
        </Button>
      </div>
    </div>
  );
}
