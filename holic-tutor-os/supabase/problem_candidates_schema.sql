-- Holic Tutor OS problem candidate review schema
-- Run this in Supabase Dashboard > SQL Editor.
-- The app uses user_id consistently. If an older owner_id column exists, this
-- migration renames it to user_id and makes user_id default to auth.uid().

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

do $$
begin
  if to_regclass('public.crop_import_batches') is not null
     and exists (
       select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = 'crop_import_batches'
         and column_name = 'owner_id'
     )
     and not exists (
       select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = 'crop_import_batches'
         and column_name = 'user_id'
     ) then
    alter table public.crop_import_batches rename column owner_id to user_id;
  end if;

  if to_regclass('public.problem_candidates') is not null
     and exists (
       select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = 'problem_candidates'
         and column_name = 'owner_id'
     )
     and not exists (
       select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = 'problem_candidates'
         and column_name = 'user_id'
     ) then
    alter table public.problem_candidates rename column owner_id to user_id;
  end if;
end $$;

create table if not exists public.crop_import_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  source_pdf_name text,
  crop_version text not null default 'v4',
  output_run_id text,
  expected_count integer check (expected_count is null or expected_count > 0),
  detected_anchor_count integer check (detected_anchor_count is null or detected_anchor_count >= 0),
  generated_crop_count integer check (generated_crop_count is null or generated_crop_count >= 0),
  missing_question_numbers integer[] not null default '{}',
  duplicate_question_numbers integer[] not null default '{}',
  coordinates_path text,
  contact_sheet_path text,
  summary_path text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.problem_candidates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  batch_id uuid not null references public.crop_import_batches(id) on delete cascade,
  candidate_id text not null,
  question_number_guess integer check (question_number_guess is null or question_number_guess > 0),
  page_number integer not null check (page_number > 0),
  image_path text not null,
  source_pdf_name text,
  crop_version text not null default 'v4',
  bbox jsonb not null,
  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  notes text[] not null default '{}',
  review_status text not null default 'pending'
    constraint problem_candidates_review_status_check
    check (review_status in ('pending', 'approved', 'needs_edit', 'rejected')),
  review_grade text
    constraint problem_candidates_review_grade_check
    check (review_grade is null or review_grade in ('A', 'B', 'C')),
  auto_review_grade text
    constraint problem_candidates_auto_review_grade_check
    check (auto_review_grade is null or auto_review_grade in ('A', 'B', 'C')),
  auto_review_score numeric
    constraint problem_candidates_auto_review_score_check
    check (auto_review_score is null or (auto_review_score >= 0 and auto_review_score <= 1)),
  auto_review_reason text,
  manual_review_grade text
    constraint problem_candidates_manual_review_grade_check
    check (manual_review_grade is null or manual_review_grade in ('A', 'B', 'C')),
  final_review_grade text
    constraint problem_candidates_final_review_grade_check
    check (final_review_grade is null or final_review_grade in ('A', 'B', 'C')),
  review_source text default 'rule_based'
    constraint problem_candidates_review_source_check
    check (review_source is null or review_source in ('rule_based', 'local_vlm', 'openai', 'manual')),
  review_version text default 'rule_based_crop_v1',
  review_memo text,
  rejected_reason text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (batch_id, candidate_id)
);

alter table public.crop_import_batches
  add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.crop_import_batches
  alter column user_id set default auth.uid();

alter table public.problem_candidates
  add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.problem_candidates
  alter column user_id set default auth.uid();

alter table public.problem_candidates
  add column if not exists auto_review_grade text check (auto_review_grade is null or auto_review_grade in ('A', 'B', 'C'));
alter table public.problem_candidates
  add column if not exists auto_review_score numeric check (auto_review_score is null or (auto_review_score >= 0 and auto_review_score <= 1));
alter table public.problem_candidates
  add column if not exists auto_review_reason text;
alter table public.problem_candidates
  add column if not exists manual_review_grade text check (manual_review_grade is null or manual_review_grade in ('A', 'B', 'C'));
alter table public.problem_candidates
  add column if not exists final_review_grade text check (final_review_grade is null or final_review_grade in ('A', 'B', 'C'));
alter table public.problem_candidates
  add column if not exists reviewed_by uuid references auth.users(id) on delete set null;
alter table public.problem_candidates
  add column if not exists review_source text default 'rule_based' check (review_source is null or review_source in ('rule_based', 'local_vlm', 'openai', 'manual'));
alter table public.problem_candidates
  add column if not exists review_version text default 'rule_based_crop_v1';

update public.problem_candidates
set manual_review_grade = review_grade
where manual_review_grade is null
  and review_grade is not null;

update public.problem_candidates
set final_review_grade = coalesce(manual_review_grade, auto_review_grade, review_grade)
where final_review_grade is null
  and coalesce(manual_review_grade, auto_review_grade, review_grade) is not null;

do $$
begin
  if not exists (select 1 from public.crop_import_batches where user_id is null) then
    alter table public.crop_import_batches alter column user_id set not null;
  end if;

  if not exists (select 1 from public.problem_candidates where user_id is null) then
    alter table public.problem_candidates alter column user_id set not null;
  end if;
end $$;

drop trigger if exists crop_import_batches_set_updated_at on public.crop_import_batches;
create trigger crop_import_batches_set_updated_at
before update on public.crop_import_batches
for each row execute function public.set_updated_at();

drop trigger if exists problem_candidates_set_updated_at on public.problem_candidates;
create trigger problem_candidates_set_updated_at
before update on public.problem_candidates
for each row execute function public.set_updated_at();

create index if not exists crop_import_batches_user_id_idx
on public.crop_import_batches(user_id);
create index if not exists crop_import_batches_created_at_idx
on public.crop_import_batches(created_at desc);
create index if not exists problem_candidates_user_id_idx
on public.problem_candidates(user_id);
create index if not exists problem_candidates_batch_id_idx
on public.problem_candidates(batch_id);
create index if not exists problem_candidates_review_status_idx
on public.problem_candidates(review_status);
create index if not exists problem_candidates_auto_review_grade_idx
on public.problem_candidates(auto_review_grade);
create index if not exists problem_candidates_final_review_grade_idx
on public.problem_candidates(final_review_grade);
create index if not exists problem_candidates_review_source_idx
on public.problem_candidates(review_source);
create index if not exists problem_candidates_question_number_idx
on public.problem_candidates(question_number_guess);

alter table public.crop_import_batches enable row level security;
alter table public.problem_candidates enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.crop_import_batches to authenticated;
grant select, insert, update, delete on public.problem_candidates to authenticated;

drop policy if exists "crop_import_batches_select_own" on public.crop_import_batches;
create policy "crop_import_batches_select_own"
on public.crop_import_batches for select to authenticated
using (auth.uid() is not null and user_id = auth.uid());

drop policy if exists "crop_import_batches_insert_own" on public.crop_import_batches;
create policy "crop_import_batches_insert_own"
on public.crop_import_batches for insert to authenticated
with check (auth.uid() is not null and user_id = auth.uid());

drop policy if exists "crop_import_batches_update_own" on public.crop_import_batches;
create policy "crop_import_batches_update_own"
on public.crop_import_batches for update to authenticated
using (auth.uid() is not null and user_id = auth.uid())
with check (auth.uid() is not null and user_id = auth.uid());

drop policy if exists "crop_import_batches_delete_own" on public.crop_import_batches;
create policy "crop_import_batches_delete_own"
on public.crop_import_batches for delete to authenticated
using (auth.uid() is not null and user_id = auth.uid());

drop policy if exists "problem_candidates_select_own" on public.problem_candidates;
create policy "problem_candidates_select_own"
on public.problem_candidates for select to authenticated
using (auth.uid() is not null and user_id = auth.uid());

drop policy if exists "problem_candidates_insert_own" on public.problem_candidates;
create policy "problem_candidates_insert_own"
on public.problem_candidates for insert to authenticated
with check (
  auth.uid() is not null
  and user_id = auth.uid()
  and exists (
    select 1
    from public.crop_import_batches
    where crop_import_batches.id = problem_candidates.batch_id
      and crop_import_batches.user_id = auth.uid()
  )
);

drop policy if exists "problem_candidates_update_own" on public.problem_candidates;
create policy "problem_candidates_update_own"
on public.problem_candidates for update to authenticated
using (auth.uid() is not null and user_id = auth.uid())
with check (
  auth.uid() is not null
  and user_id = auth.uid()
  and exists (
    select 1
    from public.crop_import_batches
    where crop_import_batches.id = problem_candidates.batch_id
      and crop_import_batches.user_id = auth.uid()
  )
);

drop policy if exists "problem_candidates_delete_own" on public.problem_candidates;
create policy "problem_candidates_delete_own"
on public.problem_candidates for delete to authenticated
using (auth.uid() is not null and user_id = auth.uid());

-- Storage bucket setup
-- Create a private bucket named problem-candidates first, then run these policies.
-- Objects must be stored under {auth.uid()}/{batch_id}/...

drop policy if exists "problem_candidates_storage_select_own" on storage.objects;
create policy "problem_candidates_storage_select_own"
on storage.objects for select to authenticated
using (
  bucket_id = 'problem-candidates'
  and auth.uid() is not null
  and name like auth.uid()::text || '/%'
);

drop policy if exists "problem_candidates_storage_insert_own" on storage.objects;
create policy "problem_candidates_storage_insert_own"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'problem-candidates'
  and auth.uid() is not null
  and name like auth.uid()::text || '/%'
);

drop policy if exists "problem_candidates_storage_update_own" on storage.objects;
create policy "problem_candidates_storage_update_own"
on storage.objects for update to authenticated
using (
  bucket_id = 'problem-candidates'
  and auth.uid() is not null
  and name like auth.uid()::text || '/%'
)
with check (
  bucket_id = 'problem-candidates'
  and auth.uid() is not null
  and name like auth.uid()::text || '/%'
);

drop policy if exists "problem_candidates_storage_delete_own" on storage.objects;
create policy "problem_candidates_storage_delete_own"
on storage.objects for delete to authenticated
using (
  bucket_id = 'problem-candidates'
  and auth.uid() is not null
  and name like auth.uid()::text || '/%'
);


