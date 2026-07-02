-- Holic Tutor OS official problem database schema
-- Run this in Supabase Dashboard > SQL Editor after problem_candidates_schema.sql.

create extension if not exists "pgcrypto";

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.problems (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,

  source_candidate_id uuid not null,
  source_batch_id uuid,

  title text not null,
  school text,
  grade text,
  year integer,
  semester text,
  exam_name text,
  subject text,
  unit_scope text,
  exam_sections text[] not null default '{}',
  file_kind text,
  source_note text,
  parsed_metadata jsonb,
  source_pdf_name text,
  question_number integer check (question_number is null or question_number > 0),

  unit text,
  problem_type text,
  difficulty text,
  answer text,
  core_idea text,
  standard_solution text,
  elegant_solution text,
  mistake_points text[] not null default '{}',
  teacher_note text,

  image_storage_path text not null,
  bbox jsonb,
  crop_version text,
  review_grade text check (review_grade is null or review_grade in ('A', 'B', 'C')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint problems_source_candidate_unique unique (source_candidate_id)
);

alter table public.problems
  add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.problems
  alter column user_id set default auth.uid();
alter table public.problems
  add column if not exists subject text;
alter table public.problems
  add column if not exists unit_scope text;
alter table public.problems
  add column if not exists exam_sections text[] not null default '{}';
alter table public.problems
  add column if not exists file_kind text;
alter table public.problems
  add column if not exists source_note text;
alter table public.problems
  add column if not exists parsed_metadata jsonb;

alter table public.problem_candidates
  add column if not exists promoted_at timestamptz;
alter table public.problem_candidates
  add column if not exists promoted_problem_id uuid references public.problems(id) on delete set null;

drop trigger if exists problems_set_updated_at on public.problems;
create trigger problems_set_updated_at
before update on public.problems
for each row execute function public.set_updated_at();

create index if not exists problems_user_id_idx on public.problems(user_id);
create index if not exists problems_source_batch_id_idx on public.problems(source_batch_id);
create index if not exists problems_question_number_idx on public.problems(question_number);
create index if not exists problems_created_at_idx on public.problems(created_at desc);
create index if not exists problem_candidates_promoted_problem_id_idx
on public.problem_candidates(promoted_problem_id);

alter table public.problems enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.problems to authenticated;

drop policy if exists "problems_select_own" on public.problems;
create policy "problems_select_own"
on public.problems for select to authenticated
using (auth.uid() is not null and user_id = auth.uid());

drop policy if exists "problems_insert_own" on public.problems;
create policy "problems_insert_own"
on public.problems for insert to authenticated
with check (auth.uid() is not null and user_id = auth.uid());

drop policy if exists "problems_update_own" on public.problems;
create policy "problems_update_own"
on public.problems for update to authenticated
using (auth.uid() is not null and user_id = auth.uid())
with check (auth.uid() is not null and user_id = auth.uid());

drop policy if exists "problems_delete_own" on public.problems;
create policy "problems_delete_own"
on public.problems for delete to authenticated
using (auth.uid() is not null and user_id = auth.uid());

