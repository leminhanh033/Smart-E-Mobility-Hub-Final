const router=require('express').Router();
const User=require('../../models/user.model');
const auth=require('../../services/auth');
router.get('/login',(req,res)=>res.render('pages/user/login',{title:'Trang đăng nhập'}));
router.get('/register',(req,res)=>res.render('pages/user/register',{title:'Trang đăng ký'}));
router.get('/reset-password',(req,res)=>res.status(410).send('Chức năng khôi phục mật khẩu chưa được hỗ trợ. Vui lòng liên hệ quản trị viên.'));
router.post('/register',async(req,res)=>{
  const {fullname,phone,email,password}=req.body;
  if(typeof fullname!=='string'||!fullname.trim()||fullname.length>120||typeof email!=='string'||email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||typeof phone!=='string'||!/^\+?\d{9,15}$/.test(phone)||!auth.validPassword(password))return res.status(400).json({code:'error',message:'Thông tin đăng ký không hợp lệ.'});
  if(await User.exists({$or:[{email},{phone}]}))return res.status(409).json({code:'error',message:'Email hoặc số điện thoại đã tồn tại.'});
  try{await User.create({fullname:fullname.trim(),phone,email,password:await auth.hashPassword(password)});}catch(e){if(e.code===11000)return res.status(409).json({code:'error',message:'Email hoặc số điện thoại đã tồn tại.'});throw e;}
  return res.json({code:'success',message:'Đăng ký thành công'});
});
auth.routes(router,User,'user');
module.exports=router;
