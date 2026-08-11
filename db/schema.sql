
create table if not exists admins(
  id bigserial primary key,
  email text unique not null,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists settings(
  id integer primary key default 1 check(id=1),
  brand_name text not null default 'Singles Club',
  page_title text not null default 'Singles Club',
  city text not null default 'Los Angeles',
  contact_email text default '',
  business_address text default '',
  site_url text default 'https://sj-smart-living.github.io/singles-club/',
  stripe_url text default '',
  zelle_name text default '',
  zelle_contact text default '',
  qr_label text default '扫码付款',
  qr_image bytea,
  qr_mime text,
  updated_at timestamptz not null default now()
);
insert into settings(id) values(1) on conflict(id) do nothing;

create table if not exists membership_plans(
  id bigserial primary key,
  tier text unique not null check(tier in ('community','select','private')),
  name_zh text not null,
  name_en text not null,
  price numeric(10,2) not null default 0,
  duration_days integer not null default 365,
  summary_zh text default '',
  summary_en text default '',
  features_zh text default '',
  features_en text default '',
  stripe_url text default '',
  sort_order integer not null default 0,
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into membership_plans(tier,name_zh,name_en,price,duration_days,summary_zh,summary_en,features_zh,features_en,sort_order)
values
('community','Community 会员','Community Membership',99,365,'获得俱乐部基础参与资格，可报名 Community 等级活动。','Core club access for Community-level activities.','会员编号\n公开会员活动报名资格\n个人报名记录\n活动通知','Member number\nCommunity event access\nBooking history\nActivity updates',1),
('select','Select 会员','Select Membership',299,365,'包含 Community 权益，并可参加更小规模的 Select 活动。','Includes Community access plus smaller Select activities.','包含 Community 权益\nSelect 小型活动\n优先活动通知\n一次需求沟通','Community benefits\nSelect events\nPriority updates\nOne preference conversation',2),
('private','Private 会员','Private Membership',599,365,'包含 Select 权益，可参与经双方同意的个性化线下交流协调。','Includes Select access and consent-based personalized offline coordination.','包含 Select 权益\nPrivate 等级活动\n个性化需求沟通\n经双方同意的线下交流协调','Select benefits\nPrivate-tier activities\nPersonal preference conversation\nConsent-based offline coordination',3)
on conflict(tier) do nothing;

create table if not exists members(
  id bigserial primary key,
  member_number text unique not null,
  display_name text not null,
  age integer not null check(age>=18),
  city text not null,
  contact text not null,
  intro text default '',
  preferences text default '',
  photo bytea,
  photo_mime text,
  tier text not null check(tier in ('community','select','private')),
  status text not null default 'awaiting_payment'
    check(status in ('awaiting_payment','payment_pending','active','expired','suspended','cancelled','refunded')),
  starts_at timestamptz,
  expires_at timestamptz,
  payment_method text default '',
  payment_reference text default '',
  payment_submitted_at timestamptz,
  payment_received_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists members_contact_idx on members(lower(contact));
create index if not exists members_status_idx on members(status,tier);

create table if not exists events(
  id bigserial primary key,
  title_zh text not null,
  title_en text not null,
  description_zh text default '',
  description_en text default '',
  start_at timestamptz not null,
  deadline_at timestamptz,
  city text not null,
  region text default 'CA',
  country text default 'US',
  public_venue text default '确认后提供具体地点',
  private_venue text default '',
  capacity integer not null default 10,
  confirmed_count integer not null default 0,
  price numeric(10,2) not null default 0,
  currency text not null default 'USD',
  required_tier text not null default 'community'
    check(required_tier in ('community','select','private')),
  image bytea,
  image_mime text,
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists event_bookings(
  id bigserial primary key,
  booking_number text unique not null,
  member_id bigint not null references members(id) on delete cascade,
  event_id bigint not null references events(id) on delete cascade,
  status text not null default 'awaiting_payment'
    check(status in ('awaiting_payment','payment_pending','payment_received','confirmed','venue_unlocked','checked_in','completed','cancelled','refunded')),
  amount_due numeric(10,2) not null default 0,
  currency text not null default 'USD',
  payment_method text default '',
  payment_reference text default '',
  payment_submitted_at timestamptz,
  payment_received_at timestamptz,
  venue_unlocked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(member_id,event_id)
);
create index if not exists event_bookings_event_status_idx on event_bookings(event_id,status);

create table if not exists posts(
  id bigserial primary key,
  post_type text not null default 'club',
  theme text not null default 'club',
  title_zh text default '',
  title_en text default '',
  content_zh text not null,
  content_en text default '',
  cta_label_zh text default '',
  cta_label_en text default '',
  cta_url text default '',
  expires_at timestamptz,
  is_public boolean not null default true,
  created_at timestamptz not null default now()
);

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS post_type TEXT NOT NULL DEFAULT 'club';

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS theme TEXT NOT NULL DEFAULT 'club';

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS title_zh TEXT DEFAULT '';

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS title_en TEXT DEFAULT '';

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS content_zh TEXT DEFAULT '';

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS content_en TEXT DEFAULT '';

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS cta_label_zh TEXT DEFAULT '';

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS cta_label_en TEXT DEFAULT '';

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS cta_url TEXT DEFAULT '';

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

insert into posts(post_type,theme,title_zh,title_en,content_zh,content_en)
select 'club','coffee','本周咖啡交流','Coffee this week','本周新增一场小型咖啡交流，活动仅向有效会员开放。','A new small coffee gathering is open to active members.'
where not exists(select 1 from posts);

-- Upgrade an existing events table safely.

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS title_zh TEXT NOT NULL DEFAULT '';

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS title_en TEXT NOT NULL DEFAULT '';

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS description_zh TEXT DEFAULT '';

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS description_en TEXT DEFAULT '';

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS start_at TIMESTAMPTZ;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS deadline_at TIMESTAMPTZ;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS city TEXT NOT NULL DEFAULT '';

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS region TEXT DEFAULT '';

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS country TEXT DEFAULT 'US';

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Los_Angeles';

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS latitude NUMERIC(9,6);

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS longitude NUMERIC(9,6);

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS cover_key TEXT DEFAULT '';

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS public_venue TEXT DEFAULT '';

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS private_venue TEXT DEFAULT '';

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS capacity INTEGER NOT NULL DEFAULT 10;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS confirmed_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS price NUMERIC(10,2) NOT NULL DEFAULT 0;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD';

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS required_tier TEXT NOT NULL DEFAULT 'community';

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS image BYTEA;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS image_mime TEXT;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

insert into events(title_zh,title_en,description_zh,description_en,start_at,city,price,required_tier,capacity)
select '周末咖啡交流','Weekend Coffee Conversation','在轻松环境中认识新朋友。活动仅向有效会员开放。','Meet new people in a relaxed setting. Active membership required.',now()+interval '7 days','Pasadena',29,'community',12
where not exists(select 1 from events);


-- Global premium fields (idempotent).
alter table settings add column if not exists default_locale text not null default 'en-US';
alter table settings add column if not exists default_currency text not null default 'USD';
alter table settings add column if not exists default_timezone text not null default 'America/Los_Angeles';
alter table settings add column if not exists privacy_contact text default '';
alter table settings add column if not exists operator_legal_name text default '';

alter table events add column if not exists timezone text not null default 'America/Los_Angeles';
alter table events add column if not exists latitude numeric(9,6);
alter table events add column if not exists longitude numeric(9,6);
alter table events add column if not exists cover_key text default '';
alter table events add column if not exists local_currency text default '';

alter table members add column if not exists consent_version text default '';
alter table members add column if not exists consented_at timestamptz;
alter table members add column if not exists preferred_language text default 'zh';


-- Public event submission workflow.
create table if not exists public_event_submissions(
  id bigserial primary key,
  submission_number text unique not null,
  organizer_name text not null,
  organizer_contact text not null,
  title text not null,
  description text not null,
  city text not null,
  country text not null,
  public_area text not null,
  start_at timestamptz not null,
  price numeric(10,2) not null default 0,
  currency text not null default 'USD',
  required_tier text not null default 'community'
    check(required_tier in ('community','select','private')),
  status text not null default 'pending'
    check(status in ('pending','approved','rejected','withdrawn')),
  admin_note text default '',
  approved_event_id bigint references events(id) on delete set null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
create index if not exists public_event_submissions_status_idx on public_event_submissions(status,created_at);


-- LivingHub v1.1 compatible product migration.
alter table public_event_submissions add column if not exists partner_member_id bigint references members(id) on delete set null;
alter table public_event_submissions add column if not exists provenance_code text default '';
alter table events add column if not exists provenance_code text default '';
alter table events add column if not exists canonical_url text default '';

-- Keep the existing tier identifiers and payment columns while presenting two active products.
update membership_plans set
  name_zh='LivingHub 年度会员',name_en='LivingHub Annual Member',price=299,duration_days=365,
  summary_zh='获得平台年度会员资格，可浏览和报名符合条件的洛杉矶活动；每场活动费用另付。',
  summary_en='Annual platform membership for eligible Los Angeles experiences; each experience may charge separately.',
  features_zh='年度会员编号\n浏览公开活动\n报名符合条件的活动\n会员专属合作商家服务区\n具体地址按条件开放',
  features_en='Annual member number\nPublic experience discovery\nEligible event booking\nMember partner benefits\nConditional venue release',
  sort_order=1,is_active=true,updated_at=now()
where tier='community';

update membership_plans set is_active=false,sort_order=2,updated_at=now() where tier='select';

update membership_plans set
  name_zh='LivingHub 年度合作会员',name_en='LivingHub Annual Partner Member',price=2990,duration_days=365,
  summary_zh='包含年度会员权益，并获得活动与合作商家信息提交资格；所有公开内容仍须平台审核。',
  summary_en='Includes annual member access plus the right to submit experiences and partner listings, subject to platform review.',
  features_zh='包含年度会员全部权益\n提交活动与商家信息\n审核后进入地图与活动列表\n管理活动报名\n每场活动可单独设置费用',
  features_en='All annual member benefits\nSubmit experiences and partner listings\nMap publication after review\nBooking management\nSeparate pricing per experience',
  sort_order=2,is_active=true,updated_at=now()
where tier='private';

update settings set brand_name='LivingHub',page_title='LivingHub · Singles Club',city='Greater Los Angeles',site_url='https://livinghub.app',updated_at=now() where id=1;

-- =========================================================
-- LivingHub v1.1 open-organizer compatibility migrations
-- =========================================================
UPDATE membership_plans SET
  name_zh='Basic 免费会员', name_en='Basic Member', price=0, duration_days=3650,
  summary_zh='免费注册后可报名普通活动，也可提交自己的活动；所有公开活动仍需平台审核。',
  summary_en='Free registration for standard event booking and moderated event submissions.',
  features_zh='免费注册\n报名 Basic 活动\n提交自己的活动\n查看自己的报名记录',
  features_en='Free registration\nBook Basic events\nSubmit your own events\nView booking records',
  sort_order=1,is_active=true,updated_at=now() WHERE tier='community';

UPDATE membership_plans SET
  name_zh='Annual 年度会员', name_en='Annual Member', price=299, duration_days=365,
  summary_zh='可参加组织者设置为 Annual Member 限定的活动；每场活动费用仍由组织者单独设置和收取。',
  summary_en='Access to organizer-designated Annual Member events. Event fees remain separate and are collected by organizers.',
  features_zh='包含 Basic 权益\n可报名 Annual Member 限定活动\n年度会员状态',
  features_en='Includes Basic access\nAnnual Member-only events\nAnnual membership status',
  sort_order=2,is_active=true,updated_at=now() WHERE tier='select';

UPDATE membership_plans SET is_active=false,updated_at=now() WHERE tier='private';


-- Existing community registrations become active because Basic is now free.
UPDATE members
SET status='active',
    starts_at=coalesce(starts_at,now()),
    expires_at=coalesce(expires_at,now()+interval '3650 days'),
    updated_at=now()
WHERE tier='community'
  AND status IN ('awaiting_payment','payment_pending');

ALTER TABLE public_event_submissions ADD COLUMN IF NOT EXISTS min_participants integer NOT NULL DEFAULT 2;
ALTER TABLE public_event_submissions ADD COLUMN IF NOT EXISTS capacity integer NOT NULL DEFAULT 10;
ALTER TABLE public_event_submissions ADD COLUMN IF NOT EXISTS deadline_at timestamptz;
ALTER TABLE public_event_submissions ADD COLUMN IF NOT EXISTS payment_method text DEFAULT '';
ALTER TABLE public_event_submissions ADD COLUMN IF NOT EXISTS payment_name text DEFAULT '';
ALTER TABLE public_event_submissions ADD COLUMN IF NOT EXISTS payment_contact text DEFAULT '';
ALTER TABLE public_event_submissions ADD COLUMN IF NOT EXISTS payment_url text DEFAULT '';
ALTER TABLE public_event_submissions ADD COLUMN IF NOT EXISTS payment_qr bytea;
ALTER TABLE public_event_submissions ADD COLUMN IF NOT EXISTS payment_qr_mime text;
ALTER TABLE public_event_submissions ADD COLUMN IF NOT EXISTS refund_policy text DEFAULT '';
ALTER TABLE public_event_submissions ADD COLUMN IF NOT EXISTS cover_image bytea;
ALTER TABLE public_event_submissions ADD COLUMN IF NOT EXISTS cover_mime text;
ALTER TABLE public_event_submissions ADD COLUMN IF NOT EXISTS organizer_terms_version text DEFAULT '2026-08-11';

ALTER TABLE events ADD COLUMN IF NOT EXISTS organizer_member_id bigint REFERENCES members(id) ON DELETE SET NULL;
ALTER TABLE events ADD COLUMN IF NOT EXISTS organizer_name text DEFAULT '';
ALTER TABLE events ADD COLUMN IF NOT EXISTS organizer_contact text DEFAULT '';
ALTER TABLE events ADD COLUMN IF NOT EXISTS organizer_payment_method text DEFAULT '';
ALTER TABLE events ADD COLUMN IF NOT EXISTS organizer_payment_name text DEFAULT '';
ALTER TABLE events ADD COLUMN IF NOT EXISTS organizer_payment_contact text DEFAULT '';
ALTER TABLE events ADD COLUMN IF NOT EXISTS organizer_payment_url text DEFAULT '';
ALTER TABLE events ADD COLUMN IF NOT EXISTS organizer_payment_qr bytea;
ALTER TABLE events ADD COLUMN IF NOT EXISTS organizer_payment_qr_mime text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS refund_policy text DEFAULT '';
ALTER TABLE events ADD COLUMN IF NOT EXISTS min_participants integer NOT NULL DEFAULT 2;
ALTER TABLE events ADD COLUMN IF NOT EXISTS event_status text NOT NULL DEFAULT 'recruiting';
ALTER TABLE events ADD COLUMN IF NOT EXISTS cancellation_reason text DEFAULT '';
ALTER TABLE events ADD COLUMN IF NOT EXISTS share_code text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS organizer_terms_version text DEFAULT '2026-08-11';
CREATE UNIQUE INDEX IF NOT EXISTS events_share_code_unique ON events(share_code) WHERE share_code IS NOT NULL;
