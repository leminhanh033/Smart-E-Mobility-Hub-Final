const router=require("express").Router();
const Hub = require('../../models/hub.model');
const Vehicle = require('../../models/vehicle.model');
const Port = require('../../models/chargingPort.model');

async function getHubData() {
  const hubs = await Hub.find({status: 'active', turnOn: true}).lean();
  const ids = hubs.map(h => String(h._id));
  const vehicles = await Vehicle.find({hubID: {$in: ids}, status: 'active'}).lean();
  const ports = await Port.find({hubID: {$in: ids}}).lean();
  return Object.fromEntries(hubs.map(h => {
    const ps = ports.filter(p => p.hubID === String(h._id));
    return [String(h._id), {
      name: h.name,
      rentFleet: vehicles.filter(v => v.hubID === String(h._id)).length,
      parkingSlots: h.parkingNumber,
      parkingUsed: h.parkingUsed,
      availableSlots: Math.max(0, h.parkingNumber - h.parkingUsed),
      totalPorts: ps.length,
      workingPorts: ps.filter(p => p.status === 'active' || p.status === 'charging').length,
      activeCharging: ps.filter(p => p.status === 'charging').length,
      freePorts: ps.filter(p => p.status === 'active').length
    }];
  }));
}

router.get('/data', async (req, res) => {
  try {
    res.json({code: 'success', data: await getHubData()});
  } catch (error) {
    res.status(500).json({code: 'error', message: 'Không thể lấy dữ liệu Hub.'});
  }
});


router.get("/demand/surging",(req,res)=>{
  res.render("pages/admin/simulation-demand-surging",{
    title:"Trang mô phỏng",
    activePage:"simulation",
  })
})

router.get("/full/parking",(req,res)=>{
  res.render("pages/admin/simulation-full-parking",{
    title:"Trang mô phỏng",
    activePage:"simulation",
  })
})

router.get("/charging/surge",(req,res)=>{
  res.render("pages/admin/simulation-charging-surge",{
    title:"Trang mô phỏng",
    activePage:"simulation",
  })
})

router.get("/charging/point/failure",(req,res)=>{
  res.render("pages/admin/simulation-charging-failure",{
    title:"Trang mô phỏng",
    activePage:"simulation",
  })
})

router.get("/vehicle/concentration",(req,res)=>{
  res.render("pages/admin/simulation-concentration",{
    title:"Trang mô phỏng",
    activePage:"simulation",
  })
})

router.post('/charging/point/failure', async (req, res) => {
  try {
  const { hubId, brokenPorts, currentDemand } = req.body;

  const hubsDB = await getHubData();
  const currentHub = hubsDB[hubId];
  if (!currentHub) return res.status(400).json({code: 'error', message: 'Hub không khả dụng.'});
  const totalPorts = currentHub.workingPorts;

  const broken = parseInt(brokenPorts) || 0;
  const demand = parseInt(currentDemand) || 0;

  // 2. Tính toán
  const remainingPorts = Math.max(0, totalPorts - broken);
  const unservedVehicles = Math.max(0, demand - remainingPorts);

  // 3. Xử lý giải pháp
  let recTitle = "Hệ thống ổn định";
  let recContent = `Các cổng sạc còn lại (${remainingPorts} cổng) đáp ứng đủ nhu cầu (${demand} xe). Không cần điều phối.`;
  let ticket = null;
  let status = "success";
  let actionPlan = [];

  if (unservedVehicles > 0) {
    status = "warning";
    recTitle = "Tái phân bổ Lịch sạc & Tối ưu hóa hàng đợi";
    recContent = `Phát hiện ${unservedVehicles} xe vượt quá công suất. Đề xuất phân bổ lại luồng xe.`;
    ticket = `#MT-2026-${Math.floor(100 + Math.random() * 900)}`;

    let remainingToHandle = unservedVehicles;
    
    // Giải pháp 1: Cho phép xếp hàng chờ (Tối đa 3 xe)
    const maxQueueCapacity = 3;
    const waitingCount = Math.min(remainingToHandle, maxQueueCapacity);
    
    if (waitingCount > 0) {
      actionPlan.push({
        type: 'wait',
        amount: waitingCount,
        note: `Xếp hàng chờ sạc (Ước tính: ~${waitingCount * 20} phút)`
      });
      remainingToHandle -= waitingCount;
    }

    // Giải pháp 2: Điều chuyển sang trạm khác (LỌC BỎ TRẠM HIỆN TẠI)
    if (remainingToHandle > 0) {
      // Lấy danh sách các Hub khác, BỎ QUA hubId hiện tại
      const targetHubs = Object.keys(hubsDB)
        .filter(id => id !== hubId) // <-- Dòng quan trọng nhất để sửa lỗi
        .map(id => ({
          id: id,
          availableSlots: hubsDB[id].freePorts
        }));

      for (let hub of targetHubs) {
        if (remainingToHandle <= 0) break;
        if (hub.availableSlots <= 0) continue; // Bỏ qua nếu Hub đó đã đầy

        const moveCount = Math.min(remainingToHandle, hub.availableSlots);
        
        actionPlan.push({
          type: 'dispatch',
          targetHub: hubsDB[hub.id].name,
          amount: moveCount
        });
        
        remainingToHandle -= moveCount;
        
 
      }
    }
    
    if (remainingToHandle > 0) {
        actionPlan.push({
            type: 'unserved',
            amount: remainingToHandle
        });
    }
  }

  // 4. Trả kết quả
  res.json({
    code: "success",
    data: {
      current: {
        totalPorts: `${totalPorts} cổng`,
        demand: `${demand} xe cần sạc`
      },
      simulated: {
        brokenPorts: `-${broken} cổng (Ngoại tuyến)`,
        remainingPorts: `${remainingPorts} / ${totalPorts} cổng`,
        warning: broken > 0 ? "Sụt giảm công suất sạc" : "Bình thường"
      },
      evaluation: {
        activePorts: `${remainingPorts} / ${totalPorts} cổng`,
        lostCapacity: broken > 0 ? `${broken} cổng mất khả năng phục vụ` : "Không mất cổng nào",
        demand: `${demand} xe`,
        unserved: `${unservedVehicles} xe`,
        unservedSub: unservedVehicles > 0 ? "Cần xử lý (Chờ/Điều chuyển)" : "Đáp ứng đủ"
      },
      recommendation: {
        title: recTitle,
        content: recContent,
        ticket: ticket,
        status: status,
        actionPlan: actionPlan
      }
    }
  });
  } catch (error) {
    res.status(500).json({code: "error", message: "Không thể lấy dữ liệu Hub."});
  }
});


router.post("/charging/demand/surge", async (req, res) => {
  try {
  const { hubId, simulatedDemand, scenario, timeFrame } = req.body;
  const MOBILITY_HUB_NETWORK_DATA = await getHubData();
  const hub = MOBILITY_HUB_NETWORK_DATA[hubId];
  if (!hub) return res.status(400).json({code: 'error', message: 'Hub không khả dụng.'});
  const userTotalPorts = hub.workingPorts;
  const currentCharge = hub.activeCharging;
  const waitingDemand = parseInt(simulatedDemand) || 0;

  // TÍNH TOÁN CỐT LÕI THEO ĐÚNG YÊU CẦU:
  const availablePorts = Math.max(0, userTotalPorts - currentCharge);
  const overloadVehicles = Math.max(0, waitingDemand - availablePorts);

  let scenarioName = "";
  let maxQueueCapacity = 3; 
  let recTitle = "Hệ thống ổn định";
  let recContent = `Có ${availablePorts} cổng trống, đáp ứng đủ cho ${waitingDemand} xe đang chờ. Không cần điều phối.`;
  let status = "success";
  let actionPlan = [];

  if (scenario === "peak-hours") {
    scenarioName = "Cao điểm";
    maxQueueCapacity = 2;
  } else if (scenario === "event-surge") {
    scenarioName = "Sự kiện Đột xuất";
    maxQueueCapacity = 1;
  } else if (scenario === "night-charging") {
    scenarioName = "Sạc Qua đêm";
    maxQueueCapacity = 10;
  }

  if (overloadVehicles > 0) {
    status = "warning";
    recTitle = "Điều phối Khẩn cấp (" + scenarioName + ")";
    recContent = `Chỉ còn ${availablePorts} cổng trống, không thể đáp ứng ${overloadVehicles} xe đang chờ trong khung giờ ${timeFrame}.`;

    let remainingToHandle = overloadVehicles;

    const waitingCount = Math.min(remainingToHandle, maxQueueCapacity);
    if (waitingCount > 0) {
      actionPlan.push({
        type: 'wait',
        amount: waitingCount,
        note: `Xếp lịch sạc nội tiếp (Chờ ~${waitingCount * 25} phút)`
      });
      remainingToHandle -= waitingCount;
    }

    if (remainingToHandle > 0) {
      const targetHubs = Object.keys(MOBILITY_HUB_NETWORK_DATA)
        .filter(id => id !== hubId && MOBILITY_HUB_NETWORK_DATA[id].freePorts > 0)
        .map(id => ({
          id: id,
          availableSlots: MOBILITY_HUB_NETWORK_DATA[id].freePorts
        }));

      for (let hub of targetHubs) {
        if (remainingToHandle <= 0) break;
        const moveCount = Math.min(remainingToHandle, hub.availableSlots);
        
        actionPlan.push({
          type: 'dispatch',
          targetHub: MOBILITY_HUB_NETWORK_DATA[hub.id].name,
          amount: moveCount
        });
        remainingToHandle -= moveCount;
      }
    }
    if (remainingToHandle > 0) actionPlan.push({type: "unserved", amount: remainingToHandle});
  }

  res.json({
    code: "success",
    data: {
      current: {
        totalPorts: `${userTotalPorts} cổng`,
        currentDemand: `${currentCharge} xe`,
        timeFrame: timeFrame
      },
      simulated: {
        newDemand: `${waitingDemand} xe`,
        overload: `${overloadVehicles} xe`,
        scenarioName: scenarioName
      },
      evaluation: {
        totalPorts: `${userTotalPorts} cổng`,
        newDemand: `${waitingDemand} xe`,
        unserved: `${overloadVehicles} xe`,
        unservedSub: overloadVehicles > 0 ? "Cần xếp lịch / Điều hướng" : "Đáp ứng đủ"
      },
      recommendation: {
        title: recTitle,
        content: recContent,
        status: status,
        actionPlan: actionPlan
      }
    }
  });
  } catch (error) {
    res.status(500).json({code: "error", message: "Không thể lấy dữ liệu Hub."});
  }
});

module.exports=router;