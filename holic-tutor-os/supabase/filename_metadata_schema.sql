-- Holic Tutor OS filename metadata schema
-- Run this in Supabase Dashboard > SQL Editor.
-- Adds shared exam metadata parsed from source PDF file names.

alter table public.crop_import_batches
  add column if not exists school text;

alter table public.crop_import_batches
  add column if not exists grade text;

alter table public.crop_import_batches
  add column if not exists year integer;

alter table public.crop_import_batches
  add column if not exists semester text;

alter table public.crop_import_batches
  add column if not exists exam_name text;

alter table public.crop_import_batches
  add column if not exists subject text;

alter table public.crop_import_batches
  add column if not exists unit_scope text;

alter table public.crop_import_batches
  add column if not exists exam_sections text[] not null default '{}';

alter table public.crop_import_batches
  add column if not exists file_kind text;

alter table public.crop_import_batches
  add column if not exists source_note text;

alter table public.crop_import_batches
  add column if not exists parsed_metadata jsonb;

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

create index if not exists crop_import_batches_school_idx
on public.crop_import_batches(school);

create index if not exists crop_import_batches_year_idx
on public.crop_import_batches(year);

create index if not exists crop_import_batches_subject_idx
on public.crop_import_batches(subject);

create index if not exists problems_school_idx
on public.problems(school);

create index if not exists problems_year_idx
on public.problems(year);

create index if not exists problems_subject_idx
on public.problems(subject);
