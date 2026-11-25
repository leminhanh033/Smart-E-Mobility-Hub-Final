require('dotenv').config();
const mongoose=require('mongoose');
const auth=require('../services/auth');
async function run(){
  await mongoose.connect(process.env.SERVER);
  for(const Model of [require('../models/user.model'),require('../models/admin.model')]){
    let count=0;for await(const account of Model.find({password:{$type:'string',$not:/^scrypt\$/}}).select('password').cursor()){
      const hash=await auth.hashPassword(account.password);const r=await Model.updateOne({_id:account._id,password:account.password},{$set:{password:hash}});count+=r.modifiedCount;
    }console.log(Model.modelName+': '+count+' mật khẩu đã chuyển đổi');
  }
}
run().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>mongoose.disconnect());
