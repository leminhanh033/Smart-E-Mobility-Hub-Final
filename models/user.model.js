const mongoose =require('mongoose');
const { Schema } = mongoose;

const user = new Schema({
  fullname:String,
  phone:{type:String,unique:true,sparse:true},
  email:{type:String,unique:true,sparse:true},
  password:String
},{
  timestamps:true,
});

const usermodel = mongoose.model('user', user,"user");
module.exports=usermodel;