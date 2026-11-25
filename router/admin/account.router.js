const Admin=require('../../models/admin.model');
const router=require('express').Router();
const auth=require('../../services/auth');
router.get('/login',(req,res)=>res.render('pages/admin/login',{title:'Trang đăng nhập'}));
router.get('/reset-password',(req,res)=>res.status(410).send('Chức năng khôi phục mật khẩu chưa được hỗ trợ. Vui lòng liên hệ quản trị viên.'));
auth.routes(router,Admin,'admin');
module.exports=router;
