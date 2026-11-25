// Dữ liệu Hub thật, dùng cho các form Simulation gốc.
async function loadSimulationHubs(select) {
  select.replaceChildren();
  try {
    const response = await fetch('/admin/simulation/data');
    const result = await response.json();
    if (result.code !== 'success') throw new Error(result.message);
    for (const [id, hub] of Object.entries(result.data)) {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = hub.name;
      select.appendChild(option);
    }
    return result.data;
  } catch (error) {
    alert(error.message || 'Không thể lấy dữ liệu Hub.');
    return {};
  }
}

// Các template HTML gốc nhận dữ liệu DB, cần escape text trước khi chèn.
function escapeHubText(value) {
  const node = document.createElement('span');
  node.textContent = String(value ?? '');
  return node.innerHTML;
}

function alternativeParking(hubs, hubId, amount) {
    const targets = Object.entries(hubs)
        .filter(([id, h]) => id !== hubId && h.availableSlots > 0)
        .sort((a, b) => b[1].availableSlots - a[1].availableSlots);

    const actions = [];

    for (const [id, hub] of targets) {
        if (amount <= 0) break;

        const count = Math.min(amount, hub.availableSlots);

        actions.push(`Điều hướng ${count} xe sang ${escapeHubText(hub.name)}.`);

        amount -= count;
    }

    if (amount > 0)
        actions.push(`Còn ${amount} xe chưa có chỗ tiếp nhận.`);

    return actions.join(' ');
}
document.addEventListener("DOMContentLoaded", async () => {
  const btnRun = document.getElementById("btnRunSimulation");
  if (!btnRun || !document.getElementById('simBrokenPorts')) return;
  const hubSelect = document.getElementById('simHubId');
  await loadSimulationHubs(hubSelect);
  if (!hubSelect.value) { btnRun.disabled = true; return; }

  btnRun.addEventListener("click", async () => {
    // 1. Lấy dữ liệu từ input
    const hubId = document.getElementById("simHubId").value;
    const brokenPorts = document.getElementById("simBrokenPorts").value;
    const currentDemand = document.getElementById("simCurrentDemand").value;

    // Hiệu ứng Loading
    const originalHtml = btnRun.innerHTML;
    btnRun.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Đang tính toán...`;
    btnRun.disabled = true;

    try {
      // 2. Gọi API xuống Backend
      const response = await fetch("/admin/simulation/charging/point/failure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hubId: hubId,
          brokenPorts: brokenPorts,
          currentDemand: currentDemand
        })
      });

      const result = await response.json();

      // 3. Đổ dữ liệu ra UI
      if (result.code === "success") {
        const data = result.data;

        // -- Cập nhật text cơ bản --
        document.getElementById("resCurrentPorts").textContent = data.current.totalPorts;
        document.getElementById("resCurrentDemand").textContent = data.current.demand;

        document.getElementById("resSimBroken").textContent = data.simulated.brokenPorts;
        document.getElementById("resSimRemaining").textContent = data.simulated.remainingPorts;
        document.getElementById("resSimWarning").textContent = data.simulated.warning;

        document.getElementById("resEvalPorts").textContent = data.evaluation.activePorts;
        document.getElementById("resEvalLost").textContent = data.evaluation.lostCapacity;
        document.getElementById("resEvalDemand").textContent = data.evaluation.demand;
        document.getElementById("resEvalUnserved").textContent = data.evaluation.unserved;
        document.getElementById("resEvalUnservedSub").textContent = data.evaluation.unservedSub;

        document.getElementById("resRecTitle").textContent = data.recommendation.title;
        document.getElementById("resRecContent").innerHTML = data.recommendation.content;

        // -- Xử lý Phương án xử lý (Action Plan) --
        const actionBox = document.getElementById("actionPlanBox");
        const actionList = document.getElementById("actionList");

        if (data.recommendation.actionPlan && data.recommendation.actionPlan.length > 0) {
          actionList.innerHTML = ""; // Xóa list cũ trước khi render mới

          data.recommendation.actionPlan.forEach(plan => {
            const li = document.createElement("li");
            li.style.marginBottom = "8px";

            if (plan.type === 'wait') {
              // Xe xếp hàng chờ
              li.innerHTML = `
                <i class="fa-solid fa-clock" style="color: #ff9800; margin-right: 6px;"></i>
                <strong>${plan.amount} xe</strong> xếp hàng chờ sạc. <em style="color: #6b7280; font-size: 13px;">(${plan.note})</em>
              `;
            } else if (plan.type === 'dispatch') {
              // Xe điều chuyển sang trạm khác
              li.innerHTML = `
                <i class="fa-solid fa-route" style="color: #2196f3; margin-right: 6px;"></i>
                Điều chuyển <strong>${plan.amount} xe</strong> sang <strong>${escapeHubText(plan.targetHub)}</strong>
              `;
            }
            if (plan.type === "unserved") li.textContent = `${plan.amount} xe chưa có phương án tiếp nhận.`;
            actionList.appendChild(li);
          });

          actionBox.style.display = "block"; // Hiện khung
        } else {
          actionBox.style.display = "none"; // Ẩn nếu không có
        }

        // -- Xử lý Ticket --
        const ticketEl = document.getElementById("resRecTicket");
        if (data.recommendation.ticket) {
          ticketEl.innerHTML = `Maintenance Ticket: Tạo ticket xử lý kỹ thuật khẩn cấp <strong>${data.recommendation.ticket}</strong> cử Kỹ thuật viên kiểm tra.`;
          ticketEl.style.display = "block";
        } else {
          ticketEl.style.display = "none";
        }

        // -- Đổi màu Badge theo trạng thái --
        const badge = document.getElementById("resStatusBadge");
        const cardUnserved = document.getElementById("cardUnserved");

        if (data.recommendation.status === "warning") {
          badge.style.background = "#fff3e0";
          badge.style.color = "#ff9800";
          badge.textContent = "Cần xử lý";

          cardUnserved.style.background = "#ffebee";
          cardUnserved.style.borderColor = "#ffcdd2";
        } else {
          badge.style.background = "#e8f5e9";
          badge.style.color = "#00c853";
          badge.textContent = "Ổn định";

          cardUnserved.style.background = "#f5f5f5";
          cardUnserved.style.borderColor = "#e0e0e0";
        }

        // 4. Ẩn Empty State, Hiển thị kết quả
        document.getElementById("simulationEmptyState").style.display = "none";
        document.getElementById("simulationResultWrapper").style.display = "block";
        document.getElementById("simulationResultWrapper").scrollIntoView({ behavior: 'smooth', block: 'start' });

      } else {
        alert("Lỗi từ server: " + result.message);
      }

    } catch (error) {
      console.error("Lỗi Fetch:", error);
      alert("Không thể kết nối đến server. Vui lòng kiểm tra lại API!");
    } finally {
      // 5. Trả lại trạng thái nút bấm
      btnRun.innerHTML = originalHtml;
      btnRun.disabled = false;
    }
  });
});

// simulation Nhu cầu sạc tăng cao
document.addEventListener("DOMContentLoaded", async () => {
  const hubSelect = document.getElementById("simHubId");
  const totalPortsInput = document.getElementById("simTotalPorts");
  const currentChargingInput = document.getElementById("simCurrentCharging");
  const btnRun = document.getElementById("btnRunSimulation");

  if (!btnRun || !document.getElementById('simSimulatedDemand')) return;
  const MOBILITY_HUB_NETWORK_DATA = await loadSimulationHubs(hubSelect);
  if (!hubSelect.value) { btnRun.disabled = true; return; }
  const fillCharging = () => {
    const hub = MOBILITY_HUB_NETWORK_DATA[hubSelect.value];
    totalPortsInput.value = hub.workingPorts;
    currentChargingInput.value = hub.activeCharging;
    totalPortsInput.readOnly = currentChargingInput.readOnly = true;
  };
  hubSelect.addEventListener('change', fillCharging);
  fillCharging();

  btnRun.addEventListener("click", async () => {
    const hubId = hubSelect.value;
    const totalPorts = parseInt(totalPortsInput.value) || 0;
    const currentCharging = parseInt(currentChargingInput.value) || 0;
    const simulatedDemand = parseInt(document.getElementById("simSimulatedDemand").value) || 0;
    const scenario = document.getElementById("simScenario").value;
    const timeFrame = document.getElementById("simTimeFrame").value;

    // Kiểm tra an toàn lần cuối trước khi gửi API
    if (currentCharging > totalPorts) {
      alert(`Lỗi: Số xe đang sạc (${currentCharging}) không thể vượt quá số cổng khả dụng (${totalPorts})!`);
      return;
    }

    const originalHtml = btnRun.innerHTML;
    btnRun.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Đang tính toán...`;
    btnRun.disabled = true;

    try {
      const response = await fetch("/admin/simulation/charging/demand/surge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hubId, totalPorts, currentCharging, simulatedDemand, scenario, timeFrame })
      });

      const result = await response.json();

      if (result.code === "success") {
        const data = result.data;

        document.getElementById("resSimDemand").textContent = data.simulated.newDemand;
        document.getElementById("resSimOverload").textContent = data.simulated.overload;
        document.getElementById("resScenarioName").textContent = data.simulated.scenarioName;

        document.getElementById("resEvalPorts").textContent = data.evaluation.totalPorts;
        document.getElementById("resEvalHubName").textContent = hubId;
        document.getElementById("resEvalDemand").textContent = data.evaluation.newDemand;
        document.getElementById("resEvalUnserved").textContent = data.evaluation.unserved;
        document.getElementById("resEvalUnservedSub").textContent = data.evaluation.unservedSub;

        document.getElementById("resRecTitle").textContent = data.recommendation.title;
        document.getElementById("resRecContent").textContent = data.recommendation.content;

        const actionBox = document.getElementById("actionPlanBox");
        const actionList = document.getElementById("actionList");

        if (data.recommendation.actionPlan && data.recommendation.actionPlan.length > 0) {
          actionList.innerHTML = "";
          data.recommendation.actionPlan.forEach(plan => {
            const li = document.createElement("li");
            li.style.marginBottom = "8px";
            if (plan.type === 'wait') {
              li.innerHTML = `<i class="fa-solid fa-clock" style="color: #ff9800; margin-right: 6px;"></i>
                <strong>${plan.amount} xe</strong> xếp hàng chờ sạc. <em style="color: #6b7280; font-size: 13px;">(${plan.note})</em>`;
            } else if (plan.type === 'dispatch') {
              li.innerHTML = `<i class="fa-solid fa-route" style="color: #2196f3; margin-right: 6px;"></i>
                Điều hướng <strong>${plan.amount} xe</strong> sang <strong>${escapeHubText(plan.targetHub)}</strong>`;
            }
            if (plan.type === "unserved") li.textContent = `${plan.amount} xe chưa có phương án tiếp nhận.`;
            actionList.appendChild(li);
          });
          actionBox.style.display = "block";
        } else {
          actionBox.style.display = "none";
        }

        const badge = document.getElementById("resStatusBadge");
        const cardUnserved = document.getElementById("cardUnserved");
        if (data.recommendation.status === "warning") {
          badge.style.background = "#fff3e0"; badge.style.color = "#ff9800"; badge.textContent = "Quá tải";
          cardUnserved.style.background = "#ffebee"; cardUnserved.style.borderColor = "#ffcdd2";
        } else {
          badge.style.background = "#e8f5e9"; badge.style.color = "#00c853"; badge.textContent = "Ổn định";
          cardUnserved.style.background = "#f5f5f5"; cardUnserved.style.borderColor = "#e0e0e0";
        }

        document.getElementById("simulationEmptyState").style.display = "none";
        document.getElementById("simulationResultWrapper").style.display = "block";
        document.getElementById("simulationResultWrapper").scrollIntoView({ behavior: 'smooth', block: 'start' });

      } else {
        alert("Lỗi từ server: " + result.message);
      }
    } catch (error) {
      console.error("Lỗi Fetch:", error);
      alert("Không thể kết nối đến server!");
    } finally {
      btnRun.innerHTML = originalHtml;
      btnRun.disabled = false;
    }
  });
});

//Bãi đỗ đầy
document.addEventListener("DOMContentLoaded", async () => {
  const totalCapacityInput = document.getElementById("parkingTotalCapacity");
  const currentOccupiedInput = document.getElementById("parkingCurrentOccupied");
  const incomingDemandInput = document.getElementById("parkingIncomingDemand");
  const btnRun = document.getElementById("btnRunParkingSim");

  if (!btnRun) return;
  const hubSelect = document.getElementById('parkingHubId');
  const MOBILITY_HUB_NETWORK_DATA = await loadSimulationHubs(hubSelect);
  if (!hubSelect.value) { btnRun.disabled = true; return; }
  const fillParking = () => {
    const hub = MOBILITY_HUB_NETWORK_DATA[hubSelect.value];
    totalCapacityInput.value = hub.parkingSlots;
    currentOccupiedInput.value = hub.parkingUsed;
    totalCapacityInput.readOnly = currentOccupiedInput.readOnly = true;
  };
  hubSelect.addEventListener('change', fillParking);
  fillParking();

  btnRun.addEventListener("click", () => {
    const hubId = document.getElementById("parkingHubId").value;
    const totalCapacity = parseInt(totalCapacityInput.value) || 0;
    const currentOccupied = parseInt(currentOccupiedInput.value) || 0;
    const incomingDemand = parseInt(incomingDemandInput.value) || 0;

    // Validation cơ bản
    if (currentOccupied > totalCapacity) {
      alert("Lỗi: Số chỗ đang sử dụng không thể vượt quá sức chứa bãi đỗ!");
      return;
    }

    // ==========================================
    // 3. THUẬT TOÁN XỬ LÝ (CLIENT-SIDE)
    // ==========================================
    const availableSlots = Math.max(0, totalCapacity - currentOccupied);
    const overflowVehicles = Math.max(0, incomingDemand - availableSlots);
    const isOverloaded = overflowVehicles > 0;

    // ==========================================
    // 4. CẬP NHẬT GIAO DIỆN (DOM)
    // ==========================================

    // Khối 1 & 2: Cập nhật số liệu
    document.getElementById("resParkingCapacity").textContent = `${totalCapacity} chỗ`;
    document.getElementById("resParkingOccupied").textContent = `${currentOccupied} chỗ`;
    document.getElementById("resParkingAvailable").textContent = `${availableSlots} chỗ`;
    document.getElementById("resParkingIncoming").textContent = `${incomingDemand} xe`;
    document.getElementById("resParkingOverflow").textContent = `+${overflowVehicles} xe`;
    document.getElementById("resEvalAvailable").textContent = `${availableSlots} chỗ`;
    document.getElementById("resEvalHubName").textContent = hubId;
    document.getElementById("resEvalIncoming").textContent = `${incomingDemand} xe`;
    document.getElementById("resEvalOverflow").textContent = `${overflowVehicles} xe`;

    // Các element Khuyến nghị
    const recTitle = document.getElementById("resParkingRecTitle");
    const recContent = document.getElementById("resParkingRecContent");
    const smartActionsList = document.getElementById("resParkingSmartActions");
    const badge = document.getElementById("resParkingBadge");
    const cardOverflow = document.getElementById("cardOverflow");

    // Reset danh sách hành động cũ
    smartActionsList.innerHTML = "";

    if (isOverloaded) {
      // ==========================================
      // TRƯỜNG HỢP 1: BÃI ĐỖ BỊ QUÁ TẢI
      // ==========================================
      const severity = overflowVehicles / totalCapacity; // Tỷ lệ quá tải

      recTitle.textContent = "Điều phối giải tỏa bãi đỗ & Kiểm soát luồng xe";
      recContent.innerHTML = `Bãi đỗ đã đầy. Có <strong>${overflowVehicles} xe</strong> không thể vào đỗ ngay lập tức.`;

      badge.textContent = "Quá tải";
      badge.style.background = "#fff3e0"; badge.style.color = "#ff9800";
      cardOverflow.style.background = "#ffebee"; cardOverflow.style.borderColor = "#ffcdd2";
      document.getElementById("resParkingWarning").className = "text-red";
      document.getElementById("resEvalOverflowSub").textContent = "Tràn bãi đỗ";

      // --- CÁC KHUYẾN NGHỊ DÀNH RIÊNG CHO BÃI ĐỖ XE ---

      // 1. Điều hướng xe sang bãi khác (Alternative Parking)
      smartActionsList.innerHTML += `
        <li style="margin-bottom: 8px;">
          <i class="fa-solid fa-route" style="color: #2196f3; width: 16px;"></i>
          <strong>Alternative Parking:</strong> ${alternativeParking(MOBILITY_HUB_NETWORK_DATA, hubId, overflowVehicles)}
        </li>`;

      // 2. Tạm khóa nhận đặt chỗ (Predictive Throttling) - Chỉ áp dụng nếu quá tải nặng
      if (severity > 0.2) {
        smartActionsList.innerHTML += `
          <li style="margin-bottom: 8px;">
            <i class="fa-solid fa-lock" style="color: #f44336; width: 16px;"></i>
            <strong>Access Control:</strong> Tạm khóa Barie tự động và thông báo tình trạng ${hubId} khi người dùng gửi yêu cầu.
          </li>`;
      }

      // 3. Giá đỗ xe động (Dynamic Parking Pricing)
      smartActionsList.innerHTML += `
        <li style="margin-bottom: 8px;">
          <i class="fa-solid fa-money-bill-trend-up" style="color: #ff9800; width: 16px;"></i>
          <strong>Dynamic Pricing:</strong> Tự động tăng phí đỗ xe lên 1.5x trong khung giờ cao điểm để khuyến khích người dùng rời bãi sớm.
        </li>`;

      // 4. Xử lý xe đỗ quá giờ (Overstay Penalty)
      if (currentOccupied === totalCapacity) {
        smartActionsList.innerHTML += `
          <li style="margin-bottom: 8px;">
            <i class="fa-solid fa-clock-rotate-left" style="color: #dc3545; width: 16px;"></i>
            <strong>Overstay Penalty:</strong> Quét biển số, gửi thông báo thu phí phụ trội (10.000đ/h) tới các xe đã đỗ quá 4 tiếng.
          </li>`;
      }

      // 5. Điều động nhân viên (Valet Support) nếu bãi kẹt cứng
      if (severity > 0.5) {
        smartActionsList.innerHTML += `
          <li style="margin-bottom: 8px;">
            <i class="fa-solid fa-user-shield" style="color: #9c27b0; width: 16px;"></i>
            <strong>Valet Support:</strong> Điều động nhân viên hỗ trợ xếp xe sát nhau hơn (Smart Packing) để tận dụng tối đa diện tích.
          </li>`;
      }

    } else {
      // ==========================================
      // TRƯỜNG HỢP 2: BÃI ĐỖ VẪN ĐÁP ỨNG ĐỦ
      // ==========================================

      recTitle.textContent = "Bãi đỗ đáp ứng đủ";
      recContent.innerHTML = `Sức chứa hiện tại đáp ứng tốt cho ${incomingDemand} xe. Còn dư <strong>${availableSlots - incomingDemand} chỗ trống</strong>.`;

      badge.textContent = "Ổn định";
      badge.style.background = "#e8f5e9"; badge.style.color = "#00c853";
      cardOverflow.style.background = "#f5f5f5"; cardOverflow.style.borderColor = "#e0e0e0";
      document.getElementById("resParkingWarning").className = "text-green";
      document.getElementById("resEvalOverflowSub").textContent = "Đáp ứng đủ";

      smartActionsList.innerHTML = `
        <li style="margin-bottom: 8px;">
          <i class="fa-solid fa-circle-check" style="color: #00c853; width: 16px;"></i>
          <strong>Auto-Pilot Tracking:</strong> Bãi đỗ đang hoạt động tối ưu. Hệ thống AI Camera tiếp tục giám sát và cập nhật bản đồ chỗ trống lên App.
        </li>`;
    }

    // ==========================================
    // 5. HIỂN THỊ KẾT QUẢ (Áp dụng cho cả 2 trường hợp)
    // ==========================================
    document.getElementById("parkingEmptyState").style.display = "none";
    document.getElementById("parkingResultWrapper").style.display = "block";
    document.getElementById("parkingResultWrapper").scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

//Nhu cầu tăng cao
document.addEventListener("DOMContentLoaded", async () => {
  const hubSelect = document.getElementById("demandHubId");
  const btnRun = document.getElementById("btnRunDemandSim");

  if (!btnRun) return;
  const MOBILITY_HUB_NETWORK_DATA = await loadSimulationHubs(hubSelect);
  if (!hubSelect.value) { btnRun.disabled = true; return; }
  let currentHubData = MOBILITY_HUB_NETWORK_DATA[hubSelect.value];

  const updateBaseData = (hubId) => {
    currentHubData = MOBILITY_HUB_NETWORK_DATA[hubId];

    // Hiển thị gợi ý sức chứa
    document.getElementById("hintRent").innerText = `(Sức chứa: ${currentHubData.rentFleet} xe)`;
    document.getElementById("hintParking").innerText = `(Sức chứa: ${currentHubData.parkingSlots} chỗ)`;
    document.getElementById("hintCharging").innerText = `(Sức chứa: ${currentHubData.totalPorts} cổng)`;
  };

  hubSelect.addEventListener("change", (e) => updateBaseData(e.target.value));
  updateBaseData(hubSelect.value);

  // 3. Xử lý khi bấm nút Chạy mô phỏng
  if (!btnRun) return;

  btnRun.addEventListener("click", () => {
    const hubName = currentHubData.name;

    // Lấy nhu cầu người dùng nhập
    const simRent = parseInt(document.getElementById("simRentDemand").value) || 0;
    const simParking = parseInt(document.getElementById("simParkingDemand").value) || 0;
    const simCharging = parseInt(document.getElementById("simChargingDemand").value) || 0;

    // ==========================================
    // TÍNH TOÁN THIẾU HỤT
    // ==========================================
    const rentShortage = Math.max(0, simRent - currentHubData.rentFleet);
    const parkingShortage = Math.max(0, simParking - currentHubData.parkingSlots);
    // Sạc: Dùng totalPorts
    const chargingShortage = Math.max(0, simCharging - currentHubData.totalPorts);

    const isCrisis = rentShortage > 0 || parkingShortage > 0 || chargingShortage > 0;

    // ==========================================
    // CẬP NHẬT DOM (SỐ LIỆU)
    // ==========================================
    document.getElementById("resSimRent").innerHTML = `${simRent} lượt/giờ ${rentShortage > 0 ? `<span class="text-red">(-${rentShortage} xe)</span>` : ''}`;
    document.getElementById("resSimParking").innerHTML = `${simParking} lượt/giờ ${parkingShortage > 0 ? `<span class="text-red">(-${parkingShortage} chỗ)</span>` : ''}`;
    document.getElementById("resSimCharging").innerHTML = `${simCharging} lượt/giờ ${chargingShortage > 0 ? `<span class="text-red">(-${chargingShortage} cổng)</span>` : ''}`;

    document.getElementById("resEvalRent").textContent = `${Math.min(simRent, currentHubData.rentFleet)} / ${simRent} xe`;
    document.getElementById("resEvalRentSub").textContent = rentShortage > 0 ? `Thiếu hụt ${rentShortage} xe` : "Đáp ứng đủ";

    document.getElementById("resEvalParking").textContent = `${Math.min(simParking, currentHubData.parkingSlots)} / ${simParking} chỗ`;
    document.getElementById("resEvalParkingSub").textContent = parkingShortage > 0 ? `Tràn ${parkingShortage} chỗ` : "Đáp ứng đủ";

    document.getElementById("resEvalCharging").textContent = `${Math.min(simCharging, currentHubData.totalPorts)} / ${simCharging} cổng`;
    document.getElementById("resEvalChargingSub").textContent = chargingShortage > 0 ? `Quá tải ${chargingShortage} cổng` : "Đáp ứng đủ";

    // ==========================================
    // KHUYẾN NGHỊ THÔNG MINH
    // ==========================================
    const recTitle = document.getElementById("resRecTitle");
    const recContent = document.getElementById("resRecContent");
    const smartActions = document.getElementById("demandSmartActions");
    const badge = document.getElementById("resStatusBadge");

    smartActions.innerHTML = "";

    if (isCrisis) {
      badge.textContent = "Khủng hoảng nhu cầu";
      badge.style.background = "#ffebee"; badge.style.color = "#d32f2f";
      recTitle.textContent = "Kích hoạt Gói Ứng phó Khủng hoảng (Crisis Response)";

      let contentHtml = `Hub <strong>${escapeHubText(hubName)}</strong> không thể đáp ứng nhu cầu cùng lúc cho cả 3 dịch vụ. `;

      // Xử lý Thuê xe
      if (rentShortage > 0) {
        contentHtml += `Thiếu <strong>${rentShortage} xe</strong>. `;
        smartActions.innerHTML += `
          <li style="margin-bottom: 8px;">
            <i class="fa-solid fa-truck-fast" style="color: #2196f3; width: 16px;"></i>
            <strong>Điều phối xe:</strong> Điều động xe từ trạm khác sang bù đắp ${rentShortage} xe.
          </li>`;
        smartActions.innerHTML += `
          <li style="margin-bottom: 8px;">
            <i class="fa-solid fa-tags" style="color: #ff9800; width: 16px;"></i>
            <strong>Surge Pricing:</strong> Tăng giá thuê xe lên 1.5x để điều tiết nhu cầu.
          </li>`;
      }

      // Xử lý Đỗ xe
      if (parkingShortage > 0) {
        contentHtml += `Tràn <strong>${parkingShortage} chỗ đỗ</strong>. `;
        smartActions.innerHTML += `
          <li style="margin-bottom: 8px;">
            <i class="fa-solid fa-route" style="color: #f44336; width: 16px;"></i>
            <strong>Điều hướng khách hàng:</strong> ${alternativeParking(MOBILITY_HUB_NETWORK_DATA, hubSelect.value, parkingShortage)}
          </li>`;
        smartActions.innerHTML += `
          <li style="margin-bottom: 8px;">
            <i class="fa-solid fa-hand-holding-dollar" style="color: #4caf50; width: 16px;"></i>
            <strong>Hoàn tiền 10%:</strong> Cho khách đang đỗ nếu họ lấy xe ra trong khung giờ cao điểm.
          </li>`;
      }

      // Xử lý Sạc
      if (chargingShortage > 0) {
        contentHtml += `Quá tải <strong>${chargingShortage} cổng sạc</strong>. `;
        smartActions.innerHTML += `
          <li style="margin-bottom: 8px;">
            <i class="fa-solid fa-bolt" style="color: #e91e63; width: 16px;"></i>
            <strong>Sạc nhanh (Fast-Track):</strong> Kích hoạt sạc DC cho xe pin < 20% để giải phóng cổng sớm.
          </li>`;
        smartActions.innerHTML += `
          <li style="margin-bottom: 8px;">
            <i class="fa-solid fa-calendar-xmark" style="color: #9c27b0; width: 16px;"></i>
            <strong>Giãn lịch sạc:</strong> Tặng Voucher cho khách dời lịch sạc sang sau 19:00.
          </li>`;
      }

      recContent.innerHTML = contentHtml + "Các giải pháp vận hành thay thế:";
      document.getElementById("cardUnserved").style.background = "#ffebee";
      document.getElementById("cardUnserved").style.borderColor = "#ffcdd2";

    } else {
      // Bình thường
      badge.textContent = "An toàn";
      badge.style.background = "#e8f5e9"; badge.style.color = "#00c853";
      recTitle.textContent = "Hệ thống đáp ứng tốt";
      recContent.innerHTML = `Tất cả các dịch vụ tại <strong>${escapeHubText(hubName)}</strong> vẫn đáp ứng đủ nhu cầu tăng thêm.`;

      smartActions.innerHTML = `
        <li style="margin-bottom: 8px;">
          <i class="fa-solid fa-circle-check" style="color: #00c853; width: 16px;"></i>
          Hệ thống chạy Auto-pilot. Tiếp tục theo dõi qua Camera AI.
        </li>`;
      document.getElementById("cardUnserved").style.background = "#f5f5f5";
      document.getElementById("cardUnserved").style.borderColor = "#e0e0e0";
    }

    // Hiển thị kết quả
    document.getElementById("demandEmptyState").style.display = "none";
    document.getElementById("demandResultWrapper").style.display = "block";
    document.getElementById("demandResultWrapper").scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

//Xe tập trung nhiều
document.addEventListener("DOMContentLoaded", async () => {
  const hubSelect = document.getElementById("concHubId");
  const btnRun = document.getElementById("btnRunConcentrationSim");

  const currentVehiclesInput = document.getElementById("concCurrentVehicles");
  const simulatedVehiclesInput = document.getElementById("concSimulatedVehicles");
  const departureDemandInput = document.getElementById("concDepartureDemand");

  if (!btnRun) return;
  const MOBILITY_HUB_NETWORK_DATA = await loadSimulationHubs(hubSelect);
  if (!hubSelect.value) { btnRun.disabled = true; return; }
  const updateInputDefaults = (hubId) => {
    currentVehiclesInput.value = MOBILITY_HUB_NETWORK_DATA[hubId].rentFleet;
    currentVehiclesInput.readOnly = true;
  };
  hubSelect.addEventListener('change', (e) => updateInputDefaults(e.target.value));
  updateInputDefaults(hubSelect.value);

  btnRun.addEventListener("click", () => {
    const hubId = hubSelect.value;
    const hubName = MOBILITY_HUB_NETWORK_DATA[hubId].name;

    // Lấy dữ liệu từ người dùng nhập
    const currentVehicles = parseInt(currentVehiclesInput.value) || 0;
    const incomingVehicles = parseInt(simulatedVehiclesInput.value) || 0;
    const departureDemand = parseInt(departureDemandInput.value) || 0;

    // ==========================================
    // TÍNH TOÁN DƯ THỪA
    // ==========================================
    // Tổng xe tại trạm = Xe hiện tại + Xe dồn về
    const totalVehiclesAtHub = currentVehicles + incomingVehicles;

    // Xe dư thừa = Tổng xe - Nhu cầu xuất phát
    const surplus = Math.max(0, totalVehiclesAtHub - departureDemand);
    const isCrisis = surplus > 0;

    // ==========================================
    // CẬP NHẬT DOM (SỐ LIỆU)
    // ==========================================
    document.getElementById("resConcCurrent").textContent = `${currentVehicles} xe`;
    document.getElementById("resConcDeparture").textContent = `${departureDemand} xe/giờ`;

    document.getElementById("resConcTotal").textContent = `${totalVehiclesAtHub} xe`;
    document.getElementById("resConcSurplus").textContent = `+${surplus} xe dư thừa`;
    document.getElementById("resConcWarning").textContent = isCrisis ? "Mất cân bằng cục bộ" : "Bình thường";

    document.getElementById("resConcOverflowHub").textContent = `${hubName} (+${surplus} xe)`;

    // Thuật toán chia xe dư thừa sang các Hub lân cận (Dựa vào availableSlots)
    let dispatchPlan = [];
    let remainingToDispatch = surplus;

    if (isCrisis) {
      // Lấy danh sách các Hub khác, sắp xếp theo availableSlots giảm dần (ưu tiên Hub trống nhiều)
      const targetHubs = Object.keys(MOBILITY_HUB_NETWORK_DATA)
        .filter(id => id !== hubId && MOBILITY_HUB_NETWORK_DATA[id].availableSlots > 0)
        .map(id => ({
          id: id,
          availableSlots: MOBILITY_HUB_NETWORK_DATA[id].availableSlots,

        }))
        .sort((a, b) => b.availableSlots - a.availableSlots);

      for (let hub of targetHubs) {
        if (remainingToDispatch <= 0) break;
        const moveCount = Math.min(remainingToDispatch, hub.availableSlots);

        dispatchPlan.push({
          targetHub: MOBILITY_HUB_NETWORK_DATA[hub.id].name,
          amount: moveCount
        });
        remainingToDispatch -= moveCount;
      }
    }

    // Hiển thị Hub thiếu xe chính (nơi nhận nhiều xe nhất)
    if (dispatchPlan.length > 0) {
      document.getElementById("resConcDeficitHub").textContent = `${dispatchPlan[0].targetHub} (+${dispatchPlan[0].amount} xe tiếp nhận)`;
    } else {
      document.getElementById("resConcDeficitHub").textContent = "Không có";
    }

    // ==========================================
    // KHUYẾN NGHỊ VẬN HÀNH
    // ==========================================
    const recTitle = document.getElementById("resConcRecTitle");
    const recContent = document.getElementById("resConcRecContent");
    const smartActions = document.getElementById("concSmartActions");
    const badge = document.getElementById("resConcStatusBadge");

    if (isCrisis) {
      document.getElementById("resConcLevel").textContent = surplus > 10 ? "Mức Cao ⚠" : "Mức Trung bình ⚠";
      badge.textContent = "Mất cân bằng";
      badge.style.background = "#ffebee"; badge.style.color = "#d32f2f";
      document.getElementById("cardConcUnserved").style.background = "#ffebee";
      document.getElementById("cardConcUnserved").style.borderColor = "#ffcdd2";

      recTitle.textContent = "Tạo lệnh Điều phối Tái cân bằng Mạng lưới Phương tiện";
      recContent.innerHTML = `Tạo lệnh giả lập tối khẩn cấp: Rút <strong>${surplus} xe máy điện</strong> tồn đọng từ ${escapeHubText(hubName)} để xem xét điều phối sang các Hub còn chỗ tiếp nhận.`;

      let listHtml = "";
      dispatchPlan.forEach(plan => {
        listHtml += `
          <li style="margin-bottom: 8px;">
            <i class="fa-solid fa-truck-fast" style="color: #2196f3; width: 16px;"></i>
            <strong>Điều phối xe:</strong> Chuyển <strong>${plan.amount} xe</strong> sang <strong>${escapeHubText(plan.targetHub)}</strong>.
          </li>
        `;
      });

      if (remainingToDispatch > 0) listHtml += `<li>Còn ${remainingToDispatch} xe chưa có Hub tiếp nhận.</li>`;
      listHtml += `
        <li style="margin-bottom: 8px;">
          <i class="fa-solid fa-tags" style="color: #4caf50; width: 16px;"></i>
          <strong>Dynamic Incentive Policy:</strong> Kích hoạt ưu đãi giảm 15% cước chuyến cho khách thuê xe xuất phát từ ${escapeHubText(hubName)} sang Hub còn chỗ tiếp nhận.
        </li>
      `;
      smartActions.innerHTML = listHtml;

    } else {
      document.getElementById("resConcLevel").textContent = "Thấp (An toàn)";
      badge.textContent = "Cân bằng";
      badge.style.background = "#e8f5e9"; badge.style.color = "#00c853";
      document.getElementById("cardConcUnserved").style.background = "#f5f5f5";
      document.getElementById("cardConcUnserved").style.borderColor = "#e0e0e0";

      recTitle.textContent = "Mạng lưới ổn định";
      recContent.innerHTML = `Lượng xe tại ${escapeHubText(hubName)} vẫn nằm trong ngưỡng an toàn so với nhu cầu xuất phát. Không có hiện tượng tồn đọng xe.`;
      smartActions.innerHTML = `
        <li style="margin-bottom: 8px;">
          <i class="fa-solid fa-circle-check" style="color: #00c853; width: 16px;"></i>
          Hệ thống chạy Auto-pilot. Tiếp tục giám sát lưu lượng.
        </li>
      `;
    }

    // Hiển thị khối kết quả
    document.getElementById("concEmptyState").style.display = "none";
    document.getElementById("concResultWrapper").style.display = "block";
    document.getElementById("concResultWrapper").scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});


//Trang quản lý sự cố
document.addEventListener("DOMContentLoaded", () => {
  const incidentRows = document.querySelectorAll(".incident-row");
  const detailCard = document.getElementById("detailCard");
  const emptyDetailState = document.getElementById("emptyDetailState");

  // Các element hiển thị thông tin
  const elTicketCode = document.getElementById("detailTicketCode");
  const elBadge = document.getElementById("detailBadge");
  const elVehicle = document.getElementById("detailVehicle");
  const elHub = document.getElementById("detailHub");
  const elType = document.getElementById("detailType");
  const elCreatedBy = document.getElementById("detailCreatedBy");
  const elTime = document.getElementById("detailTime");

  // Các element nút bấm và footer
  const detailFooter = document.getElementById("detailFooter");
  const btnConfirm = document.getElementById("btnConfirmTicket");
  const btnIgnore = document.getElementById("btnIgnoreTicket");

  let currentSelectedId = null;
  let currentSelectedStatus = null;

  // ==========================================
  // 1. XỬ LÝ CLICK VÀO DÒNG SỰ CỐ
  // ==========================================
  if (incidentRows.length > 0) {
    incidentRows.forEach(row => {
      row.addEventListener("click", function () {
        // Highlight dòng được chọn
        incidentRows.forEach(r => r.classList.remove("active"));
        this.classList.add("active");

        // Lấy dữ liệu
        const data = {
          id: this.getAttribute("data-id"),
          ticket: this.getAttribute("data-ticket"),
          vehicle: this.getAttribute("data-vehicle"),
          hub: this.getAttribute("data-hub"),
          type: this.getAttribute("data-type"),
          createdBy: this.getAttribute("data-createdby"),
          time: this.getAttribute("data-time"),
          status: this.getAttribute("data-status"),
        };

        currentSelectedId = data.id;
        currentSelectedStatus = data.status;

        // Cập nhật Text
        elTicketCode.textContent = `Chi tiết Ticket ${data.ticket}`;
        elVehicle.textContent = data.vehicle;
        elHub.textContent = data.hub;
        elType.textContent = data.type;
        elCreatedBy.textContent = data.createdBy;
        elTime.textContent = data.time;

        // Cập nhật Badge
        elBadge.className = "badge";
        elBadge.textContent = data.status;
        switch (data.status) {
          case 'Urgent': elBadge.classList.add("badge--red"); break;
          case 'Medium': elBadge.classList.add("badge--orange"); break;
          case 'Resolved': elBadge.classList.add("badge--green"); break;
          case 'In Progress': elBadge.classList.add("badge--blue"); break;
          default: elBadge.classList.add("badge--gray");
        }

        // ==========================================
        // XỬ LÝ ẨN/HIỆN NÚT DỰA VÀO TRẠNG THÁI
        // ==========================================
        // Xóa thông báo cũ (nếu có)
        const oldMessage = document.getElementById("resolvedMessage");
        if (oldMessage) oldMessage.remove();

        if (data.status === 'Resolved') {
          // Nếu đã bỏ qua/khắc phục -> Ẩn cả 2 nút
          btnConfirm.style.display = "none";
          btnIgnore.style.display = "none";

          // Hiển thị thông báo
          const msg = document.createElement("div");
          msg.id = "resolvedMessage";
          msg.style.cssText = "width: 100%; text-align: center; color: #00c853; font-weight: 600; padding: 10px;";
          msg.innerHTML = '<i class="fa-solid fa-circle-check"></i> Sự cố này đã được xử lý hoặc bỏ qua.';
          detailFooter.appendChild(msg);

        } else if (data.status === 'In Progress') {
          // Nếu đang xử lý -> Khóa nút Xác nhận, ẩn nút Bỏ qua
          btnConfirm.style.display = "inline-block";
          btnConfirm.innerText = "Đang xử lý (Chờ KTV)";
          btnConfirm.disabled = true;

          btnIgnore.style.display = "none";

        } else {
          // Trạng thái bình thường (Urgent, Medium, Low, Open)
          btnConfirm.style.display = "inline-block";
          btnConfirm.innerText = "Xác nhận sự cố & Yêu cầu sửa chữa";
          btnConfirm.disabled = false;

          btnIgnore.style.display = "inline-block";
          btnIgnore.innerText = "Bỏ qua cảnh báo";
          btnIgnore.disabled = false;
        }

        // Hiển thị khung chi tiết
        emptyDetailState.style.display = "none";
        detailCard.style.display = "block";
      });
    });

    // Tự động click vào dòng đầu tiên khi vào trang
    incidentRows[0].click();
  }

  // ==========================================
  // 2. XỬ LÝ NÚT XÁC NHẬN SỰ CỐ
  // ==========================================
  if (btnConfirm) {
    btnConfirm.addEventListener("click", async () => {
      if (!currentSelectedId || currentSelectedStatus === 'Resolved' || currentSelectedStatus === 'In Progress') return;

      if (!confirm("Xác nhận sự cố và tạo yêu cầu sửa chữa?")) return;

      const originalText = btnConfirm.innerText;
      btnConfirm.innerText = "Đang xử lý...";
      btnConfirm.disabled = true;

      try {
        const res = await fetch("/admin/incident/update-status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: currentSelectedId, status: "In Progress" })
        });
        const data = await res.json();

        if (data.code === "success") {
          alert("Đã xác nhận và gửi yêu cầu sửa chữa!");
          window.location.reload();
        } else {
          alert(data.message || "Có lỗi xảy ra");
          btnConfirm.innerText = originalText;
          btnConfirm.disabled = false;
        }
      } catch (error) {
        console.error(error);
        alert("Lỗi kết nối đến server!");
        btnConfirm.innerText = originalText;
        btnConfirm.disabled = false;
      }
    });
  }

  // ==========================================
  // 3. XỬ LÝ NÚT BỎ QUA
  // ==========================================
  if (btnIgnore) {
    btnIgnore.addEventListener("click", async () => {
      if (!currentSelectedId || currentSelectedStatus === 'Resolved' || currentSelectedStatus === 'In Progress') return;

      if (!confirm("Bạn có chắc chắn muốn bỏ qua cảnh báo này?")) return;

      const originalText = btnIgnore.innerText;
      btnIgnore.innerText = "Đang xử lý...";
      btnIgnore.disabled = true;

      try {
        const res = await fetch("/admin/incident/update-status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: currentSelectedId, status: "Resolved" })
        });
        const data = await res.json();

        if (data.code === "success") {
          alert("Đã bỏ qua cảnh báo!");
          window.location.reload();
        } else {
          alert(data.message || "Có lỗi xảy ra");
          btnIgnore.innerText = originalText;
          btnIgnore.disabled = false;
        }
      } catch (error) {
        console.error(error);
        alert("Lỗi kết nối đến server!");
        btnIgnore.innerText = originalText;
        btnIgnore.disabled = false;
      }
    });
  }
});

//Xử lý lệnh điều phối
document.addEventListener("DOMContentLoaded", async () => {
  if (!document.getElementById('btnDispatch')) return;
  let DISPATCH_DB;
  try {
    const response = await fetch('/admin/dispatch/data');
    const result = await response.json();
    if (result.code !== 'success') throw new Error(result.message);
    DISPATCH_DB = result.data;
  } catch (error) {
    alert(error.message || 'Không thể lấy dữ liệu điều phối.');
    return;
  }

  // ==========================================
  // 2. LẤY CÁC ELEMENT
  // ==========================================
  const fromSelect = document.getElementById("dispatchFromHub");
  const toSelect = document.getElementById("dispatchToHub");
  const vehicleList = document.getElementById("vehicleList");
  const selectionCount = document.getElementById("selectionCount");
  const hintFromHub = document.getElementById("hintFromHub");
  const hintToHub = document.getElementById("hintToHub");
  const btnDispatch = document.getElementById("btnDispatch");
  const historyBody = document.getElementById("dispatchHistory");
  const totalDispatchEl = document.getElementById("totalDispatch");

  const alertFromHub = document.getElementById("alertFromHub");
  const alertToHub = document.getElementById("alertToHub");
  const alertFromDesc = document.getElementById("alertFromDesc");
  const alertToDesc = document.getElementById("alertToDesc");
  const alertAmount = document.getElementById("alertAmount");

  // ==========================================
  // 3. ĐỔ DỮ LIỆU HUB VÀO SELECT
  // ==========================================
  const initHubSelects = () => {
    fromSelect.innerHTML = "";
    toSelect.innerHTML = "";

    Object.keys(DISPATCH_DB.hubs).forEach(id => {
      const hub = DISPATCH_DB.hubs[id];
      const text = `${hub.name} (Đỗ ${hub.current}/${hub.capacity})`;

      const opt1 = document.createElement("option");
      opt1.value = id;
      opt1.textContent = text;
      fromSelect.appendChild(opt1);

      const opt2 = document.createElement("option");
      opt2.value = id;
      opt2.textContent = text;
      toSelect.appendChild(opt2);
    });

    // Đặt Hub đích mặc định là Hub thứ 2 (khác Hub nguồn)
    if (toSelect.options.length > 1) toSelect.selectedIndex = 1;
  };

  // ==========================================
  // 4. HÀM LẤY XE KHẢ DỤNG CỦA HUB NGUỒN
  // ==========================================
  const getAvailableVehicles = () => {
    const fromId = fromSelect.value;
    const list = DISPATCH_DB.vehiclesByHub[fromId] || [];
    return list.filter(v => v.status === "Sẵn sàng");
  };

  // ==========================================
  // 5. LOAD XE THEO HUB NGUỒN
  // ==========================================
  const loadVehicles = () => {
    const fromId = fromSelect.value;
    const list = DISPATCH_DB.vehiclesByHub[fromId] || [];
    vehicleList.innerHTML = "";

    if (list.length === 0) {
      vehicleList.innerHTML = `<p class="text-muted" style="padding: 12px; text-align: center;">Không có xe nào tại Hub này.</p>`;
      updateSelectionCount();
      return;
    }

    list.forEach(v => {
      const isReady = v.status === "Sẵn sàng";
      const isLowPin = v.pin != null && v.pin < 20;

      const label = document.createElement("label");
      label.className = "vehicle-item";

      label.innerHTML = `
        <input type="checkbox" data-id="${v.id}" ${isReady ? '' : 'disabled'}>
        <div class="vehicle-info">
          <strong class="vehicle-id">${escapeHubText(v.code || v.id)}</strong>
          <span class="vehicle-name">${escapeHubText(v.name)}</span>
        </div>
        <div class="vehicle-meta">
          <span class="pin-text ${isLowPin ? 'text-red' : ''}">${v.pin == null ? "Pin: chưa có dữ liệu" : "Pin " + escapeHubText(v.pin) + "%"}</span>
          <span class="badge-status ${isReady ? '' : 'text-red'}">${v.status}</span>
        </div>
      `;

      vehicleList.appendChild(label);
    });

    // Gắn sự kiện cho checkbox
    vehicleList.querySelectorAll('input[type="checkbox"]:not(:disabled)').forEach(cb => {
      cb.addEventListener("change", updateSelectionCount);
    });

    updateSelectionCount();
  };

  // ==========================================
  // 6. CẬP NHẬT SỐ LƯỢNG ĐÃ CHỌN
  // ==========================================
  const updateSelectionCount = () => {
    const checked = vehicleList.querySelectorAll('input[type="checkbox"]:checked');
    const availableCount = getAvailableVehicles().length;
    const checkedCount = checked.length;

    selectionCount.textContent = `${checkedCount} / ${availableCount} đã chọn`;

    // Kiểm tra vượt quá số chỗ trống của Hub đích
    const toId = toSelect.value;
    const toHub = DISPATCH_DB.hubs[toId];
    const emptySlots = toHub ? (toHub.capacity - toHub.current) : 0;

    if (checkedCount > emptySlots) {
      selectionCount.className = "selection-count text-red";
      hintToHub.textContent = `⚠ Bạn đang chọn ${checkedCount} xe, nhưng Hub đích chỉ còn ${emptySlots} chỗ!`;
      hintToHub.className = "form-hint text-red";
      btnDispatch.disabled = true;
    } else if (checkedCount === 0 || toId === fromSelect.value) {
      selectionCount.className = "selection-count";
      btnDispatch.disabled = true;
    } else {
      selectionCount.className = "selection-count text-green";
      btnDispatch.disabled = false;
    }

    // Cập nhật khối cảnh báo
    alertAmount.textContent = `${checkedCount} xe cần chuyển`;
  };

  // ==========================================
  // 7. CẬP NHẬT THÔNG TIN HUB ĐÍCH
  // ==========================================
  const updateToHubInfo = () => {
    const toId = toSelect.value;
    const fromId = fromSelect.value;

    // Không cho chọn trùng Hub
    if (toId === fromId) {
      hintToHub.textContent = "⚠ Hub đích không được trùng với Hub nguồn!";
      hintToHub.className = "form-hint text-red";
      btnDispatch.disabled = true;
      return;
    }

    const hub = DISPATCH_DB.hubs[toId];
    if (!hub) return;

    const emptySlots = hub.capacity - hub.current;
    hintToHub.textContent = `Còn trống ${emptySlots} chỗ để tiếp nhận`;
    hintToHub.className = "form-hint " + (emptySlots > 0 ? "text-green" : "text-red");

    // Cập nhật khối cảnh báo bên phải
    alertToHub.textContent = hub.name;
    alertToDesc.textContent = `Đỗ ${hub.current}/${hub.capacity} — Còn trống ${emptySlots} chỗ`;

    // Cập nhật lại selection count (vì số chỗ trống có thể thay đổi)
    updateSelectionCount();
  };

  // ==========================================
  // 8. RENDER BẢNG LỊCH SỬ
  // ==========================================
  const renderHistory = () => {
    historyBody.innerHTML = "";
    totalDispatchEl.textContent = `Tổng cộng: ${DISPATCH_DB.history.length} lệnh`;

    DISPATCH_DB.history.forEach((item, index) => {
      const tr = document.createElement("tr");

      const statusHtml = item.status === 'moving'
        ? `<span class="status-badge bg-blue"><i class="fa-solid fa-circle"></i> Đang di chuyển</span>`
        : `<span class="status-badge bg-green"><i class="fa-solid fa-circle"></i> Đã hoàn thành</span>`;

      tr.innerHTML = `
        <td>${index + 1}</td>
        <td class="font-bold">${item.code}</td>
        <td>
          <span class="hub-source">${escapeHubText(item.from)}</span>
          <i class="fa-solid fa-arrow-right text-muted"></i>
          <span class="hub-dest">${escapeHubText(item.to)}</span>
        </td>
        <td>${item.amount} xe</td>
        <td>${item.time}</td>
        <td>${statusHtml}</td>
      `;

      historyBody.appendChild(tr);
    });
  };

  // ==========================================
  // 9. SỰ KIỆN ĐỔI HUB NGUỒN
  // ==========================================
  fromSelect.addEventListener("change", () => {
    const fromId = fromSelect.value;
    const fromHub = DISPATCH_DB.hubs[fromId];
    if (!fromHub) return;
    // Cập nhật hint
    const available = getAvailableVehicles().length;
    hintFromHub.textContent = `${available} xe khả dụng sẵn sàng để chuyển`;
    hintFromHub.className = "form-hint " + (available > 0 ? "text-green" : "text-red");

    // Cập nhật khối cảnh báo
    alertFromHub.textContent = fromHub.name;
    const overload = fromHub.current - Math.round(fromHub.capacity * 0.8);
    alertFromDesc.textContent = `Đỗ ${fromHub.current}/${fromHub.capacity} — ${overload > 0 ? 'Dư +' + overload + ' xe' : 'Bình thường'}`;
    alertFromDesc.className = overload > 0 ? "text-orange" : "text-green";

    // Load xe mới
    loadVehicles();
    updateToHubInfo();
  });

  // ==========================================
  // 10. SỰ KIỆN ĐỔI HUB ĐÍCH
  // ==========================================
  toSelect.addEventListener("change", updateToHubInfo);

  // ==========================================
  // 11. KHỞI TẠO
  // ==========================================
  initHubSelects();
  renderHistory();
  if (fromSelect.value) fromSelect.dispatchEvent(new Event("change"));

  // ==========================================
  // 12. XỬ LÝ NÚT GỬI LỆNH 
  // ==========================================
  btnDispatch.addEventListener("click", async () => {
    const fromId = fromSelect.value;
    const toId = toSelect.value;
    const priority = document.querySelector('input[name="priority"]:checked').value;
    const checkedBoxes = vehicleList.querySelectorAll('input[type="checkbox"]:checked');
    const vehicleIds = Array.from(checkedBoxes).map(cb => cb.getAttribute("data-id"));

    // Validate
    if (vehicleIds.length === 0) {
      alert("Vui lòng chọn ít nhất 1 xe để điều phối!");
      return;
    }
    if (fromId === toId) {
      alert("Hub nguồn và Hub đích không được trùng nhau!");
      return;
    }

    const toHub = DISPATCH_DB.hubs[toId];
    const emptySlots = toHub.capacity - toHub.current;
    if (vehicleIds.length > emptySlots) {
      alert(`Hub đích chỉ còn ${emptySlots} chỗ, không thể nhận ${vehicleIds.length} xe!`);
      return;
    }

    if (!confirm(`Xác nhận phát lệnh điều phối ${vehicleIds.length} xe từ ${fromId} sang ${toId}?`)) {
      return;
    }

    // Hiệu ứng loading
    const originalText = btnDispatch.innerHTML;
    btnDispatch.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Đang phát lệnh...`;
    btnDispatch.disabled = true;

    try {
      const response = await fetch('/admin/dispatch/create', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({fromId, toId, vehicleIds, priority})
      });
      const result = await response.json();
      if (result.code !== 'success') throw new Error(result.message);
      const refreshed = await fetch('/admin/dispatch/data');
      const updated = await refreshed.json();
      if (updated.code !== 'success') throw new Error(updated.message);
      DISPATCH_DB = updated.data;
      initHubSelects();
      if (DISPATCH_DB.hubs[fromId]) fromSelect.value = fromId;
      if (DISPATCH_DB.hubs[toId]) toSelect.value = toId;
      renderHistory();
      fromSelect.dispatchEvent(new Event('change'));
      alert(result.message);
    } catch (error) {
      alert(error.message || 'Không thể điều phối xe.');
    } finally {
      btnDispatch.innerHTML = originalText;
      updateSelectionCount();
    }
  });
});


