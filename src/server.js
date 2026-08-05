
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

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false });
const PORT = process.env.PORT || 3000;
const SECRET = process.env.SESSION_SECRET || 'change-this';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 3 } });

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: (origin, callback) => {
    const allowed = (process.env.FRONTEND_ORIGIN || '').split(',').map(x => x.trim()).filter(Boolean);
    if (!origin || allowed.length === 0 || allowed.includes(origin)) return callback(null, true);
    callback(new Error('Origin not allowed'));
  },
  credentials: true
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

async function migrate() {
  const sql = await fs.readFile(path.join(rootDir, 'db/schema.sql'), 'utf8');
  await pool.query(sql);
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (email && password) {
    const hash = await bcrypt.hash(password, 12);
    await pool.query(`insert into admins(email,password_hash) values($1,$2)
      on conflict(email) do update set password_hash=excluded.password_hash`, [email.toLowerCase(), hash]);
  }
}
await migrate();

function auth(req,res,next) {
  const token = req.cookies.admin_token || req.headers.authorization?.replace('Bearer ','');
  if (!token) return res.status(401).json({ error:'Unauthorized' });
  try { req.admin = jwt.verify(token, SECRET); next(); }
  catch { res.status(401).json({ error:'Unauthorized' }); }
}

function code() {
  return 'SC-' + new Date().toISOString().slice(2,10).replaceAll('-','') + '-' + Math.random().toString(36).slice(2,7).toUpperCase();
}
async function normalizeImage(buffer) {
  return sharp(buffer).rotate().resize({ width: 1400, height: 1400, fit:'inside', withoutEnlargement:true }).jpeg({ quality:82 }).toBuffer();
}
function statusRank(s) {
  const order=['submitted','under_review','approved','awaiting_payment','payment_pending','payment_received','confirmed','venue_unlocked','checked_in','completed'];
  return order.indexOf(s);
}

app.get('/api/health', (_req,res)=>res.json({ok:true,service:'singles-club-backend',version:'1.0.0',build:'login-route-fix'}));

app.get('/api/public', async (_req,res)=>{
  const [settings,events,posts,plans] = await Promise.all([
    pool.query('select id,brand_name,page_title,city,contact_email,business_address,site_url,stripe_url,zelle_name,zelle_contact,qr_label,updated_at from settings where id=1'),
    pool.query(`select id,title_zh,title_en,description_zh,description_en,start_at,deadline_at,city,region,country,public_venue,capacity,confirmed_count,price,currency,is_public,
      (image is not null) has_image from events where is_public=true and start_at>now()-interval '1 day' order by start_at asc`),
    pool.query(`select * from posts where is_public=true and (expires_at is null or expires_at>now()) order by created_at desc limit 12`),
    pool.query(`select * from plans where is_active=true order by sort_order asc`)
  ]);
  res.json({settings:settings.rows[0],events:events.rows,posts:posts.rows,plans:plans.rows});
});

app.get('/api/events/:id/image', async (req,res)=>{
  const r=await pool.query('select image,image_mime from events where id=$1 and is_public=true',[req.params.id]);
  if(!r.rows[0]?.image) return res.status(404).end();
  res.type(r.rows[0].image_mime||'image/jpeg').send(r.rows[0].image);
});
app.get('/api/payment-qr', async (_req,res)=>{
  const r=await pool.query('select qr_image,qr_mime from settings where id=1');
  if(!r.rows[0]?.qr_image) return res.status(404).end();
  res.type(r.rows[0].qr_mime||'image/png').send(r.rows[0].qr_image);
});

app.post('/api/applications', upload.array('photos',3), async (req,res)=>{
  const client=await pool.connect();
  try {
    const {display_name,age,city,contact,relationship_goal,intro,offer_key}=req.body;
    if(!display_name||!age||!city||!contact||!offer_key) return res.status(400).json({error:'Missing required fields'});
    if(Number(age)<18) return res.status(400).json({error:'Adults only'});
    const [offer_type,idRaw]=String(offer_key).split(':');
    if(!['event','plan'].includes(offer_type)) return res.status(400).json({error:'Invalid offer'});
    await client.query('begin');
    const appCode=code();
    const inserted=await client.query(`insert into applications(application_code,display_name,age,city,contact,relationship_goal,intro,offer_type,event_id,plan_id)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id,application_code`,
      [appCode,display_name,Number(age),city,contact,relationship_goal||'',intro||'',offer_type,offer_type==='event'?Number(idRaw):null,offer_type==='plan'?Number(idRaw):null]);
    for(let i=0;i<(req.files||[]).length;i++){
      const img=await normalizeImage(req.files[i].buffer);
      await client.query('insert into application_photos(application_id,image,mime,sort_order) values($1,$2,$3,$4)',[inserted.rows[0].id,img,'image/jpeg',i]);
    }
    await client.query('commit');
    res.json(inserted.rows[0]);
  } catch(e){ await client.query('rollback'); console.error(e); res.status(500).json({error:'Unable to submit application'}); }
  finally{ client.release(); }
});

app.post('/api/status', async (req,res)=>{
  const {application_code,contact}=req.body;
  const r=await pool.query(`select a.application_code,a.status,a.offer_type,a.private_venue,a.created_at,
      e.title_en event_title,e.price event_price,p.name plan_name,p.price plan_price
      from applications a left join events e on e.id=a.event_id left join plans p on p.id=a.plan_id
      where lower(a.application_code)=lower($1) and lower(a.contact)=lower($2) limit 1`,[application_code||'',contact||'']);
  if(!r.rows[0]) return res.status(404).json({error:'Not found'});
  const row=r.rows[0];
  if(statusRank(row.status)<statusRank('venue_unlocked')) row.private_venue='';
  const settings=(await pool.query('select stripe_url,zelle_name,zelle_contact,qr_label,(qr_image is not null) has_qr from settings where id=1')).rows[0];
  const plan = row.offer_type==='plan' ? await pool.query('select stripe_url from plans where name=$1 limit 1',[row.plan_name]) : {rows:[]};
  res.json({...row,payment:{stripe_url:plan.rows[0]?.stripe_url||settings.stripe_url,zelle_name:settings.zelle_name,zelle_contact:settings.zelle_contact,qr_label:settings.qr_label,has_qr:settings.has_qr}});
});

app.post('/api/admin/login', async (req,res)=>{
  const email=String(req.body.email||'').toLowerCase(), password=String(req.body.password||'');
  const r=await pool.query('select * from admins where email=$1',[email]);
  if(!r.rows[0] || !(await bcrypt.compare(password,r.rows[0].password_hash))) return res.status(401).json({error:'Invalid login'});
  const token=jwt.sign({id:r.rows[0].id,email},SECRET,{expiresIn:'12h'});
  res.cookie('admin_token',token,{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:12*3600*1000});
  res.json({ok:true});
});
app.post('/api/admin/logout',(_req,res)=>{res.clearCookie('admin_token');res.json({ok:true});});
app.get('/api/admin/me',auth,(req,res)=>res.json(req.admin));

app.get('/api/admin/dashboard',auth,async(_req,res)=>{
  const [apps,events]=await Promise.all([
    pool.query(`select status,count(*)::int count from applications group by status`),
    pool.query(`select count(*)::int count from events where start_at>now()`)
  ]);
  res.json({applications:Object.fromEntries(apps.rows.map(x=>[x.status,x.count])),upcoming_events:events.rows[0].count});
});

app.get('/api/admin/events',auth,async(_req,res)=>res.json((await pool.query('select id,title_zh,title_en,start_at,deadline_at,city,region,country,public_venue,private_venue,capacity,confirmed_count,price,currency,is_public,(image is not null) has_image from events order by start_at asc')).rows));
app.post('/api/admin/events',auth,upload.single('image'),async(req,res)=>{
  const b=req.body, img=req.file?await normalizeImage(req.file.buffer):null;
  const r=await pool.query(`insert into events(title_zh,title_en,description_zh,description_en,start_at,deadline_at,city,region,country,public_venue,private_venue,capacity,price,currency,is_public,image,image_mime)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) returning id`,
    [b.title_zh||'',b.title_en,b.description_zh||'',b.description_en||'',b.start_at,b.deadline_at||null,b.city,b.region||'',b.country||'US',b.public_venue||'',b.private_venue||'',Number(b.capacity||0),Number(b.price||0),b.currency||'USD',b.is_public==='true',img,img?'image/jpeg':null]);
  res.json(r.rows[0]);
});
app.patch('/api/admin/events/:id',auth,upload.single('image'),async(req,res)=>{
  const b=req.body, fields=[], vals=[]; let n=1;
  for(const k of ['title_zh','title_en','description_zh','description_en','start_at','deadline_at','city','region','country','public_venue','private_venue','capacity','confirmed_count','price','currency','is_public']){
    if(b[k]!==undefined){fields.push(`${k}=$${n++}`);vals.push(['capacity','confirmed_count','price'].includes(k)?Number(b[k]):k==='is_public'?b[k]==='true':b[k]||null);}
  }
  if(req.file){fields.push(`image=$${n++}`,`image_mime=$${n++}`);vals.push(await normalizeImage(req.file.buffer),'image/jpeg');}
  fields.push('updated_at=now()');vals.push(req.params.id);
  await pool.query(`update events set ${fields.join(',')} where id=$${n}` ,vals);
  res.json({ok:true});
});
app.delete('/api/admin/events/:id',auth,async(req,res)=>{await pool.query('delete from events where id=$1',[req.params.id]);res.json({ok:true});});

app.get('/api/admin/posts',auth,async(_req,res)=>res.json((await pool.query('select * from posts order by created_at desc')).rows));
app.post('/api/admin/posts',auth,async(req,res)=>{
  const b=req.body;const r=await pool.query('insert into posts(post_type,content_zh,content_en,expires_at,is_public) values($1,$2,$3,$4,$5) returning id',[b.post_type||'platform',b.content_zh||'',b.content_en,b.expires_at||null,b.is_public!==false]);res.json(r.rows[0]);
});
app.delete('/api/admin/posts/:id',auth,async(req,res)=>{await pool.query('delete from posts where id=$1',[req.params.id]);res.json({ok:true});});

app.get('/api/admin/plans',auth,async(_req,res)=>res.json((await pool.query('select * from plans order by sort_order')).rows));
app.post('/api/admin/plans',auth,async(req,res)=>{
  const b=req.body;const r=await pool.query(`insert into plans(name,price,summary_zh,summary_en,features_zh,features_en,stripe_url,sort_order,is_active)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,[b.name,Number(b.price),b.summary_zh||'',b.summary_en||'',b.features_zh||'',b.features_en||'',b.stripe_url||'',Number(b.sort_order||0),b.is_active!==false]);res.json(r.rows[0]);
});
app.patch('/api/admin/plans/:id',auth,async(req,res)=>{
  const b=req.body;await pool.query(`update plans set name=$1,price=$2,summary_zh=$3,summary_en=$4,features_zh=$5,features_en=$6,stripe_url=$7,sort_order=$8,is_active=$9 where id=$10`,
    [b.name,Number(b.price),b.summary_zh||'',b.summary_en||'',b.features_zh||'',b.features_en||'',b.stripe_url||'',Number(b.sort_order||0),b.is_active!==false,req.params.id]);res.json({ok:true});
});

app.get('/api/admin/applications',auth,async(_req,res)=>res.json((await pool.query(`select a.*,e.title_en event_title,p.name plan_name,(select count(*) from application_photos x where x.application_id=a.id)::int photo_count from applications a left join events e on e.id=a.event_id left join plans p on p.id=a.plan_id order by a.created_at desc`)).rows));
app.get('/api/admin/applications/:id/photos/:photoId',auth,async(req,res)=>{
  const r=await pool.query('select image,mime from application_photos where id=$1 and application_id=$2',[req.params.photoId,req.params.id]);if(!r.rows[0])return res.status(404).end();res.type(r.rows[0].mime).send(r.rows[0].image);
});
app.get('/api/admin/applications/:id/photos',auth,async(req,res)=>res.json((await pool.query('select id,sort_order,approved from application_photos where application_id=$1 order by sort_order',[req.params.id])).rows));
app.patch('/api/admin/applications/:id',auth,async(req,res)=>{
  const b=req.body;await pool.query('update applications set status=$1,private_venue=$2,payment_reference=$3,updated_at=now() where id=$4',[b.status,b.private_venue||'',b.payment_reference||'',req.params.id]);res.json({ok:true});
});

app.get('/api/admin/settings',auth,async(_req,res)=>res.json((await pool.query('select id,brand_name,page_title,city,contact_email,business_address,site_url,stripe_url,zelle_name,zelle_contact,qr_label,(qr_image is not null) has_qr from settings where id=1')).rows[0]));
app.patch('/api/admin/settings',auth,upload.single('qr_image'),async(req,res)=>{
  const b=req.body, img=req.file?.buffer||null;
  await pool.query(`update settings set brand_name=$1,page_title=$2,city=$3,contact_email=$4,business_address=$5,site_url=$6,stripe_url=$7,zelle_name=$8,zelle_contact=$9,qr_label=$10,
    qr_image=coalesce($11,qr_image),qr_mime=case when $11 is not null then $12 else qr_mime end,updated_at=now() where id=1`,
    [b.brand_name,b.page_title,b.city,b.contact_email,b.business_address||'',b.site_url||'',b.stripe_url||'',b.zelle_name||'',b.zelle_contact||'',b.qr_label||'',img,img?req.file.mimetype:null]);
  res.json({ok:true});
});


// API diagnostics and JSON-only fallthrough.
// These routes must appear before the static frontend fallback.
app.get('/api/admin/login', (_req,res) => {
  res.status(405).json({ error:'Use POST /api/admin/login' });
});

app.use('/api', (req,res) => {
  res.status(404).json({ error:`API route not found: ${req.method} ${req.originalUrl}` });
});

app.use((err,req,res,next) => {
  console.error(err);
  if (req.originalUrl.startsWith('/api/')) {
    return res.status(500).json({ error:'Server error' });
  }
  next(err);
});

app.use(express.static(path.join(rootDir,'public')));
app.get('*',(_req,res)=>res.sendFile(path.join(rootDir,'public/index.html')));
app.listen(PORT,()=>console.log(`Singles Club running on ${PORT}`));
