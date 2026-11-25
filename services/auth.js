const crypto = require('node:crypto');
const { promisify } = require('node:util');
const mongoose = require('mongoose');
const scrypt = promisify(crypto.scrypt);
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const token = () => crypto.randomBytes(32).toString('hex');
const cookieName = role => `ecohub_${role}`;
const cookieOptions = () => ({ httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/' });
const Session = mongoose.model('AuthSession', new mongoose.Schema({
  digest: {type:String, unique:true, required:true}, role:String, accountId:mongoose.Schema.Types.ObjectId,
  credential:String, expiresAt:{type:Date,index:{expires:0}}
}));
const limit = new Map();
function throttle(key, max=10, ms=600000) {
  const now=Date.now();
  if(limit.size>10000) for(const [k,v] of limit) if(v.until<=now) limit.delete(k);
  const v=limit.get(key); if(!v||v.until<=now){if(limit.size>=10000)return false;limit.set(key,{count:1,until:now+ms});return true;}
  return ++v.count<=max;
}
function validPassword(value){return typeof value==='string'&&value.length>=8&&value.length<=128;}
async function hashPassword(value){const salt=crypto.randomBytes(16).toString('hex');const key=await scrypt(value,salt,64);return `scrypt$${salt}$${key.toString('hex')}`;}
async function verifyPassword(value, stored){
  if(typeof value!=='string'||value.length>128||typeof stored!=='string')return false;
  if(!stored.startsWith('scrypt$'))return crypto.timingSafeEqual(Buffer.from(sha(value)),Buffer.from(sha(stored)));
  const [,salt,key]=stored.split('$'); if(!/^[a-f0-9]{32}$/.test(salt||'')||!/^[a-f0-9]{128}$/.test(key||''))return false;
  return crypto.timingSafeEqual(await scrypt(value,salt,64),Buffer.from(key,'hex'));
}
function reject(res,message,status=400){return res.status(status).json({code:'error',message});}
const ok=(res,message)=>res.json({code:'success',message});
function identity(value){return typeof value==='string'&&value.trim().length<=254?value.trim():'';}
function lookup(identifier){return {$or:[{email:identifier},{phone:identifier}]};}
function enabled(role,account){return account&&(role!=='admin'||account.isActive===true);}
async function login(req,res,Model,role){
  const id=identity(role==='admin'?req.body.phoneEmail:req.body.email), password=req.body.password;
  if(!id||typeof password!=='string'||password.length>128)return reject(res,'Thông tin đăng nhập không hợp lệ.');
  if(!throttle(`login:${role}:${req.ip}`)||!throttle(`login:${role}:${sha(id)}`))return reject(res,'Thử lại sau.',429);
  let account=await Model.findOne(role==='admin'?lookup(id):{email:id});
  if(!enabled(role,account)||!await verifyPassword(password,account.password))return reject(res,'Thông tin đăng nhập không chính xác.',401);
  // Legacy accounts are migrated only after verifying the old credential; conditional write prevents overwriting a concurrent password change.
  if(!account.password.startsWith('scrypt$')){
    const old=account.password, hashed=await hashPassword(password);
    const migrated=await Model.findOneAndUpdate({_id:account._id,password:old},{$set:{password:hashed}},{returnDocument:'after'});
    if(!migrated)return reject(res,'Mật khẩu vừa thay đổi, vui lòng đăng nhập lại.',409);
    account=migrated;
  }
  const oldToken=req.cookies?.[cookieName(role)]; if(typeof oldToken==='string')await Session.deleteOne({digest:sha(oldToken),role});
  const raw=token(),expiresAt=new Date(Date.now()+86400000);
  await Session.create({digest:sha(raw),role,accountId:account._id,credential:sha(account.password),expiresAt});
  res.cookie(cookieName(role),raw,{...cookieOptions(),maxAge:86400000});
  return ok(res,'Đăng nhập thành công');
}
function middleware(Model,role){return async(req,res,next)=>{
  const raw=req.cookies?.[cookieName(role)];
  const deny=()=>{res.clearCookie(cookieName(role),cookieOptions());return req.method==='GET'?res.redirect(role==='admin'?'/admin/account/login':'/login'):reject(res,'Vui lòng đăng nhập.',401);};
  if(typeof raw!=='string'||!/^[a-f0-9]{64}$/.test(raw))return deny();
  const session=await Session.findOne({digest:sha(raw),role,expiresAt:{$gt:new Date()}}).lean();
  if(!session)return deny();
  const account=await Model.findById(session.accountId).lean();
  if(!enabled(role,account)||sha(account.password||'')!==session.credential)return deny();
  const {_id,fullname,fullName,email,phone,role:accountRole}=account;
  if(role==='admin'){req.admin=res.locals.admin={id:String(_id),fullname:fullName||fullname,email,role:accountRole};}
  else {req.account=res.locals.account={_id,fullname,email,phone};}
  next();
};}
async function logout(req,res,role){const raw=req.cookies?.[cookieName(role)];if(typeof raw==='string')await Session.deleteOne({digest:sha(raw),role});res.clearCookie(cookieName(role),cookieOptions());return ok(res,'Đăng xuất thành công');}
function routes(router,Model,role){router.post('/login',(req,res)=>login(req,res,Model,role));router.post('/logout',(req,res)=>logout(req,res,role));router.post('/send-otp',(req,res)=>reject(res,'Chức năng khôi phục mật khẩu chưa được hỗ trợ.',410));router.post('/change-password',(req,res)=>reject(res,'Chức năng khôi phục mật khẩu chưa được hỗ trợ.',410));}
module.exports={hashPassword,verifyPassword,validPassword,identity,middleware,routes};
