
create table if not exists settings (
  id integer primary key default 1 check (id = 1),
  brand_name text not null default 'Singles Club',
  page_title text not null default 'Singles Club — Real Events and Serious Connections',
  city text not null default 'Los Angeles, California',
  contact_email text not null default 'hello@example.com',
  business_address text default '',
  site_url text default '',
  stripe_url text default '',
  zelle_name text default '',
  zelle_contact text default '',
  qr_label text default '',
  qr_image bytea,
  qr_mime text,
  updated_at timestamptz not null default now()
);

create table if not exists admins (
  id bigserial primary key,
  email text unique not null,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists events (
  id bigserial primary key,
  title_zh text,
  title_en text not null,
  description_zh text default '',
  description_en text default '',
  start_at timestamptz not null,
  deadline_at timestamptz,
  city text not null,
  region text default 'CA',
  country text default 'US',
  public_venue text default 'Venue shared after confirmation',
  private_venue text default '',
  capacity integer not null default 0,
  confirmed_count integer not null default 0,
  price numeric(10,2) not null default 0,
  currency text not null default 'USD',
  image bytea,
  image_mime text,
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists posts (
  id bigserial primary key,
  post_type text not null default 'platform' check (post_type in ('platform','activity')),
  content_zh text default '',
  content_en text not null,
  expires_at timestamptz,
  is_public boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists plans (
  id bigserial primary key,
  name text not null,
  price numeric(10,2) not null,
  summary_zh text default '',
  summary_en text default '',
  features_zh text default '',
  features_en text default '',
  stripe_url text default '',
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists applications (
  id bigserial primary key,
  application_code text unique not null,
  display_name text not null,
  age integer not null check (age >= 18),
  city text not null,
  contact text not null,
  relationship_goal text default '',
  intro text default '',
  offer_type text not null check (offer_type in ('event','plan')),
  event_id bigint references events(id) on delete set null,
  plan_id bigint references plans(id) on delete set null,
  status text not null default 'submitted',
  private_venue text default '',
  payment_reference text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists application_photos (
  id bigserial primary key,
  application_id bigint not null references applications(id) on delete cascade,
  image bytea not null,
  mime text not null,
  sort_order integer not null default 0,
  approved boolean not null default false,
  created_at timestamptz not null default now()
);

insert into settings (id) values (1) on conflict (id) do nothing;

insert into plans (name,price,summary_zh,summary_en,features_zh,features_en,sort_order)
select * from (values
('Club',99,'进入本地活动与公共学习小组。','Access local events and public learning groups.','每月1次基础活动\n公共学习小组\n有限会员简介','1 basic event monthly\nPublic learning groups\nLimited member profiles',1),
('Connection',299,'更多真实活动、授权会员资料和人工介绍。','More events, authorized profiles, and human introductions.','每月3次活动或小组\n更多授权简介\n优先报名\n有限人工介绍','3 events or groups monthly\nMore authorized profiles\nPriority registration\nLimited human introductions',2),
('Private',599,'私人活动与更深入的人工服务。','Private events and deeper human support.','人工整理资料\n每月人工推荐\n私人小型活动\n双人体验协调','Human profile preparation\nMonthly recommendations\nPrivate small events\nCouple experience coordination',3)
) as v(name,price,summary_zh,summary_en,features_zh,features_en,sort_order)
where not exists (select 1 from plans);

insert into events (title_zh,title_en,start_at,city,capacity,price)
select * from (values
('咖啡与认真交流','Coffee & Conversation',now()+interval '14 days','Pasadena',12,49),
('周日城市散步','Sunday City Walk',now()+interval '21 days','Los Angeles',16,39),
('小型主题晚餐','Small Group Dinner',now()+interval '28 days','Arcadia',10,69)
) as v(title_zh,title_en,start_at,city,capacity,price)
where not exists (select 1 from events);

insert into posts (post_type,content_zh,content_en)
select * from (values
('platform','本周活动申请即将截止。','Applications close soon this week.'),
('activity','Pasadena 咖啡交流剩余少量确认名额。','A few confirmed spots remain for the Pasadena coffee meetup.')
) as v(post_type,content_zh,content_en)
where not exists (select 1 from posts);
