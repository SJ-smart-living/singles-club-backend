
import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import sharp from 'sharp';
import pg from 'pg';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const {Pool}=pg;
const __dirname=path.dirname(fileURLToPath(import.meta.url));
const rootDir=path.resolve(__dirname,'..');
const app=express();
const pool=new Pool({
  connectionString:process.env.DATABASE_URL,
  ssl:process.env.NODE_ENV==='production'?{rejectUnauthorized:false}:false
});
const PORT=process.env.PORT||3000;
const SECRET=process.env.SESSION_SECRET||'change-this-in-render';
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024,files:1}});

app.use(helmet({contentSecurityPolicy:false}));
app.use(cors({
  origin:(origin,cb)=>{
    const allowed=(process.env.FRONTEND_ORIGIN||'').split(',').map(x=>x.trim()).filter(Boolean);
    const own=process.env.PUBLIC_BASE_URL||'';
    if(!origin||allowed.length===0||allowed.includes(origin)||origin===own)return cb(null,true);
    cb(new Error('Origin not allowed'));
  },
  credentials:true
}));
app.use(express.json({limit:'1mb'}));
app.use(express.urlencoded({extended:true}));
app.use(cookieParser());

async function migrate(){
  await pool.query(await fs.readFile(path.join(rootDir,'db/schema.sql'),'utf8'));
  if(process.env.ADMIN_EMAIL&&process.env.ADMIN_PASSWORD){
    const email=process.env.ADMIN_EMAIL.toLowerCase().trim();
    const hash=await bcrypt.hash(process.env.ADMIN_PASSWORD,12);
    await pool.query(`insert into admins(email,password_hash) values($1,$2)
      on conflict(email) do update set password_hash=excluded.password_hash`,[email,hash]);
  }
}
await migrate();

const tierRank={community:1,select:2,private:3};
const memberStatus=['awaiting_payment','payment_pending','active','expired','suspended','cancelled','refunded'];
const bookingStatus=['awaiting_payment','payment_pending','payment_received','confirmed','venue_unlocked','checked_in','completed','cancelled','refunded'];

function makeCode(prefix){
  return `${prefix}-${new Date().toISOString().slice(2,10).replaceAll('-','')}-${Math.random().toString(36).slice(2,7).toUpperCase()}`;
}
function auth(req,res,next){
  const token=req.cookies.admin_token||req.headers.authorization?.replace('Bearer ','');
  if(!token)return res.status(401).json({error:'Unauthorized'});
  try{req.admin=jwt.verify(token,SECRET);next()}catch{res.status(401).json({error:'Unauthorized'})}
}
async function image(buffer){
  return sharp(buffer).rotate().resize({width:1400,height:1400,fit:'inside',withoutEnlargement:true}).jpeg({quality:82}).toBuffer();
}
async function settings(){
  return (await pool.query(`select stripe_url,zelle_name,zelle_contact,qr_label,
    (qr_image is not null) has_qr from settings where id=1`)).rows[0];
}
function paymentView(s,stripe=''){
  return {stripe_url:stripe||s.stripe_url||'',zelle_name:s.zelle_name||'',zelle_contact:s.zelle_contact||'',qr_label:s.qr_label||'',has_qr:Boolean(s.has_qr)};
}
function membershipActive(m){
  return m&&m.status==='active'&&(!m.expires_at||new Date(m.expires_at)>new Date());
}

app.get('/api/health',(_req,res)=>res.json({ok:true,service:'singles-club-backend',version:'1.0.0',build:'livinghub-v1.1-compatible'}));

app.get('/api/public',async(_req,res)=>{
  const [s,p,e,posts]=await Promise.all([
    pool.query(`select brand_name,page_title,city,contact_email,business_address,site_url,default_locale,default_currency,default_timezone,updated_at from settings where id=1`),
    pool.query(`select id,tier,name_zh,name_en,price,duration_days,summary_zh,summary_en,features_zh,features_en,sort_order from membership_plans where is_active=true order by sort_order`),
    pool.query(`select e.id,e.title_zh,e.title_en,e.description_zh,e.description_en,e.start_at,e.deadline_at,e.city,e.region,e.country,e.timezone,e.latitude,e.longitude,e.cover_key,e.provenance_code,e.canonical_url,e.public_venue,e.capacity,e.confirmed_count,e.price,e.currency,e.required_tier,(e.image is not null) has_image,
      greatest(0,e.capacity-e.confirmed_count-coalesce((select count(*) from event_bookings b where b.event_id=e.id and b.status in ('awaiting_payment','payment_pending')),0))::int available_spots
      from events e where e.is_public=true and e.start_at>now()-interval '1 day' order by e.start_at`),
    pool.query(`select * from posts where is_public=true and (expires_at is null or expires_at>now()) order by created_at desc limit 20`)
  ]);
  res.json({settings:s.rows[0],plans:p.rows,events:e.rows,posts:posts.rows});
});
app.get('/api/events/:id/image',async(req,res)=>{
  const r=await pool.query('select image,image_mime from events where id=$1 and is_public=true',[req.params.id]);
  if(!r.rows[0]?.image)return res.status(404).end();
  res.type(r.rows[0].image_mime||'image/jpeg').send(r.rows[0].image);
});
app.get('/api/payment-qr',async(_req,res)=>{
  const r=await pool.query('select qr_image,qr_mime from settings where id=1');
  if(!r.rows[0]?.qr_image)return res.status(404).end();
  res.type(r.rows[0].qr_mime||'image/png').send(r.rows[0].qr_image);
});


app.post('/api/public-event-submissions',async(req,res)=>{
  const b=req.body||{};
  const required=['member_number','member_contact','organizer_name','organizer_contact','title','description','city','country','public_area','start_at'];
  for(const key of required){if(!String(b[key]||'').trim())return res.status(400).json({error:`Missing ${key}`})}
  const partner=(await pool.query(`select * from members where lower(member_number)=lower($1) and lower(contact)=lower($2) and tier='private' limit 1`,[b.member_number,b.member_contact])).rows[0];
  if(!membershipActive(partner))return res.status(403).json({error:'Active Partner Membership required'});
  if(!['community','private'].includes(b.required_tier||'community'))return res.status(400).json({error:'Invalid membership tier'});
  const submissionNumber=makeCode('SUB');
  const provenanceCode=`LH-${submissionNumber}`;
  const r=await pool.query(`insert into public_event_submissions(
    submission_number,partner_member_id,provenance_code,organizer_name,organizer_contact,title,description,city,country,
    public_area,start_at,price,currency,required_tier
  ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
  returning submission_number,status,provenance_code,created_at`,[
    submissionNumber,partner.id,provenanceCode,String(b.organizer_name).trim().slice(0,100),
    String(b.organizer_contact).trim().slice(0,160),String(b.title).trim().slice(0,140),
    String(b.description).trim().slice(0,1600),String(b.city).trim().slice(0,100),
    String(b.country).trim().slice(0,100),String(b.public_area).trim().slice(0,160),b.start_at,
    Number(b.price||0),String(b.currency||'USD').slice(0,3).toUpperCase(),b.required_tier||'community'
  ]);
  res.status(201).json(r.rows[0]);
});

app.post('/api/memberships',upload.single('photo'),async(req,res)=>{
  try{
    const {display_name,age,city,contact,intro,preferences,tier}=req.body;
    if(!display_name||!age||!city||!contact||!tier)return res.status(400).json({error:'Missing required fields'});
    if(Number(age)<18)return res.status(400).json({error:'Adults only'});
    if(!tierRank[tier])return res.status(400).json({error:'Invalid membership tier'});
    const plan=(await pool.query('select * from membership_plans where tier=$1 and is_active=true',[tier])).rows[0];
    if(!plan)return res.status(404).json({error:'Membership plan not available'});
    const existing=(await pool.query(`select * from members where lower(contact)=lower($1) and status in ('awaiting_payment','payment_pending','active') order by created_at desc limit 1`,[contact.trim()])).rows[0];
    if(existing)return res.status(409).json({error:'A membership already exists for this contact',member_number:existing.member_number,status:existing.status});
    const memberNumber=makeCode('MEM');
    const photo=req.file?await image(req.file.buffer):null;
    const r=await pool.query(`insert into members(member_number,display_name,age,city,contact,intro,preferences,tier,status,photo,photo_mime,consent_version,consented_at,preferred_language)
      values($1,$2,$3,$4,$5,$6,$7,$8,'awaiting_payment',$9,$10,$11,now(),$12)
      returning member_number,status,tier,created_at`,
      [memberNumber,display_name.trim(),Number(age),city.trim(),contact.trim(),intro||'',preferences||'',tier,photo,photo?'image/jpeg':null,req.body.consent_version||'2026-08-05',req.body.preferred_language||'zh']);
    const s=await settings();
    res.json({...r.rows[0],plan:{name_zh:plan.name_zh,name_en:plan.name_en,price:plan.price,duration_days:plan.duration_days},payment:paymentView(s,plan.stripe_url)});
  }catch(e){console.error(e);res.status(500).json({error:'Unable to create membership'})}
});

app.post('/api/membership-payment-submitted',async(req,res)=>{
  const {member_number,contact,payment_method,payment_reference}=req.body;
  const r=await pool.query(`update members set status='payment_pending',payment_method=$1,payment_reference=$2,payment_submitted_at=now(),updated_at=now()
    where lower(member_number)=lower($3) and lower(contact)=lower($4) and status in ('awaiting_payment','payment_pending')
    returning member_number,status`,
    [String(payment_method||'other').slice(0,40),String(payment_reference||'').slice(0,200),member_number||'',contact||'']);
  if(!r.rows[0])return res.status(404).json({error:'Membership not found or already processed'});
  res.json(r.rows[0]);
});

app.post('/api/membership-status',async(req,res)=>{
  const {member_number,contact}=req.body;
  const r=await pool.query(`select m.member_number,m.display_name,m.tier,m.status,m.starts_at,m.expires_at,m.payment_method,m.payment_reference,
    p.name_zh,p.name_en,p.price,p.stripe_url
    from members m join membership_plans p on p.tier=m.tier
    where lower(m.member_number)=lower($1) and lower(m.contact)=lower($2) limit 1`,[member_number||'',contact||'']);
  if(!r.rows[0])return res.status(404).json({error:'Membership not found'});
  const s=await settings();
  res.json({...r.rows[0],payment:paymentView(s,r.rows[0].stripe_url)});
});

app.post('/api/event-bookings',async(req,res)=>{
  const client=await pool.connect();
  try{
    const {member_number,contact,event_id}=req.body;
    await client.query('begin');
    const m=(await client.query(`select * from members where lower(member_number)=lower($1) and lower(contact)=lower($2) for update`,[member_number||'',contact||''])).rows[0];
    if(!m)return res.status(404).json({error:'Member not found'});
    if(!membershipActive(m))return res.status(403).json({error:'Active membership required',membership_status:m.status});
    const e=(await client.query(`select e.*,
      greatest(0,e.capacity-e.confirmed_count-coalesce((select count(*) from event_bookings b where b.event_id=e.id and b.status in ('awaiting_payment','payment_pending')),0))::int available_spots
      from events e where e.id=$1 and e.is_public=true for update`,[Number(event_id)])).rows[0];
    if(!e)return res.status(404).json({error:'Event not available'});
    if(tierRank[m.tier]<tierRank[e.required_tier])return res.status(403).json({error:`${e.required_tier} membership required`,required_tier:e.required_tier,current_tier:m.tier});
    if(e.deadline_at&&new Date(e.deadline_at)<=new Date())return res.status(409).json({error:'Registration closed'});
    if(Number(e.available_spots)<=0)return res.status(409).json({error:'No spots available'});
    const prior=(await client.query('select * from event_bookings where member_id=$1 and event_id=$2',[m.id,e.id])).rows[0];
    if(prior)return res.status(409).json({error:'Already booked',booking_number:prior.booking_number,status:prior.status});
    const status=Number(e.price)>0?'awaiting_payment':'confirmed';
    const b=(await client.query(`insert into event_bookings(booking_number,member_id,event_id,status,amount_due,currency)
      values($1,$2,$3,$4,$5,$6) returning booking_number,status,amount_due,currency`,
      [makeCode('EVT'),m.id,e.id,status,e.price,e.currency])).rows[0];
    if(status==='confirmed')await client.query('update events set confirmed_count=confirmed_count+1 where id=$1',[e.id]);
    await client.query('commit');
    res.json({...b,event_title:e.title_zh||e.title_en,payment:paymentView(await settings())});
  }catch(e){await client.query('rollback');console.error(e);res.status(500).json({error:e.message||'Unable to book event'})}
  finally{client.release()}
});

app.post('/api/event-payment-submitted',async(req,res)=>{
  const {booking_number,member_number,contact,payment_method,payment_reference}=req.body;
  const r=await pool.query(`update event_bookings b set status='payment_pending',payment_method=$1,payment_reference=$2,payment_submitted_at=now(),updated_at=now()
    from members m where b.member_id=m.id and lower(b.booking_number)=lower($3) and lower(m.member_number)=lower($4) and lower(m.contact)=lower($5)
      and b.status in ('awaiting_payment','payment_pending') returning b.booking_number,b.status`,
    [String(payment_method||'other').slice(0,40),String(payment_reference||'').slice(0,200),booking_number||'',member_number||'',contact||'']);
  if(!r.rows[0])return res.status(404).json({error:'Booking not found or already processed'});
  res.json(r.rows[0]);
});

app.post('/api/event-booking-status',async(req,res)=>{
  const {booking_number,member_number,contact}=req.body;
  const r=await pool.query(`select b.booking_number,b.status,b.amount_due,b.currency,b.payment_method,b.payment_reference,b.created_at,
    e.title_zh,e.title_en,e.start_at,e.city,e.private_venue,m.member_number
    from event_bookings b join members m on m.id=b.member_id join events e on e.id=b.event_id
    where lower(b.booking_number)=lower($1) and lower(m.member_number)=lower($2) and lower(m.contact)=lower($3) limit 1`,
    [booking_number||'',member_number||'',contact||'']);
  if(!r.rows[0])return res.status(404).json({error:'Booking not found'});
  const row=r.rows[0];
  const showVenue=['venue_unlocked','checked_in','completed'].includes(row.status);
  res.json({...row,private_venue:showVenue?row.private_venue:'',payment:paymentView(await settings())});
});

app.post('/api/admin/login',async(req,res)=>{
  const email=String(req.body.email||'').trim().toLowerCase();
  const password=String(req.body.password||'').trim();
  if(!email||!password)return res.status(400).json({error:'Email and password are required'});

  const envEmail=String(process.env.ADMIN_EMAIL||'').trim().toLowerCase();
  const envPassword=String(process.env.ADMIN_PASSWORD||'').trim();
  let admin=null;
  let valid=false;

  // The Render environment values are the canonical operator credentials.
  // This keeps login available even if an older database hash was not refreshed.
  if(envEmail&&envPassword&&email===envEmail&&password===envPassword){
    admin=(await pool.query('select * from admins where email=$1',[email])).rows[0];
    if(!admin){
      const hash=await bcrypt.hash(envPassword,12);
      admin=(await pool.query('insert into admins(email,password_hash) values($1,$2) returning *',[email,hash])).rows[0];
    }
    valid=true;
  }else{
    admin=(await pool.query('select * from admins where email=$1',[email])).rows[0];
    valid=Boolean(admin&&await bcrypt.compare(password,admin.password_hash));
  }

  if(!valid||!admin)return res.status(401).json({error:'Invalid email or admin password'});
  const token=jwt.sign({id:admin.id,email:admin.email},SECRET,{expiresIn:'12h'});
  res.cookie('admin_token',token,{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',path:'/',maxAge:43200000});
  res.json({ok:true,token,email:admin.email});
});
app.post('/api/admin/logout',(_req,res)=>{res.clearCookie('admin_token',{sameSite:'lax',secure:process.env.NODE_ENV==='production',path:'/'});res.json({ok:true})});
app.get('/api/admin/me',auth,(req,res)=>res.json(req.admin));

app.get('/api/admin/dashboard',auth,async(_req,res)=>{
  const [members,bookings,events,submissions]=await Promise.all([
    pool.query(`select status,count(*)::int count from members group by status`),
    pool.query(`select status,count(*)::int count from event_bookings group by status`),
    pool.query(`select count(*)::int count from events where start_at>now()`),
    pool.query(`select count(*)::int count from public_event_submissions where status='pending'`)
  ]);
  res.json({members:Object.fromEntries(members.rows.map(x=>[x.status,x.count])),bookings:Object.fromEntries(bookings.rows.map(x=>[x.status,x.count])),upcoming_events:events.rows[0].count,pending_submissions:submissions.rows[0].count});
});


app.get('/api/admin/submissions',auth,async(_req,res)=>{
  res.json((await pool.query(`select * from public_event_submissions order by created_at desc`)).rows);
});

app.patch('/api/admin/submissions/:id',auth,async(req,res)=>{
  const {status,admin_note}=req.body||{};
  if(!['pending','approved','rejected','withdrawn'].includes(status)){
    return res.status(400).json({error:'Invalid submission status'});
  }
  const client=await pool.connect();
  try{
    await client.query('begin');
    const submission=(await client.query(
      'select * from public_event_submissions where id=$1 for update',[req.params.id]
    )).rows[0];
    if(!submission)return res.status(404).json({error:'Submission not found'});

    let eventId=submission.approved_event_id;
    if(status==='approved'&&!eventId){
      const event=(await client.query(`insert into events(
        title_zh,title_en,description_zh,description_en,start_at,city,country,
        timezone,public_venue,capacity,price,currency,required_tier,is_public,provenance_code,canonical_url
      ) values($1,$1,$2,$2,$3,$4,$5,'America/Los_Angeles',$6,12,$7,$8,$9,true,$10,$11) returning id`,[
        submission.title,submission.description,submission.start_at,submission.city,
        submission.country,submission.public_area,submission.price,submission.currency,
        submission.required_tier,submission.provenance_code,`${process.env.FRONTEND_ORIGIN?.split(',')[0]||'https://livinghub.app'}/?event=${submission.submission_number}`
      ])).rows[0];
      eventId=event.id;
    }

    await client.query(`update public_event_submissions set
      status=$1,admin_note=$2,approved_event_id=$3,reviewed_at=now()
      where id=$4`,[status,String(admin_note||'').slice(0,1000),eventId,req.params.id]);
    await client.query('commit');
    res.json({ok:true,status,approved_event_id:eventId});
  }catch(error){
    await client.query('rollback');
    console.error(error);
    res.status(500).json({error:'Unable to review submission'});
  }finally{client.release()}
});

app.get('/api/admin/plans',auth,async(_req,res)=>res.json((await pool.query('select * from membership_plans order by sort_order')).rows));
app.patch('/api/admin/plans/:id',auth,async(req,res)=>{
  const b=req.body;
  await pool.query(`update membership_plans set name_zh=$1,name_en=$2,price=$3,duration_days=$4,summary_zh=$5,summary_en=$6,features_zh=$7,features_en=$8,stripe_url=$9,sort_order=$10,is_active=$11,updated_at=now() where id=$12`,
  [b.name_zh,b.name_en,Number(b.price||0),Number(b.duration_days||365),b.summary_zh||'',b.summary_en||'',b.features_zh||'',b.features_en||'',b.stripe_url||'',Number(b.sort_order||0),b.is_active!==false,req.params.id]);
  res.json({ok:true});
});

app.get('/api/admin/members',auth,async(_req,res)=>res.json((await pool.query(`select m.*,p.name_zh plan_name,p.price plan_price from members m join membership_plans p on p.tier=m.tier order by m.created_at desc`)).rows));
app.patch('/api/admin/members/:id',auth,async(req,res)=>{
  const b=req.body;
  const old=(await pool.query('select * from members where id=$1',[req.params.id])).rows[0];
  if(!old)return res.status(404).json({error:'Member not found'});
  const plan=(await pool.query('select duration_days from membership_plans where tier=$1',[old.tier])).rows[0];
  const status=b.status||old.status;
  const activating=status==='active'&&old.status!=='active';
  await pool.query(`update members set status=$1,payment_reference=$2,
    starts_at=case when $3 then now() else starts_at end,
    expires_at=case when $3 then now()+($4||' days')::interval else expires_at end,
    payment_received_at=case when $3 then now() else payment_received_at end,updated_at=now()
    where id=$5`,[status,b.payment_reference??old.payment_reference,activating,String(plan.duration_days),req.params.id]);
  res.json({ok:true});
});
app.get('/api/admin/members/:id/photo',auth,async(req,res)=>{
  const r=await pool.query('select photo,photo_mime from members where id=$1',[req.params.id]);
  if(!r.rows[0]?.photo)return res.status(404).end();
  res.type(r.rows[0].photo_mime||'image/jpeg').send(r.rows[0].photo);
});

app.get('/api/admin/events',auth,async(_req,res)=>res.json((await pool.query(`select id,title_zh,title_en,description_zh,description_en,start_at,deadline_at,city,region,country,timezone,latitude,longitude,cover_key,public_venue,private_venue,capacity,confirmed_count,price,currency,required_tier,is_public,(image is not null) has_image from events order by start_at`)).rows));
app.post('/api/admin/events',auth,upload.single('image'),async(req,res)=>{
  const b=req.body,img=req.file?await image(req.file.buffer):null;
  const r=await pool.query(`insert into events(title_zh,title_en,description_zh,description_en,start_at,deadline_at,city,region,country,timezone,latitude,longitude,cover_key,public_venue,private_venue,capacity,price,currency,required_tier,is_public,image,image_mime)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) returning id`,
    [b.title_zh,b.title_en,b.description_zh||'',b.description_en||'',b.start_at,b.deadline_at||null,b.city,b.region||'',b.country||'',b.timezone||'UTC',b.latitude?Number(b.latitude):null,b.longitude?Number(b.longitude):null,b.cover_key||'',b.public_venue||'',b.private_venue||'',Number(b.capacity||0),Number(b.price||0),b.currency||'USD',b.required_tier||'community',b.is_public==='true',img,img?'image/jpeg':null]);
  res.json(r.rows[0]);
});
app.patch('/api/admin/events/:id',auth,upload.single('image'),async(req,res)=>{
  const b=req.body,sets=[],vals=[];let i=1;
  for(const k of ['title_zh','title_en','description_zh','description_en','start_at','deadline_at','city','region','country','timezone','latitude','longitude','cover_key','public_venue','private_venue','capacity','price','currency','required_tier','is_public']){
    if(b[k]!==undefined){sets.push(`${k}=$${i++}`);vals.push(['capacity','price','latitude','longitude'].includes(k)?Number(b[k]):k==='is_public'?b[k]==='true':b[k]||null)}
  }
  if(req.file){sets.push(`image=$${i++}`,`image_mime=$${i++}`);vals.push(await image(req.file.buffer),'image/jpeg')}
  vals.push(req.params.id);await pool.query(`update events set ${sets.join(',')},updated_at=now() where id=$${i}`,vals);res.json({ok:true});
});
app.delete('/api/admin/events/:id',auth,async(req,res)=>{await pool.query('delete from events where id=$1',[req.params.id]);res.json({ok:true})});

app.get('/api/admin/bookings',auth,async(_req,res)=>res.json((await pool.query(`select b.*,m.member_number,m.display_name,m.contact,m.tier,e.title_zh,e.title_en,e.private_venue from event_bookings b join members m on m.id=b.member_id join events e on e.id=b.event_id order by b.created_at desc`)).rows));
app.patch('/api/admin/bookings/:id',auth,async(req,res)=>{
  const client=await pool.connect();
  try{
    await client.query('begin');
    const old=(await client.query('select * from event_bookings where id=$1 for update',[req.params.id])).rows[0];
    if(!old)return res.status(404).json({error:'Booking not found'});
    const status=req.body.status||old.status;
    const counted=['payment_received','confirmed','venue_unlocked','checked_in','completed'];
    await client.query(`update event_bookings set status=$1,payment_reference=$2,
      payment_received_at=case when $1=any($3::text[]) then coalesce(payment_received_at,now()) else payment_received_at end,
      venue_unlocked_at=case when $1=any($4::text[]) then coalesce(venue_unlocked_at,now()) else venue_unlocked_at end,updated_at=now() where id=$5`,
      [status,req.body.payment_reference??old.payment_reference,counted,['venue_unlocked','checked_in','completed'],req.params.id]);
    if(counted.includes(old.status)!==counted.includes(status))await client.query('update events set confirmed_count=greatest(0,confirmed_count+$1) where id=$2',[counted.includes(status)?1:-1,old.event_id]);
    if(req.body.private_venue!==undefined)await client.query('update events set private_venue=$1 where id=$2',[req.body.private_venue,old.event_id]);
    await client.query('commit');res.json({ok:true});
  }catch(e){await client.query('rollback');console.error(e);res.status(500).json({error:'Unable to update booking'})}finally{client.release()}
});

app.get('/api/admin/posts',auth,async(_req,res)=>res.json((await pool.query('select * from posts order by created_at desc')).rows));
app.post('/api/admin/posts',auth,async(req,res)=>{
  const b=req.body;const r=await pool.query(`insert into posts(post_type,theme,title_zh,title_en,content_zh,content_en,cta_label_zh,cta_label_en,cta_url,expires_at,is_public)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
    [b.post_type||'club',b.theme||'club',b.title_zh||'',b.title_en||'',b.content_zh,b.content_en||'',b.cta_label_zh||'',b.cta_label_en||'',b.cta_url||'',b.expires_at||null,b.is_public!==false]);
  res.json(r.rows[0]);
});
app.delete('/api/admin/posts/:id',auth,async(req,res)=>{await pool.query('delete from posts where id=$1',[req.params.id]);res.json({ok:true})});

app.get('/api/admin/settings',auth,async(_req,res)=>res.json((await pool.query(`select brand_name,page_title,city,contact_email,business_address,site_url,stripe_url,zelle_name,zelle_contact,qr_label,(qr_image is not null) has_qr from settings where id=1`)).rows[0]));
app.patch('/api/admin/settings',auth,upload.single('qr_image'),async(req,res)=>{
  const b=req.body,qr=req.file?req.file.buffer:null;
  await pool.query(`update settings set brand_name=$1,page_title=$2,city=$3,contact_email=$4,business_address=$5,site_url=$6,stripe_url=$7,zelle_name=$8,zelle_contact=$9,qr_label=$10,
    qr_image=coalesce($11,qr_image),qr_mime=case when $11 is not null then $12 else qr_mime end,updated_at=now() where id=1`,
    [b.brand_name,b.page_title,b.city,b.contact_email,b.business_address,b.site_url,b.stripe_url,b.zelle_name,b.zelle_contact,b.qr_label,qr,qr?req.file.mimetype:null]);
  res.json({ok:true});
});

app.get('/api/admin/login',(_req,res)=>res.status(405).json({error:'Use POST /api/admin/login'}));
app.use('/api',(req,res)=>res.status(404).json({error:`API route not found: ${req.method} ${req.originalUrl}`}));
app.use(express.static(path.join(rootDir,'public')));
app.get('*',(_req,res)=>res.sendFile(path.join(rootDir,'public/index.html')));
app.use((err,req,res,_next)=>{console.error(err);res.status(500).json({error:'Server error'})});
app.listen(PORT,()=>console.log(`Singles Club membership backend running on ${PORT}`));
