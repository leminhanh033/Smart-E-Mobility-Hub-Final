const mongoose=require('mongoose');
module.exports=mongoose.model('Dispatch',new mongoose.Schema({
  fromHub:{type:mongoose.Schema.Types.ObjectId,ref:'hub',required:true},toHub:{type:mongoose.Schema.Types.ObjectId,ref:'hub',required:true},
  vehicles:[{type:mongoose.Schema.Types.ObjectId,ref:'vehicle'}],
  priority:{type:String,enum:['normal','urgent'],default:'normal'},status:{type:String,enum:['moving','done'],default:'done'}
},{timestamps:true}),'dispatch');
