const mongoose=require('mongoose');
class BusinessError extends Error{}
const fail=message=>{throw new BusinessError(message);};
const validId=id=>typeof id==='string'&&/^[a-f0-9]{24}$/i.test(id);
async function transaction(fn){const session=await mongoose.startSession();let result;try{await session.withTransaction(async()=>{result=await fn(session);});return result;}finally{await session.endSession();}}
const integer=(value,min=0,max=1000000)=>{if(value===null||value===undefined||value===''||!['string','number'].includes(typeof value)||!Number.isSafeInteger(Number(value))||Number(value)<min||Number(value)>max)fail('Tham số số lượng không hợp lệ.');return Number(value);};
function handle(res,e){if(e instanceof BusinessError)return res.status(400).json({code:'error',message:e.message});console.error(e.message);return res.status(500).json({code:'error',message:'Lỗi hệ thống.'});}
module.exports={transaction,fail,validId,integer,handle};
