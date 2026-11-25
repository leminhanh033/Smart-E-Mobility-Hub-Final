const mongoose =require('mongoose');
const { Schema } = mongoose;

const vehicleOwner = new Schema({
  userID:String,
  model:String,
  batteryCapacity:Number,
  pin:{type:Number,min:0,max:100},
  nextUseAt:Date,
  bookingVersion:{type:Number,default:0},  
  status:String,
  license:String,
},{
  timestamps:true,
});

const vehicleOwnermodel = mongoose.model('vehicleOwner', vehicleOwner,"vehicleOwner");
module.exports=vehicleOwnermodel;