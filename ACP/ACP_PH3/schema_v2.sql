-- ============================================================================
-- CEFR Practice Partner — schema v2: multi-tenant classroom model
-- Run in Supabase -> SQL Editor. Safe to run over the v1 schema (see MIGRATION
-- at the bottom) or on a fresh project.
--
-- SECURITY MODEL — unchanged, and now more load-bearing than before.
-- Hugging Face OAuth gives the app a username. It does NOT mint a Supabase
-- JWT, so auth.uid() is NULL and RLS cannot distinguish a teacher from a
-- student on its own. RLS is therefore enabled with NO policies (deny-all),
-- the backend holds the service_role key, and *the application* enforces
-- tenancy. Every teacher-facing read in core/db.py goes through an explicit
-- ownership check. If you ever move to Supabase Auth, the commented policies
-- at the bottom become live and the app-side checks become defence in depth.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- ENUMS
-- ---------------------------------------------------------------------------
do $$ begin
    create type user_role as enum ('teacher', 'student');
exception when duplicate_object then null; end $$;

do $$ begin
    create type cefr_level as enum ('A1','A2','B1','B2','C1','C2');
exception when duplicate_object then null; end $$;

-- The closed taxonomy, enforced at the database boundary as well as in the
-- prompt. A model that invents a twelfth category gets rejected here.
do $$ begin
    create type error_tag as enum (
        'verb_tense',
        'subject_verb_agreement',
        'article',
        'preposition',
        'word_order',
        'plural_countability',
        'modal_conditional',
        'pronoun_reference',
        'word_choice_collocation',
        'question_formation',
        'register_formality'
    );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 1. PROFILES
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
    hf_username        text primary key,
    role               user_role not null default 'student',
    display_name       text,
    avatar_url         text,
    default_cefr_level cefr_level,
    default_voice      text,
    created_at         timestamptz not null default now(),
    last_seen_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. CLASSROOMS
-- ---------------------------------------------------------------------------
create table if not exists public.classrooms (
    id          uuid primary key default gen_random_uuid(),
    teacher     text not null references public.profiles(hf_username) on delete cascade,
    name        text not null,
    description text,
    -- Short human-typeable code. Students join with this rather than being
    -- invited by email, because you do not collect their emails.
    join_code   text not null unique default upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 6)),
    archived    boolean not null default false,
    created_at  timestamptz not null default now()
);

create index if not exists idx_classrooms_teacher on public.classrooms (teacher) where not archived;

-- ---------------------------------------------------------------------------
-- 3. ENROLLMENTS
-- ---------------------------------------------------------------------------
create table if not exists public.enrollments (
    id           bigint generated always as identity primary key,
    classroom_id uuid not null references public.classrooms(id) on delete cascade,
    student      text not null references public.profiles(hf_username) on delete cascade,
    joined_at    timestamptz not null default now(),
    active       boolean not null default true,
    unique (classroom_id, student)
);

create index if not exists idx_enrollments_student on public.enrollments (student) where active;

-- ---------------------------------------------------------------------------
-- 4. ASSIGNMENTS
-- ---------------------------------------------------------------------------
create table if not exists public.assignments (
    id            uuid primary key default gen_random_uuid(),
    classroom_id  uuid not null references public.classrooms(id) on delete cascade,
    title         text not null,
    cefr_level    cefr_level not null,
    target_topic  text not null,
    -- Teachers should be able to override the pedagogy per assignment: an A2
    -- class doing a hard structure may need explicit correction even though
    -- the level default would be guided discovery.
    feedback_style text not null default 'auto'
        check (feedback_style in ('auto','explicit','guided')),
    min_turns     integer not null default 5 check (min_turns > 0),
    opens_at      timestamptz not null default now(),
    due_at        timestamptz,
    created_at    timestamptz not null default now()
);

create index if not exists idx_assignments_classroom on public.assignments (classroom_id, opens_at desc);

-- ---------------------------------------------------------------------------
-- 5. PRACTICE SESSIONS
-- assignment_id is NULLABLE on purpose: free practice outside any classroom is
-- a first-class case, and cohort analytics must not silently drop it.
-- ---------------------------------------------------------------------------
create table if not exists public.practice_sessions (
    id               uuid primary key default gen_random_uuid(),
    student          text not null references public.profiles(hf_username) on delete cascade,
    assignment_id    uuid references public.assignments(id) on delete set null,
    classroom_id     uuid references public.classrooms(id) on delete set null,
    cefr_level       cefr_level not null,
    target_topic     text not null default 'everyday conversation',
    voice            text,
    started_at       timestamptz not null default now(),
    ended_at         timestamptz,
    turn_count       integer not null default 0,
    target_hit_count integer not null default 0,
    error_count      integer not null default 0,
    report_markdown  text,
    target_accuracy  numeric generated always as (
        case when turn_count > 0
             then round(target_hit_count::numeric / turn_count::numeric, 4)
             else null end
    ) stored,
    constraint hits_within_turns check (target_hit_count <= turn_count)
);

create index if not exists idx_sessions_student   on public.practice_sessions (student, started_at desc);
create index if not exists idx_sessions_assignment on public.practice_sessions (assignment_id) where assignment_id is not null;
create index if not exists idx_sessions_classroom  on public.practice_sessions (classroom_id, started_at desc);

-- ---------------------------------------------------------------------------
-- 6. EXCHANGES — one row per turn, written as the turn completes
-- ---------------------------------------------------------------------------
create table if not exists public.exchanges (
    id                bigint generated always as identity primary key,
    session_id        uuid not null references public.practice_sessions(id) on delete cascade,
    turn_index        integer not null,
    student_text      text not null,
    partner_text      text not null,
    used_target       boolean not null default false,
    target_evidence   text,
    -- Full error objects: {student_said, correction, tag, explanation}
    errors            jsonb not null default '[]'::jsonb,
    did_well          jsonb not null default '[]'::jsonb,
    level_impression  text,
    feedback_style    text,
    partner_provider  text,
    assessor_provider text,
    degraded          boolean not null default false,
    stt_ms            integer,
    partner_ms        integer,
    assessor_ms       integer,
    tts_ms            integer,
    created_at        timestamptz not null default now(),
    unique (session_id, turn_index)
);

create index if not exists idx_exchanges_session on public.exchanges (session_id, turn_index);
create index if not exists idx_exchanges_errors  on public.exchanges using gin (errors);

-- Reject any tag outside the closed taxonomy. This is the database refusing to
-- store a hallucinated twelfth category, independent of what the prompt says.
create or replace function public.validate_error_tags()
returns trigger language plpgsql as $$
declare item jsonb;
begin
    for item in select * from jsonb_array_elements(new.errors) loop
        if not (item ? 'tag') or not ((item ->> 'tag')::text = any (enum_range(null::error_tag)::text[])) then
            raise exception 'Invalid error tag: %', coalesce(item ->> 'tag', '<missing>');
        end if;
        if coalesce(trim(item ->> 'student_said'), '') = '' then
            raise exception 'Error object has no verbatim student_said quote';
        end if;
    end loop;
    return new;
end $$;

drop trigger if exists trg_validate_error_tags on public.exchanges;
create trigger trg_validate_error_tags
    before insert or update on public.exchanges
    for each row execute function public.validate_error_tags();

-- Session rollups maintained by the database, so counts can never drift from
-- the rows they summarise.
create or replace function public.bump_session_counters()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    update public.practice_sessions
       set turn_count       = turn_count + 1,
           target_hit_count = target_hit_count + (case when new.used_target then 1 else 0 end),
           error_count      = error_count + coalesce(jsonb_array_length(new.errors), 0)
     where id = new.session_id;
    return new;
end $$;

drop trigger if exists trg_bump_session_counters on public.exchanges;
create trigger trg_bump_session_counters
    after insert on public.exchanges
    for each row execute function public.bump_session_counters();

-- ---------------------------------------------------------------------------
-- 7. ANALYTICS VIEWS
-- ---------------------------------------------------------------------------

-- Flattened errors, tagged. This is what makes longitudinal tracking real:
-- grouping on `tag` rather than on the corrected string, so "I have went" and
-- "she have gone" finally count as the same problem.
create or replace view public.v_error_events as
select s.student,
       s.classroom_id,
       s.assignment_id,
       s.cefr_level,
       s.id                       as session_id,
       e.created_at,
       (err ->> 'tag')::error_tag as tag,
       err ->> 'student_said'     as student_said,
       err ->> 'correction'       as correction
  from public.exchanges e
  join public.practice_sessions s on s.id = e.session_id
  cross join lateral jsonb_array_elements(e.errors) as err;

-- Per-student pattern report.
create or replace view public.v_student_error_profile as
select student, tag, count(*) as occurrences,
       count(distinct session_id) as sessions_affected,
       max(created_at) as last_seen
  from public.v_error_events
 group by student, tag;

-- THE teacher view: which error categories dominate a cohort, so the next
-- lesson can be planned from evidence instead of impression.
create or replace view public.v_classroom_error_profile as
select classroom_id, tag,
       count(*)                  as occurrences,
       count(distinct student)   as students_affected,
       round(100.0 * count(*) / nullif(sum(count(*)) over (partition by classroom_id), 0), 1) as pct_of_class_errors
  from public.v_error_events
 where classroom_id is not null
 group by classroom_id, tag;

-- Assignment completion, including students who have not started.
create or replace view public.v_assignment_progress as
select a.id as assignment_id, a.classroom_id, a.title, a.cefr_level,
       a.target_topic, a.min_turns, a.due_at,
       en.student,
       coalesce(sum(s.turn_count), 0)                       as turns_done,
       coalesce(sum(s.turn_count), 0) >= a.min_turns        as complete,
       round(avg(s.target_accuracy), 3)                     as avg_target_accuracy,
       max(s.started_at)                                    as last_practised
  from public.assignments a
  join public.enrollments en on en.classroom_id = a.classroom_id and en.active
  left join public.practice_sessions s
         on s.assignment_id = a.id and s.student = en.student
 group by a.id, a.classroom_id, a.title, a.cefr_level, a.target_topic,
          a.min_turns, a.due_at, en.student;

-- ---------------------------------------------------------------------------
-- 8. RLS: enabled, deny-all. The service_role key bypasses it by design.
-- ---------------------------------------------------------------------------
alter table public.profiles          enable row level security;
alter table public.classrooms        enable row level security;
alter table public.enrollments       enable row level security;
alter table public.assignments       enable row level security;
alter table public.practice_sessions enable row level security;
alter table public.exchanges         enable row level security;

revoke all on all tables in schema public from anon, authenticated;

-- When you migrate to Supabase Auth, these become the real boundary:
--
-- create policy "students read own sessions" on public.practice_sessions
--   for select using (student = auth.jwt() ->> 'user_name');
-- create policy "teachers read their classrooms' sessions" on public.practice_sessions
--   for select using (exists (
--     select 1 from public.classrooms c
--      where c.id = practice_sessions.classroom_id
--        and c.teacher = auth.jwt() ->> 'user_name'));

-- ---------------------------------------------------------------------------
-- 9. MIGRATION FROM v1
-- v1 used practice_sessions.hf_username and exchanges.mistakes (text[] as
-- jsonb). Run this only if you have v1 data worth keeping.
-- ---------------------------------------------------------------------------
-- alter table public.practice_sessions rename column hf_username to student;
-- alter table public.practice_sessions add column if not exists assignment_id uuid;
-- alter table public.practice_sessions add column if not exists classroom_id uuid;
-- alter table public.exchanges rename column mistakes to errors_legacy;
-- alter table public.exchanges add column if not exists errors jsonb not null default '[]'::jsonb;
-- -- v1 mistakes were untagged strings; they cannot be back-filled into the
-- -- taxonomy automatically. Leave errors_legacy in place for reference and
-- -- start the tagged history from today rather than guessing at tags.

-- ---------------------------------------------------------------------------
-- 10. RETENTION
-- ---------------------------------------------------------------------------
create or replace function public.purge_old_sessions(retain_days integer default 365)
returns integer language plpgsql security definer set search_path = public as $$
declare removed integer;
begin
    with gone as (
        delete from public.practice_sessions
         where started_at < now() - make_interval(days => retain_days)
        returning 1)
    select count(*) into removed from gone;
    return removed;
end $$;

-- ===========================================================================
-- 11. REVISION: assessor sweep + speech-clarity columns
-- Run this block on an existing v2 database. Safe to re-run.
-- ===========================================================================

alter table public.exchanges
    add column if not exists target_rule   text,
    add column if not exists uncertain     jsonb not null default '[]'::jsonb,
    add column if not exists clarity_flags jsonb not null default '[]'::jsonb;

comment on column public.exchanges.uncertain is
    'Clauses the assessor flagged but could not pin down. Deliberately not
     errors: surfacing them beats inflating a hunch into a correction.';

comment on column public.exchanges.clarity_flags is
    'Whisper decode-confidence flags. NOT a pronunciation score -- low decoder
     confidence also tracks room noise, microphone quality and accent. Stored
     so the ceiling on this signal can be measured against real recordings.';

-- Which categories does a learner keep failing? Drives assessor priming.
create or replace view public.v_learner_focus_tags as
select student,
       tag,
       count(*)                   as occurrences,
       max(created_at)            as last_seen,
       row_number() over (partition by student order by count(*) desc) as rank
  from public.v_error_events
 group by student, tag;

-- How often does the sweep flag a clause it then fails to write up? A rising
-- number here is silent recall loss, and it is the metric to watch when tuning
-- the assessor prompt.
create or replace view public.v_assessor_health as
select s.student,
       date_trunc('day', e.created_at)                     as day,
       count(*)                                            as turns,
       sum(jsonb_array_length(e.errors))                   as errors_written,
       sum(jsonb_array_length(e.uncertain))                as uncertain_flagged,
       sum(case when e.degraded then 1 else 0 end)         as degraded_turns,
       round(avg(jsonb_array_length(e.errors)), 2)         as avg_errors_per_turn
  from public.exchanges e
  join public.practice_sessions s on s.id = e.session_id
 group by s.student, date_trunc('day', e.created_at);

-- ===========================================================================
-- 12. TEACHER REVIEW LOOP + SFT EXPORT VIEWS
--
-- Without this table, every training row is a copy of the cloud assessor's own
-- output. Fine-tuning on that is distillation: the student inherits the
-- teacher's misses and cannot exceed them. This is the table that turns
-- recorded turns into supervision.
-- ===========================================================================

do $$ begin
    create type review_verdict as enum ('confirmed', 'corrected', 'rejected');
exception when duplicate_object then null; end $$;

create table if not exists public.teacher_reviews (
    id           bigint generated always as identity primary key,
    exchange_id  bigint not null references public.exchanges(id) on delete cascade,
    reviewer     text   not null references public.profiles(hf_username) on delete cascade,
    verdict      review_verdict not null,
    -- The corrected assessment, same shape the model emits. NULL when the
    -- verdict is 'confirmed' (the model was right) or 'rejected' (unusable).
    corrected    jsonb,
    notes        text,
    reviewed_at  timestamptz not null default now(),
    unique (exchange_id, reviewer)
);

create index if not exists idx_reviews_verdict on public.teacher_reviews (verdict, reviewed_at desc);

alter table public.teacher_reviews enable row level security;

-- Teacher-verified rows only. This is the split you actually want to train on.
create or replace view public.v_assessor_training_reviewed as
select e.id                                    as exchange_id,
       s.cefr_level,
       s.target_topic,
       e.student_text,
       e.feedback_style,
       coalesce(r.corrected -> 'errors',   e.errors)    as errors,
       coalesce(r.corrected -> 'clauses',  e.clauses)   as clauses,
       coalesce(r.corrected -> 'did_well', e.did_well)  as did_well,
       coalesce((r.corrected ->> 'target_used')::boolean, e.used_target) as used_target,
       coalesce(r.corrected ->> 'target_evidence',  e.target_evidence)  as target_evidence,
       coalesce(r.corrected ->> 'level_impression', e.level_impression) as level_impression,
       coalesce(r.corrected ->> 'target_rule',      e.target_rule)      as target_rule,
       'reviewed'::text                        as label_source,
       e.degraded
  from public.exchanges e
  join public.practice_sessions s on s.id = e.session_id
  join public.teacher_reviews  r on r.exchange_id = e.id
 where r.verdict in ('confirmed', 'corrected')
   and not e.degraded;

-- Model output with no human in the loop. Distillation only — labelled as such
-- so an export can never be mistaken for supervision.
create or replace view public.v_assessor_training_distill as
select e.id as exchange_id, s.cefr_level, s.target_topic, e.student_text,
       e.feedback_style, e.errors, e.clauses, e.did_well, e.used_target,
       e.target_evidence, e.level_impression, e.target_rule,
       'distill'::text as label_source, e.degraded
  from public.exchanges e
  join public.practice_sessions s on s.id = e.session_id
  left join public.teacher_reviews r on r.exchange_id = e.id
 where r.id is null
   and not e.degraded;

create or replace view public.v_assessor_training_mixed as
select * from public.v_assessor_training_reviewed
union all
select * from public.v_assessor_training_distill;

-- Review queue: unreviewed turns, worst first. Turns where the sweep flagged a
-- clause the model then failed to write up are the highest-value ones to look
-- at, because that is exactly where recall is leaking.
create or replace view public.v_review_queue as
select e.id as exchange_id, s.student, s.cefr_level, s.target_topic,
       e.student_text, e.errors, e.uncertain, e.created_at,
       jsonb_array_length(e.uncertain) as uncertain_count,
       jsonb_array_length(e.errors)    as error_count
  from public.exchanges e
  join public.practice_sessions s on s.id = e.session_id
  left join public.teacher_reviews r on r.exchange_id = e.id
 where r.id is null and not e.degraded
 order by jsonb_array_length(e.uncertain) desc, e.created_at desc;

-- `clauses` was not previously persisted; the training views need it.
alter table public.exchanges
    add column if not exists clauses jsonb not null default '[]'::jsonb;
