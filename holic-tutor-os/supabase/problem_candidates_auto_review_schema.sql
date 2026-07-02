-- Holic Tutor OS rule-based auto review schema
-- Run this in Supabase Dashboard > SQL Editor after problem_candidates_schema.sql.
-- This keeps existing manual review data and adds automatic review fields.

alter table public.problem_candidates
  add column if not exists auto_review_grade text
    check (auto_review_grade is null or auto_review_grade in ('A', 'B', 'C'));

alter table public.problem_candidates
  add column if not exists auto_review_score numeric
    check (auto_review_score is null or (auto_review_score >= 0 and auto_review_score <= 1));

alter table public.problem_candidates
  add column if not exists auto_review_reason text;

alter table public.problem_candidates
  add column if not exists manual_review_grade text
    check (manual_review_grade is null or manual_review_grade in ('A', 'B', 'C'));

alter table public.problem_candidates
  add column if not exists final_review_grade text
    check (final_review_grade is null or final_review_grade in ('A', 'B', 'C'));

alter table public.problem_candidates
  add column if not exists reviewed_by uuid references auth.users(id) on delete set null;

alter table public.problem_candidates
  add column if not exists review_source text default 'rule_based'
    check (review_source is null or review_source in ('rule_based', 'local_vlm', 'openai', 'manual'));

alter table public.problem_candidates
  add column if not exists review_version text default 'rule_based_crop_v1';

alter table public.problem_candidates
  add column if not exists promoted_at timestamptz;

alter table public.problem_candidates
  add column if not exists promoted_problem_id uuid references public.problems(id) on delete set null;

-- Existing review_grade is kept as a legacy/manual compatibility field.
-- Backfill manual/final grade from existing review_grade where available.
update public.problem_candidates
set manual_review_grade = review_grade
where manual_review_grade is null
  and review_grade is not null;

update public.problem_candidates
set final_review_grade = coalesce(manual_review_grade, auto_review_grade, review_grade)
where final_review_grade is null
  and coalesce(manual_review_grade, auto_review_grade, review_grade) is not null;

update public.problem_candidates
set review_source = case
    when manual_review_grade is not null then 'manual'
    else coalesce(review_source, 'rule_based')
  end,
  review_version = coalesce(review_version, 'rule_based_crop_v1')
where review_source is null
   or review_version is null
   or manual_review_grade is not null;

create index if not exists problem_candidates_auto_review_grade_idx
on public.problem_candidates(auto_review_grade);

create index if not exists problem_candidates_final_review_grade_idx
on public.problem_candidates(final_review_grade);

create index if not exists problem_candidates_review_source_idx
on public.problem_candidates(review_source);

create index if not exists problem_candidates_promoted_problem_id_idx
on public.problem_candidates(promoted_problem_id);
