-- Holic Tutor OS initial schema
-- Run this in Supabase Dashboard > SQL Editor after creating your project.

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

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  school text,
  grade text,
  student_phone text,
  parent_phone text,
  memo text,
  status text not null default 'active'
    check (status in ('active', 'paused', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists students_set_updated_at on public.students;
create trigger students_set_updated_at
before update on public.students
for each row execute function public.set_updated_at();

create table if not exists public.lesson_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  lesson_date date not null default current_date,
  duration_minutes integer check (duration_minutes is null or duration_minutes > 0),
  topic text not null,
  content text,
  performance text,
  homework text,
  next_plan text,
  weakness_tags text[] not null default '{}',
  parent_feedback_draft text,
  created_at timestamptz not null default now()
);

create index if not exists students_user_id_idx on public.students(user_id);
create index if not exists lesson_records_user_id_idx on public.lesson_records(user_id);
create index if not exists lesson_records_student_id_idx on public.lesson_records(student_id);
create index if not exists lesson_records_lesson_date_idx on public.lesson_records(lesson_date desc);
create index if not exists lesson_records_weakness_tags_idx on public.lesson_records using gin(weakness_tags);

alter table public.students enable row level security;
alter table public.lesson_records enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.students to authenticated;
grant select, insert, update, delete on public.lesson_records to authenticated;

drop policy if exists "students_select_own" on public.students;
create policy "students_select_own"
on public.students for select to authenticated
using (user_id = auth.uid());

drop policy if exists "students_insert_own" on public.students;
create policy "students_insert_own"
on public.students for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists "students_update_own" on public.students;
create policy "students_update_own"
on public.students for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "students_delete_own" on public.students;
create policy "students_delete_own"
on public.students for delete to authenticated
using (user_id = auth.uid());

drop policy if exists "lesson_records_select_own" on public.lesson_records;
create policy "lesson_records_select_own"
on public.lesson_records for select to authenticated
using (user_id = auth.uid());

drop policy if exists "lesson_records_insert_own" on public.lesson_records;
create policy "lesson_records_insert_own"
on public.lesson_records for insert to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.students
    where students.id = lesson_records.student_id
      and students.user_id = auth.uid()
  )
);

drop policy if exists "lesson_records_update_own" on public.lesson_records;
create policy "lesson_records_update_own"
on public.lesson_records for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "lesson_records_delete_own" on public.lesson_records;
create policy "lesson_records_delete_own"
on public.lesson_records for delete to authenticated
using (user_id = auth.uid());
