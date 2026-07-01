# Holic Tutor OS 진행 가이드

개인 수학 튜터가 혼자 로그인해서 학생, 수업 기록, 반복 약점, 학부모 피드백 초안을 관리하는 Next.js + Supabase 웹앱입니다.

## 지금 들어간 기능

- Supabase 이메일/비밀번호 로그인
- 로그인 후 관리자 대시보드
- 학생 등록, 목록, 상세, 수정, 삭제
- 학생별 수업 기록 등록
- 수업 기록의 약점 태그 누적 집계
- 수업 기록 기반 학부모 피드백 초안 자동 생성

## 선생님이 클릭해서 해야 할 일

1. Supabase에서 새 프로젝트를 만듭니다.
   - https://database.new
   - Project name: `Holic Tutor OS`
   - Region은 한국에서 가까운 곳을 선택합니다.

2. Supabase SQL Editor에서 `supabase/schema.sql` 내용을 실행합니다.

3. Supabase 프로젝트의 URL과 Publishable key를 복사합니다.
   - Project Settings 또는 Connect 화면에서 확인합니다.

4. `.env.example`을 참고해서 `.env.local`을 만듭니다.

   ```env
   NEXT_PUBLIC_SUPABASE_URL=복사한_PROJECT_URL
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=복사한_PUBLISHABLE_KEY
   ```

5. 처음 관리자 계정을 만든 뒤, Supabase Auth 설정에서 신규 가입을 꺼둡니다.
   - 1차 버전은 선생님 혼자 쓰는 관리자 앱이므로 이 방식이 가장 단순합니다.
   - Supabase Dashboard > Authentication > Sign In / Providers > Email에서 `Allow new users to sign up`을 끕니다.

6. GitHub 저장소를 만들고 Vercel에서 Import 합니다.
   - 이 폴더를 저장소 최상위로 올리면 Vercel Root Directory는 비워둡니다.
   - 저장소 안에 `holic-tutor-os` 하위 폴더로 올리면 Root Directory를 `holic-tutor-os`로 설정합니다.
   - Vercel Environment Variables에도 위 Supabase 변수 2개를 넣습니다.

## Codex가 처리할 일

- 코드 작성과 수정
- Supabase 테이블 구조 변경용 SQL 작성
- Vercel 빌드 오류 수정
- 화면 구성 개선
- 필요한 경우 Git 커밋/푸시/PR 준비

## 로컬 실행

```bash
npm run dev
```

브라우저에서 http://localhost:3000 으로 접속합니다.

## 배포 전 확인

```bash
npm run lint
npm run build
```
