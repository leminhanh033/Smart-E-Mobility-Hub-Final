(() => {
  const el = (id) => document.getElementById(id);
  const put = (id, text) => {
    if (el(id)) el(id).textContent = String(text ?? '—');
  };
  const make = (tag, text, cls) => {
    const node = document.createElement(tag);
    if (text != null) node.textContent = String(text);
    if (cls) node.className = cls;
    return node;
  };
  const lower = (v, fallback = 'ac') => String(v || fallback).toLowerCase();
  const showError = (e) => alert(e.message || 'Không thể xử lý yêu cầu.');

  async function api(url, body) {
    const response = await fetch(
      url,
      body === undefined
        ? {}
        : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    );
    const result = await response.json();
    if (!response.ok || result.code !== 'success') throw new Error(result.message || 'Lỗi máy chủ.');
    return result;
  }

  function options(select, rows) {
    select.replaceChildren(
      ...rows.map((h) => {
        const o = make('option', h.name);
        o.value = h.id;
        return o;
      })
    );
  }

  function renderQueueItem(b, i) {
    const item = make('div', null, 'queue-item');
    item.draggable = true;
    item.dataset.index = i;
    item.dataset.id = b.id;
    item.append(make('span', `${i + 1}`, 'queue-index'));

    const main = make('div', null, 'queue-main');

    const line1 = make('div', null, 'queue-line1');
    line1.append(make('span', b.vehicle, 'queue-vehicle'));
    if (b.license) line1.append(make('span', b.license, 'queue-license'));
    line1.append(
      make(
        'span',
        b.requestType === 'demand' ? 'Nhu cầu sạc' : 'Lịch sạc',
        `queue-tag ${b.requestType === 'demand' ? 'tag-demand' : 'tag-booking'}`
      )
    );
    main.append(line1);

    const line2 = make('div', null, 'queue-line2');
    line2.append(make('span', `${b.duration} phút`));
    line2.append(
      make('span', `Pin: ${b.pin == null ? '—' : b.pin + '%'}`, b.pin != null && b.pin < 10 ? 'pin-low' : '')
    );
    line2.append(make('span', b.portType || 'AC', `queue-type queue-type--${lower(b.portType)}`));
    line2.append(make('span', new Date(b.scheduledStart).toLocaleString('vi-VN'), 'queue-time'));
    main.append(line2);

    item.append(main);

    item.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', b.id);
      item.classList.add('dragging');
    });
    item.addEventListener('dragend', () => item.classList.remove('dragging'));

    return item;
  }

  function renderPortCard(p) {
    const card = make('div', null, 'port-card');

    const head = make('div', null, 'port-head');
    head.append(make('span', p.code, 'port-code'));
    head.append(make('span', p.type || 'AC', `port-badge port-badge--${lower(p.type)}`));
    card.append(head);

    const statusMap = {
      active: { text: 'Khả dụng', cls: 'is-free' },
      charging: { text: 'Đang sạc', cls: 'is-charging' },
      maintenance: { text: 'Bảo trì', cls: 'is-off' },
      inactive: { text: 'Tắt', cls: 'is-off' },
    };
    const st = statusMap[p.status] || { text: p.status, cls: 'is-off' };
    card.append(make('span', st.text, `port-status ${st.cls}`));

    if (p.active) {
      const a = p.active;
      const info = make('div', null, 'port-vehicle');

      info.append(make('div', `${a.vehicle}${a.license ? ' · ' + a.license : ''}`, 'vehicle-name'));

      const meta = make('div', null, 'vehicle-meta');
      meta.append(make('span', `Pin: ${a.pin != null ? a.pin + '%' : '—'}`));
      meta.append(make('span', `${a.duration || '—'} phút`));
      meta.append(
        make('span', a.requestType === 'demand' ? 'Từ nhu cầu sạc' : 'Từ lịch sạc', 'vehicle-source')
      );
      info.append(meta);

      if (a.startedAt && a.expectedEndAt) {
        const start = new Date(a.startedAt).getTime();
        const end = new Date(a.expectedEndAt).getTime();
        const total = end - start;
        const now = Date.now();
        const isDone = now >= end;
        const pct = isDone
          ? 100
          : total > 0
            ? Math.min(100, Math.max(0, Math.round(((now - start) / total) * 100)))
            : 0;

        const bar = make('div', null, 'port-progress');
        const fill = make('div', null, 'port-progress__fill');
        fill.style.width = pct + '%';
        if (isDone) fill.classList.add('is-done');
        bar.append(fill);
        info.append(bar);

        const remainMin = Math.max(0, Math.ceil((end - now) / 60000));
        info.append(make('div', isDone ? 'Sắp hoàn tất…' : `Còn ~${remainMin} phút`, 'vehicle-remain'));
      }

      card.append(info);
    } else if (p.status === 'active') {
      card.append(make('div', 'Sẵn sàng nhận xe', 'port-empty'));
    }

    return card;
  }

  async function initCharging() {
    const hub = el('scHubId');
    const queue = el('vehicleQueueList');
    const ports = el('portScheduleList');

    const hubs = (await api('/admin/charging/schedule/hubs')).data;
    options(hub, hubs.map((h) => ({ id: String(h._id), name: h.name })));

    let rows = [];
    let dirty = false;

    queue.addEventListener('dragover', (e) => e.preventDefault());
    queue.addEventListener('drop', (e) => {
      e.preventDefault();
      const target = e.target.closest('.queue-item');
      if (!target) return;
      const draggedId = e.dataTransfer.getData('text/plain');
      const targetIdx = Number(target.dataset.index);
      if (Number.isNaN(targetIdx)) return;

      const index = rows.findIndex((x) => x.id === draggedId);
      if (index < 0 || index === targetIdx) return;

      const [row] = rows.splice(index, 1);
      rows.splice(targetIdx, 0, row);
      dirty = true;
      renderQueue();
    });

    function renderQueue() {
      if (!rows.length) {
        queue.replaceChildren(make('p', 'Không có xe chờ', 'queue-empty'));
        return;
      }
      queue.replaceChildren(...rows.map((b, i) => renderQueueItem(b, i)));
    }

    async function load() {
      if (!hub.value) {
        queue.replaceChildren(make('p', 'Không có Hub đang hoạt động'));
        ports.replaceChildren();
        return;
      }

      const d = (
        await api('/admin/charging/schedule/data/' + encodeURIComponent(hub.value))
      ).data;

      rows = d.queue || [];
      renderQueue();
      ports.replaceChildren(...(d.ports || []).map(renderPortCard));

      put('scTotalPorts', d.ports.length);
      put('scPortCount', `${d.ports.length} cổng`);
      put(
        'scPortTypes',
        `AC: ${d.ports.filter((p) => p.type === 'AC').length} • DC: ${d.ports.filter((p) => p.type === 'DC').length}`
      );
      put('scAvailablePorts', d.ports.filter((p) => p.status === 'active').length);
      put('scWaitingVehicles', rows.length);
      put('scQueueCount', `${rows.length} xe chờ; ${d.genericRequests || 0} yêu cầu cũ chưa có thông tin xe`);
      put('scScheduledVehicles', `${d.ports.filter((p) => p.booking === 'active').length} đã giữ cổng`);
      put('scUrgentVehicles', rows.filter((b) => b.pin != null && b.pin < 10).length);
      put('scPortsInUseText', `${d.ports.filter((p) => p.status !== 'active').length} cổng không khả dụng`);
    }

    hub.addEventListener('change', () => load().catch(showError));

    for (const [id, automatic] of [
      ['scBtnSave', false],
      ['scBtnAuto', true],
    ]) {
      el(id).addEventListener('click', async () => {
        const b = el(id);
        b.disabled = true;
        try {
          const r = await api('/admin/charging/schedule/order', {
            hubId: hub.value,
            ids: rows.map((x) => x.id),
            automatic,
          });

          let msg = r.message;
          alert(msg);

          await load();
        } catch (e) {
          showError(e);
        } finally {
          b.disabled = false;
          dirty = false;
        }
      });
    }

    await load();

    setInterval(() => {
      if (!document.hidden && hub.value && !dirty) load().catch(() => {});
    }, 3000);
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (el('scHubId')) initCharging().catch(showError);
  });
})();