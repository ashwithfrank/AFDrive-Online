-- AFDrive Online — Supabase (Postgres) schema.
--
-- Design principle: this database stores METADATA ONLY. No file
-- contents, no file listings, ever. Filesystem state is always read
-- live from the owning Agent through the tunnel.
--
-- Run this in the Supabase SQL editor once, on a fresh project.
-- Requires Supabase Auth to already be enabled (auth.users is built in).

-- ---------------------------------------------------------------------
-- servers: one row per registered AFDrive Agent/storage
-- ---------------------------------------------------------------------
create table if not exists public.servers (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references auth.users(id) on delete cascade,
  display_name      text not null,
  device_hint       text,
  is_public         boolean not null default false,
  status            text not null default 'offline' check (status in ('online', 'offline')),
  last_seen_at      timestamptz,
  device_secret_hash text not null,          -- never store plaintext
  created_at        timestamptz not null default now(),
  revoked_at        timestamptz               -- set instead of deleting, for audit history
);

create index if not exists idx_servers_owner on public.servers(owner_id);
create index if not exists idx_servers_public_online
  on public.servers(is_public, status)
  where is_public = true and revoked_at is null;

-- ---------------------------------------------------------------------
-- pairing_codes: single-use, short-lived codes used only to bootstrap
-- a new Agent's device_secret. Consumed immediately on first use.
-- ---------------------------------------------------------------------
create table if not exists public.pairing_codes (
  code        text primary key,              -- short human-typeable code, e.g. 6-8 chars
  owner_id    uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz,
  server_id   uuid references public.servers(id) on delete set null
);

-- ---------------------------------------------------------------------
-- access_grants: who besides the owner may reach a private server.
-- Public servers don't need a row here for read access — is_public on
-- `servers` already covers "any authenticated visitor may attempt the
-- Agent's own login". Rows here are for explicitly shared PRIVATE
-- servers, and for scoping role beyond the Agent's own auth.
-- ---------------------------------------------------------------------
create table if not exists public.access_grants (
  id          uuid primary key default gen_random_uuid(),
  server_id   uuid not null references public.servers(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete cascade,
  invited_email text,                          -- for grants issued before the invitee has an account
  role        text not null default 'read' check (role in ('read', 'read_write')),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz,                      -- null = does not expire
  revoked_at  timestamptz,
  constraint access_grants_target check (user_id is not null or invited_email is not null)
);

create index if not exists idx_access_grants_server on public.access_grants(server_id);
create index if not exists idx_access_grants_user on public.access_grants(user_id);

-- ---------------------------------------------------------------------
-- sessions: short-lived proof that the relay has already authorized a
-- given (user, server) pair, so repeated requests in the same browser
-- session don't need a fresh Supabase round-trip per file operation.
-- Distinct from the Agent's OWN Flask session cookie, which still
-- governs the actual AFDrive login inside that authorization boundary.
-- ---------------------------------------------------------------------
create table if not exists public.relay_sessions (
  id          uuid primary key default gen_random_uuid(),
  server_id   uuid not null references public.servers(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  revoked_at  timestamptz
);

-- ---------------------------------------------------------------------
-- audit_log: append-only, minimal. No file paths or contents — only
-- enough to answer "who connected to what, and when".
-- ---------------------------------------------------------------------
create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  server_id   uuid references public.servers(id) on delete set null,
  user_id     uuid references auth.users(id) on delete set null,
  event       text not null,     -- e.g. 'agent_connected', 'agent_disconnected',
                                   -- 'access_granted', 'access_revoked', 'server_registered'
  detail      jsonb
);

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.servers enable row level security;
alter table public.pairing_codes enable row level security;
alter table public.access_grants enable row level security;
alter table public.relay_sessions enable row level security;
alter table public.audit_log enable row level security;

-- Owners can see/manage their own servers. The relay process itself
-- uses the Supabase service-role key (bypasses RLS) for cross-cutting
-- reads like "which servers are public" — RLS here protects direct
-- client-side queries from the dashboard's browser Supabase client.
create policy "owners manage their own servers"
  on public.servers for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy "anyone can read public online servers"
  on public.servers for select
  using (is_public = true and revoked_at is null);

create policy "owners manage their own pairing codes"
  on public.pairing_codes for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy "owners manage grants on their servers"
  on public.access_grants for all
  using (exists (
    select 1 from public.servers s
    where s.id = access_grants.server_id and s.owner_id = auth.uid()
  ));

create policy "grantees can see their own grants"
  on public.access_grants for select
  using (user_id = auth.uid());

create policy "users see their own relay sessions"
  on public.relay_sessions for select
  using (user_id = auth.uid());

create policy "owners can read audit log for their servers"
  on public.audit_log for select
  using (exists (
    select 1 from public.servers s
    where s.id = audit_log.server_id and s.owner_id = auth.uid()
  ));
