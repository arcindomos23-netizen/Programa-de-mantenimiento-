// Configuration Constants
const ITEMS_PER_PAGE = {
  vehicles: 25,
  schedule: 10,
  predictive: 20
};

// Global State
let fleetData = { vehicles: [] };
let filteredVehicles = [];
let filteredSchedule = [];
let filteredPredictive = [];

let currentTab = 'dashboard-view';
let activePages = {
  vehicles: 1,
  schedule: 1,
  predictive: 1
};

// Active Search Queries & Filters
let searchQueries = {
  vehicles: '',
  predictive: ''
};

let activeFilters = {
  poblacion: '',
  statusLub: '',
  statusMpp: '',
  predictiveStatus: ''
};

let scheduleMode = 'lub'; // 'lub' or 'mpp'
let currentVehicleDetailId = null;

// Initialize Application
window.addEventListener('DOMContentLoaded', () => {
  initApp();
  setupEventListeners();
});

// Load Data
async function initApp() {
  showToast('Cargando base de datos...', 'info');
  
  const localData = localStorage.getItem('fleet_db');
  if (localData) {
    try {
      fleetData = JSON.parse(localData);
      showToast('Base de datos cargada desde almacenamiento local.', 'success');
      onDataLoaded();
    } catch (e) {
      console.error('Error parsing localStorage fleetData, reloading from JSON file', e);
      await loadDataFromJsonFile();
    }
  } else {
    await loadDataFromJsonFile();
  }
}

async function loadDataFromJsonFile() {
  try {
    const response = await fetch('fleet_db.json');
    if (!response.ok) throw new Error('Network response was not OK');
    fleetData = await response.json();
    saveToLocalStorage();
    showToast('Base de datos inicializada desde archivo JSON.', 'success');
    onDataLoaded();
  } catch (error) {
    console.error('Error loading fleet_db.json:', error);
    showToast('Error al cargar la base de datos inicial.', 'error');
  }
}

function saveToLocalStorage() {
  localStorage.setItem('fleet_db', JSON.stringify(fleetData));
}

function onDataLoaded() {
  // Update state with calculated dynamic fields if needed
  recalculateAllStatuses();
  
  // Populate populations filter
  populateFilters();
  
  // Initial render
  renderDashboard();
  renderVehiclesTable();
  renderScheduleTable();
  renderPredictiveTable();
}

// Recalculate states dynamically based on the current actual date
function recalculateAllStatuses() {
  const today = new Date();
  
  fleetData.vehicles.forEach(v => {
    // 1. Lubrication Status
    if (v.lubrication && v.lubrication.f_ultima_lub) {
      const lastLub = new Date(v.lubrication.f_ultima_lub);
      const daysElapsed = Math.floor((today - lastLub) / (1000 * 60 * 60 * 24));
      v.lubrication.tiempo_aceite = daysElapsed;
      
      const freqDays = v.lubrication.frecuencia_dias || 180;
      const daysRemaining = freqDays - daysElapsed;
      v.lubrication.prioridad_tiempo = daysRemaining;
      
      if (daysRemaining <= 0) {
        v.lubrication.estado_tiempo = 'PASADO';
      } else if (daysRemaining <= 15) {
        v.lubrication.estado_tiempo = 'PRÓXIMO';
      } else {
        v.lubrication.estado_tiempo = 'VIGENTE';
      }
      
      // Compute overall status (usually driven by the worst of time or km)
      // Since we don't dynamically sync active telemetry KM daily, we keep km calculations relative to what was extracted
      const kmRemaining = (v.lubrication.frecuencia_km || 5000) - (v.lubrication.km_aceite || 0);
      v.lubrication.prioridad_km = Math.floor(kmRemaining);
      
      if (kmRemaining <= 0) {
        v.lubrication.estado_km = 'PASADO';
      } else if (kmRemaining <= 500) {
        v.lubrication.estado_km = 'PRÓXIMO';
      } else {
        v.lubrication.estado_km = 'VIGENTE';
      }
    }
    
    // 2. MPP Status
    if (v.mpp && v.mpp.f_ultima_inspeccion) {
      const lastMpp = new Date(v.mpp.f_ultima_inspeccion);
      const daysElapsed = Math.floor((today - lastMpp) / (1000 * 60 * 60 * 24));
      v.mpp.tiempo_mpp = daysElapsed;
      
      // Default frequency for MPP is 90 days if not set
      const freqDays = 90;
      const daysRemaining = freqDays - daysElapsed;
      
      if (daysRemaining <= 0) {
        v.mpp.estado_tiempo = 'PASADO';
      } else if (daysRemaining <= 10) {
        v.mpp.estado_tiempo = 'PRÓXIMO';
      } else {
        v.mpp.estado_tiempo = 'VIGENTE';
      }
    }
  });
}

function populateFilters() {
  const populations = new Set();
  fleetData.vehicles.forEach(v => {
    if (v.poblacion) populations.add(v.poblacion);
  });
  
  const selectPob = document.getElementById('filter-poblacion');
  selectPob.innerHTML = '<option value="">Todas las Poblaciones</option>';
  
  Array.from(populations).sort().forEach(p => {
    const opt = document.createElement('option');
    opt.value = p;
    opt.textContent = p;
    selectPob.appendChild(opt);
  });
}

// ----------------------------------------------------
// UI RENDERING - DASHBOARD
// ----------------------------------------------------
function renderDashboard() {
  const total = fleetData.vehicles.length;
  
  // Calculate alerts
  let passedLub = 0;
  let passedMpp = 0;
  let expiredDocs = 0;
  
  const todayStr = getTodayString();
  const alertsList = [];
  
  fleetData.vehicles.forEach(v => {
    let isAlert = false;
    let reasons = [];
    
    // Check Lub
    if (v.lubrication && (v.lubrication.estado_tiempo === 'PASADO' || v.lubrication.estado_km === 'PASADO')) {
      passedLub++;
      isAlert = true;
      const details = v.lubrication.estado_km === 'PASADO' 
        ? `Exceso de KMs (${v.lubrication.km_aceite}/${v.lubrication.frecuencia_km} KMs)`
        : `Vencido por tiempo (${v.lubrication.tiempo_aceite}/${v.lubrication.frecuencia_dias} días)`;
      reasons.push({ type: 'LUB', text: `Lubricación Vencida: ${details}`, status: 'red' });
    } else if (v.lubrication && (v.lubrication.estado_tiempo === 'PRÓXIMO' || v.lubrication.estado_km === 'PRÓXIMO')) {
      isAlert = true;
      reasons.push({ type: 'LUB', text: 'Lubricación Próxima a vencer', status: 'yellow' });
    }
    
    // Check MPP
    if (v.mpp && v.mpp.estado_tiempo === 'PASADO') {
      passedMpp++;
      isAlert = true;
      reasons.push({ type: 'MPP', text: `Inspección MPP Vencida (${v.mpp.tiempo_mpp}/90 días)`, status: 'red' });
    } else if (v.mpp && v.mpp.estado_tiempo === 'PRÓXIMO') {
      isAlert = true;
      reasons.push({ type: 'MPP', text: 'Inspección MPP Próxima a vencer', status: 'yellow' });
    }
    
    // Check Docs (SOAT/RTM)
    let docExpired = false;
    if (v.soat && v.soat < todayStr) {
      docExpired = true;
      reasons.push({ type: 'DOC', text: `SOAT Vencido (${v.soat})`, status: 'red' });
    }
    if (v.rtm && v.rtm < todayStr) {
      docExpired = true;
      reasons.push({ type: 'DOC', text: `RTM Vencida (${v.rtm})`, status: 'red' });
    }
    if (docExpired) expiredDocs++;
    
    if (isAlert || docExpired) {
      reasons.forEach(r => {
        alertsList.push({
          movil: v.movil,
          placa: v.placa || 'SIN PLACA',
          linea: v.linea || 'Línea Desconocida',
          type: r.type,
          text: r.text,
          status: r.status
        });
      });
    }
  });
  
  // Set KPI values
  document.getElementById('val-total-vehicles').textContent = total;
  document.getElementById('val-alerts-lub').textContent = passedLub;
  document.getElementById('val-alerts-mpp').textContent = passedMpp;
  document.getElementById('val-expired-docs').textContent = expiredDocs;
  
  // Update Alert Badge and List
  const alertBadge = document.getElementById('badge-alert-count');
  alertBadge.textContent = `${alertsList.length} Alertas`;
  alertBadge.className = alertsList.length > 0 ? 'badge badge-pasado' : 'badge badge-vigente';
  
  const alertListContainer = document.getElementById('dashboard-alert-list');
  if (alertsList.length === 0) {
    alertListContainer.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-circle-check" style="color: var(--status-vigente); font-size: 2.5rem;"></i>
        <p>No hay alertas críticas. Toda la flota está al día.</p>
      </div>
    `;
  } else {
    // Sort alerts by severity (red dot first)
    alertsList.sort((a, b) => (a.status === 'red' ? -1 : 1));
    
    alertListContainer.innerHTML = alertsList.map(alert => `
      <div class="alert-item">
        <div class="alert-status-dot ${alert.status}"></div>
        <div class="alert-body">
          <div class="alert-title">Móvil ${alert.movil} (${alert.placa})</div>
          <div class="alert-desc">${alert.text}</div>
        </div>
        <button class="alert-action" onclick="viewVehicleDetail('${alert.movil}')">Atender</button>
      </div>
    `).join('');
  }
  
  // Render Distribution Donut Chart (SVG)
  const healthyCount = total - (passedLub + passedMpp);
  const healthyPercent = total > 0 ? Math.round((healthyCount / total) * 100) : 0;
  
  document.getElementById('chart-percent-text').textContent = `${healthyPercent}%`;
  
  // Calculate stroke dasharray for the donut chart segments
  // Radius is 70, Circumference is 2 * Math.PI * 70 = 439.82
  const circ = 439.82;
  const passedPct = total > 0 ? ((passedLub + passedMpp) / total) : 0;
  const healthyPct = 1 - passedPct;
  
  const segmentVigente = document.getElementById('chart-segment-vigente');
  const segmentPasado = document.getElementById('chart-segment-pasado');
  
  segmentVigente.style.strokeDasharray = `${healthyPct * circ} ${circ}`;
  segmentPasado.style.strokeDasharray = `${passedPct * circ} ${circ}`;
  // Offset pasado segment to start where vigente ends
  segmentPasado.style.strokeDashoffset = `-${healthyPct * circ}`;
  
  document.getElementById('legend-vigente-text').textContent = `Al Día (${healthyCount})`;
  document.getElementById('legend-pasado-text').textContent = `Vencidos (${passedLub + passedMpp})`;
}

// ----------------------------------------------------
// UI RENDERING - VEHICLES DIRECTORY
// ----------------------------------------------------
function renderVehiclesTable() {
  const tableBody = document.getElementById('vehicles-table-body');
  
  // Filter vehicles
  filteredVehicles = fleetData.vehicles.filter(v => {
    // Search input
    const query = searchQueries.vehicles.toLowerCase().trim();
    const matchesQuery = !query || 
      v.movil.toLowerCase().includes(query) ||
      (v.placa && v.placa.toLowerCase().includes(query)) ||
      (v.linea && v.linea.toLowerCase().includes(query)) ||
      (v.poblacion && v.poblacion.toLowerCase().includes(query));
      
    // Population filter
    const matchesPob = !activeFilters.poblacion || v.poblacion === activeFilters.poblacion;
    
    // Lub status filter
    let matchesLub = true;
    if (activeFilters.statusLub === 'VIGENTE') {
      matchesLub = v.lubrication && v.lubrication.estado_tiempo === 'VIGENTE' && v.lubrication.estado_km === 'VIGENTE';
    } else if (activeFilters.statusLub === 'PASADO') {
      matchesLub = v.lubrication && (v.lubrication.estado_tiempo === 'PASADO' || v.lubrication.estado_km === 'PASADO');
    } else if (activeFilters.statusLub === 'SIN_DATOS') {
      matchesLub = !v.lubrication || !v.lubrication.f_ultima_lub;
    }
    
    // MPP status filter
    let matchesMpp = true;
    if (activeFilters.statusMpp === 'VIGENTE') {
      matchesMpp = v.mpp && v.mpp.estado_tiempo === 'VIGENTE';
    } else if (activeFilters.statusMpp === 'PASADO') {
      matchesMpp = v.mpp && v.mpp.estado_tiempo === 'PASADO';
    } else if (activeFilters.statusMpp === 'SIN_DATOS') {
      matchesMpp = !v.mpp || !v.mpp.f_ultima_inspeccion;
    }
    
    return matchesQuery && matchesPob && matchesLub && matchesMpp;
  });
  
  // Pagination details
  const totalItems = filteredVehicles.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / ITEMS_PER_PAGE.vehicles));
  
  if (activePages.vehicles > totalPages) {
    activePages.vehicles = totalPages;
  }
  
  const startIndex = (activePages.vehicles - 1) * ITEMS_PER_PAGE.vehicles;
  const endIndex = Math.min(startIndex + ITEMS_PER_PAGE.vehicles, totalItems);
  
  document.getElementById('vehicles-page-info').textContent = totalItems > 0 
    ? `Mostrando ${startIndex + 1}-${endIndex} de ${totalItems} vehículos`
    : 'No se encontraron vehículos';
    
  // Render pagination buttons
  renderPagination('vehicles-pagination', activePages.vehicles, totalPages, (page) => {
    activePages.vehicles = page;
    renderVehiclesTable();
  });
  
  // Render table rows
  if (totalItems === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="8" class="text-center" style="padding: 40px; text-align: center; color: var(--text-secondary);">
          <i class="fa-solid fa-circle-info" style="font-size: 2rem; margin-bottom: 10px; display: block;"></i>
          No se encontraron vehículos con los filtros aplicados.
        </td>
      </tr>
    `;
    return;
  }
  
  const pageItems = filteredVehicles.slice(startIndex, endIndex);
  tableBody.innerHTML = pageItems.map(v => {
    // Determine Lub badge
    let lubBadge = '<span class="badge badge-n-a">Sin Datos</span>';
    let lubDate = '-';
    if (v.lubrication && v.lubrication.f_ultima_lub) {
      lubDate = v.lubrication.f_ultima_lub;
      const isPasado = v.lubrication.estado_tiempo === 'PASADO' || v.lubrication.estado_km === 'PASADO';
      const isProximo = v.lubrication.estado_tiempo === 'PRÓXIMO' || v.lubrication.estado_km === 'PRÓXIMO';
      
      if (isPasado) lubBadge = `<span class="badge badge-pasado">Vencido</span>`;
      else if (isProximo) lubBadge = `<span class="badge badge-proximo">Próximo</span>`;
      else lubBadge = `<span class="badge badge-vigente">Vigente</span>`;
    }
    
    // Determine MPP badge
    let mppBadge = '<span class="badge badge-n-a">Sin Datos</span>';
    let mppDate = '-';
    if (v.mpp && v.mpp.f_ultima_inspeccion) {
      mppDate = v.mpp.f_ultima_inspeccion;
      if (v.mpp.estado_tiempo === 'PASADO') mppBadge = `<span class="badge badge-pasado">Vencido</span>`;
      else if (v.mpp.estado_tiempo === 'PRÓXIMO') mppBadge = `<span class="badge badge-proximo">Próximo</span>`;
      else mppBadge = `<span class="badge badge-vigente">Vigente</span>`;
    }
    
    return `
      <tr onclick="viewVehicleDetail('${v.movil}')">
        <td style="font-weight: 700; color: #fff;">${v.movil}</td>
        <td>${v.placa || '-'}</td>
        <td>${v.linea || '-'}</td>
        <td>${v.poblacion || '-'}</td>
        <td>${lubDate}</td>
        <td>${lubBadge}</td>
        <td>${mppDate}</td>
        <td>${mppBadge}</td>
      </tr>
    `;
  }).join('');
}

// ----------------------------------------------------
// UI RENDERING - MAINTENANCE SCHEDULING (LUB / MPP)
// ----------------------------------------------------
function renderScheduleTable() {
  const tableHeaders = document.getElementById('schedule-table-headers');
  const tableBody = document.getElementById('schedule-table-body');
  
  // Set correct table headers depending on LUB or MPP mode
  if (scheduleMode === 'lub') {
    tableHeaders.innerHTML = `
      <th>Móvil</th>
      <th>Línea</th>
      <th>F. Última LUB</th>
      <th>Días Aceite</th>
      <th>Diferencia Días</th>
      <th>KMs Aceite</th>
      <th>Diferencia KMs</th>
      <th>LUB Estado</th>
      <th style="text-align: right;">Acciones</th>
    `;
  } else {
    tableHeaders.innerHTML = `
      <th>Móvil</th>
      <th>Línea</th>
      <th>Población</th>
      <th>F. Último MPP</th>
      <th>Días Transcurridos</th>
      <th>Estado Tiempo</th>
      <th style="text-align: right;">Acciones</th>
    `;
  }
  
  // Filter list to items needing attention or generally status tracking
  filteredSchedule = fleetData.vehicles.filter(v => {
    if (scheduleMode === 'lub') {
      // Must have lubrication data
      return v.lubrication && v.lubrication.f_ultima_lub;
    } else {
      // Must have MPP data
      return v.mpp && v.mpp.f_ultima_inspeccion;
    }
  });
  
  // Sort by priority (vencidos first, i.e., lower remaining days/KMs)
  filteredSchedule.sort((a, b) => {
    if (scheduleMode === 'lub') {
      const aVal = Math.min(a.lubrication.prioridad_tiempo, a.lubrication.prioridad_km);
      const bVal = Math.min(b.lubrication.prioridad_tiempo, b.lubrication.prioridad_km);
      return aVal - bVal;
    } else {
      return (a.mpp.prioridad_tiempo || (90 - a.mpp.tiempo_mpp)) - (b.mpp.prioridad_tiempo || (90 - b.mpp.tiempo_mpp));
    }
  });
  
  const totalItems = filteredSchedule.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / ITEMS_PER_PAGE.schedule));
  
  if (activePages.schedule > totalPages) {
    activePages.schedule = totalPages;
  }
  
  const startIndex = (activePages.schedule - 1) * ITEMS_PER_PAGE.schedule;
  const endIndex = Math.min(startIndex + ITEMS_PER_PAGE.schedule, totalItems);
  
  document.getElementById('schedule-page-info').textContent = totalItems > 0 
    ? `Mostrando ${startIndex + 1}-${endIndex} de ${totalItems} programados`
    : 'No hay vehículos programados en esta sección';
    
  renderPagination('schedule-pagination', activePages.schedule, totalPages, (page) => {
    activePages.schedule = page;
    renderScheduleTable();
  });
  
  if (totalItems === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="9" class="text-center" style="padding: 40px; text-align: center; color: var(--text-secondary);">
          No hay registros para mostrar.
        </td>
      </tr>
    `;
    return;
  }
  
  const pageItems = filteredSchedule.slice(startIndex, endIndex);
  
  if (scheduleMode === 'lub') {
    tableBody.innerHTML = pageItems.map(v => {
      const l = v.lubrication;
      const isPasado = l.estado_tiempo === 'PASADO' || l.estado_km === 'PASADO';
      const isProximo = l.estado_tiempo === 'PRÓXIMO' || l.estado_km === 'PRÓXIMO';
      
      let badge = `<span class="badge badge-vigente">Vigente</span>`;
      if (isPasado) badge = `<span class="badge badge-pasado">Pasado</span>`;
      else if (isProximo) badge = `<span class="badge badge-proximo">Próximo</span>`;
      
      return `
        <tr>
          <td style="font-weight: 700; color: #fff;" onclick="viewVehicleDetail('${v.movil}')">${v.movil}</td>
          <td onclick="viewVehicleDetail('${v.movil}')">${v.linea || '-'}</td>
          <td onclick="viewVehicleDetail('${v.movil}')">${l.f_ultima_lub}</td>
          <td onclick="viewVehicleDetail('${v.movil}')">${l.tiempo_aceite} d</td>
          <td onclick="viewVehicleDetail('${v.movil}')" class="${l.prioridad_tiempo <= 0 ? 'text-red' : ''}">${l.prioridad_tiempo} d</td>
          <td onclick="viewVehicleDetail('${v.movil}')">${l.km_aceite} km</td>
          <td onclick="viewVehicleDetail('${v.movil}')" class="${l.prioridad_km <= 0 ? 'text-red' : ''}">${l.prioridad_km} km</td>
          <td onclick="viewVehicleDetail('${v.movil}')">${badge}</td>
          <td style="text-align: right;">
            <button class="btn btn-secondary" style="padding: 6px 12px; font-size: 0.8rem;" onclick="openMaintUpdateModal('${v.movil}', 'lub')">
              <i class="fa-solid fa-check"></i> Registrar LUB
            </button>
          </td>
        </tr>
      `;
    }).join('');
  } else {
    tableBody.innerHTML = pageItems.map(v => {
      const m = v.mpp;
      let badge = `<span class="badge badge-vigente">Vigente</span>`;
      if (m.estado_tiempo === 'PASADO') badge = `<span class="badge badge-pasado">Pasado</span>`;
      else if (m.estado_tiempo === 'PRÓXIMO') badge = `<span class="badge badge-proximo">Próximo</span>`;
      
      return `
        <tr>
          <td style="font-weight: 700; color: #fff;" onclick="viewVehicleDetail('${v.movil}')">${v.movil}</td>
          <td onclick="viewVehicleDetail('${v.movil}')">${v.linea || '-'}</td>
          <td onclick="viewVehicleDetail('${v.movil}')">${v.poblacion || '-'}</td>
          <td onclick="viewVehicleDetail('${v.movil}')">${m.f_ultima_inspeccion}</td>
          <td onclick="viewVehicleDetail('${v.movil}')">${m.tiempo_mpp} días</td>
          <td onclick="viewVehicleDetail('${v.movil}')">${badge}</td>
          <td style="text-align: right;">
            <button class="btn btn-secondary" style="padding: 6px 12px; font-size: 0.8rem;" onclick="openMaintUpdateModal('${v.movil}', 'mpp')">
              <i class="fa-solid fa-check"></i> Registrar MPP
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }
}

// ----------------------------------------------------
// UI RENDERING - PREDICTIVE ANALYSIS
// ----------------------------------------------------
function renderPredictiveTable() {
  const tableBody = document.getElementById('predictive-table-body');
  
  // Gather all predictive items linked with vehicles
  const allPredictive = [];
  fleetData.vehicles.forEach(v => {
    (v.predictive_analysis || []).forEach(p => {
      allPredictive.push({
        movil: v.movil,
        ...p
      });
    });
  });
  
  // Apply search query & state filters
  filteredPredictive = allPredictive.filter(p => {
    const query = searchQueries.predictive.toLowerCase().trim();
    const matchesQuery = !query ||
      p.movil.toLowerCase().includes(query) ||
      p.hallazgos.toLowerCase().includes(query) ||
      (p.correcciones && p.correcciones.toLowerCase().includes(query)) ||
      (p.tipo && p.tipo.toLowerCase().includes(query));
      
    const matchesFilter = !activeFilters.predictiveStatus || p.estado === activeFilters.predictiveStatus;
    
    return matchesQuery && matchesFilter;
  });
  
  // Sort by date (newest first)
  filteredPredictive.sort((a, b) => new Date(b.fecha_analisis) - new Date(a.fecha_analisis));
  
  const totalItems = filteredPredictive.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / ITEMS_PER_PAGE.predictive));
  
  if (activePages.predictive > totalPages) {
    activePages.predictive = totalPages;
  }
  
  const startIndex = (activePages.predictive - 1) * ITEMS_PER_PAGE.predictive;
  const endIndex = Math.min(startIndex + ITEMS_PER_PAGE.predictive, totalItems);
  
  document.getElementById('predictive-page-info').textContent = totalItems > 0 
    ? `Mostrando ${startIndex + 1}-${endIndex} de ${totalItems} registros`
    : 'No se encontraron registros de análisis predictivo';
    
  renderPagination('predictive-pagination', activePages.predictive, totalPages, (page) => {
    activePages.predictive = page;
    renderPredictiveTable();
  });
  
  if (totalItems === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="7" class="text-center" style="padding: 40px; text-align: center; color: var(--text-secondary);">
          No se encontraron análisis predictivos.
        </td>
      </tr>
    `;
    return;
  }
  
  const pageItems = filteredPredictive.slice(startIndex, endIndex);
  tableBody.innerHTML = pageItems.map(p => {
    let stateClass = 'badge-n-a';
    if (p.estado === 'CRÍTICO') stateClass = 'badge-pasado';
    else if (p.estado === 'EN OBSERVACIÓN') stateClass = 'badge-proximo';
    else if (p.estado === 'NORMAL') stateClass = 'badge-vigente';
    
    return `
      <tr onclick="viewVehicleDetail('${p.movil}')">
        <td style="font-weight: 700; color: #fff;">${p.movil}</td>
        <td>${p.fecha_analisis}</td>
        <td>${p.fecha_km_muestra || '-'}</td>
        <td>${p.tipo || '-'}</td>
        <td style="max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${p.hallazgos}">${p.hallazgos}</td>
        <td style="max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${p.correcciones || ''}">${p.correcciones || '-'}</td>
        <td><span class="badge ${stateClass}">${p.estado}</span></td>
      </tr>
    `;
  }).join('');
}

// ----------------------------------------------------
// UI RENDERING - VEHICLE DETAIL PROFILE (MODAL)
// ----------------------------------------------------
function viewVehicleDetail(movil) {
  const vehicle = fleetData.vehicles.find(v => v.movil === movil);
  if (!vehicle) {
    showToast('Vehículo no encontrado', 'error');
    return;
  }
  
  currentVehicleDetailId = movil;
  
  // Set Technical Ficha details
  document.getElementById('detail-vehicle-title').textContent = `Móvil ${vehicle.movil} - Ficha Técnica`;
  document.getElementById('detail-placa').textContent = vehicle.placa || 'SIN REGISTRO';
  document.getElementById('detail-linea').textContent = vehicle.linea || 'SIN REGISTRO';
  document.getElementById('detail-poblacion').textContent = vehicle.poblacion || 'SIN REGISTRO';
  
  const todayStr = getTodayString();
  
  // SOAT display with color formatting
  const detailSoat = document.getElementById('detail-soat');
  if (vehicle.soat) {
    detailSoat.textContent = vehicle.soat;
    detailSoat.style.color = vehicle.soat < todayStr ? 'var(--status-pasado)' : '#fff';
  } else {
    detailSoat.textContent = 'SIN REGISTRO';
    detailSoat.style.color = 'var(--text-muted)';
  }
  
  // RTM display with color formatting
  const detailRtm = document.getElementById('detail-rtm');
  if (vehicle.rtm) {
    detailRtm.textContent = vehicle.rtm;
    detailRtm.style.color = vehicle.rtm < todayStr ? 'var(--status-pasado)' : '#fff';
  } else {
    detailRtm.textContent = 'SIN REGISTRO';
    detailRtm.style.color = 'var(--text-muted)';
  }
  
  // 1. Tab 1: Maint Status Details
  // Lubrication details
  const dl = vehicle.lubrication;
  const btnLub = document.getElementById('btn-action-lubricate');
  btnLub.setAttribute('onclick', `openMaintUpdateModal('${vehicle.movil}', 'lub')`);
  
  if (dl && dl.f_ultima_lub) {
    document.getElementById('detail-last-lub').textContent = dl.f_ultima_lub;
    document.getElementById('detail-km-lub').textContent = `${dl.km_aceite} km (${dl.tiempo_aceite} días)`;
    document.getElementById('detail-freq-km-lub').textContent = `${dl.frecuencia_km} km`;
    document.getElementById('detail-freq-days-lub').textContent = `${dl.frecuencia_dias} días`;
    
    const isPasado = dl.estado_tiempo === 'PASADO' || dl.estado_km === 'PASADO';
    const isProximo = dl.estado_tiempo === 'PRÓXIMO' || dl.estado_km === 'PRÓXIMO';
    
    const badgeLub = document.getElementById('detail-badge-lub');
    if (isPasado) {
      badgeLub.textContent = 'Vencido';
      badgeLub.className = 'badge badge-pasado';
    } else if (isProximo) {
      badgeLub.textContent = 'Próximo';
      badgeLub.className = 'badge badge-proximo';
    } else {
      badgeLub.textContent = 'Al día';
      badgeLub.className = 'badge badge-vigente';
    }
  } else {
    document.getElementById('detail-last-lub').textContent = 'Sin Datos';
    document.getElementById('detail-km-lub').textContent = '-';
    document.getElementById('detail-freq-km-lub').textContent = '-';
    document.getElementById('detail-freq-days-lub').textContent = '-';
    
    const badgeLub = document.getElementById('detail-badge-lub');
    badgeLub.textContent = 'Sin Datos';
    badgeLub.className = 'badge badge-n-a';
  }
  
  // MPP details
  const dm = vehicle.mpp;
  const btnMpp = document.getElementById('btn-action-inspect');
  btnMpp.setAttribute('onclick', `openMaintUpdateModal('${vehicle.movil}', 'mpp')`);
  
  if (dm && dm.f_ultima_inspeccion) {
    document.getElementById('detail-last-mpp').textContent = dm.f_ultima_inspeccion;
    document.getElementById('detail-time-mpp').textContent = `${dm.tiempo_mpp} días transcurridos`;
    document.getElementById('detail-km-mpp').textContent = dm.km_u_inspeccion ? `${dm.km_u_inspeccion} km` : 'Sin Registro';
    
    const badgeMpp = document.getElementById('detail-badge-mpp');
    if (dm.estado_tiempo === 'PASADO') {
      badgeMpp.textContent = 'Vencido';
      badgeMpp.className = 'badge badge-pasado';
    } else if (dm.estado_tiempo === 'PRÓXIMO') {
      badgeMpp.textContent = 'Próximo';
      badgeMpp.className = 'badge badge-proximo';
    } else {
      badgeMpp.textContent = 'Al día';
      badgeMpp.className = 'badge badge-vigente';
    }
  } else {
    document.getElementById('detail-last-mpp').textContent = 'Sin Datos';
    document.getElementById('detail-time-mpp').textContent = '-';
    document.getElementById('detail-km-mpp').textContent = '-';
    
    const badgeMpp = document.getElementById('detail-badge-mpp');
    badgeMpp.textContent = 'Sin Datos';
    badgeMpp.className = 'badge badge-n-a';
  }
  
  // 2. Tab 2: Predictive History list
  renderDetailPredictiveList(vehicle);
  
  // 3. Tab 3: Wash ratings list
  renderDetailWashList(vehicle);
  
  // Reset active modal subtabs to tab 1
  setModalActiveTab('tab-maint-status');
  
  openModal('modal-vehicle-detail');
}

function renderDetailPredictiveList(vehicle) {
  const container = document.getElementById('detail-predictive-list');
  const items = vehicle.predictive_analysis || [];
  
  if (items.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding: 20px;">
        <i class="fa-solid fa-folder-open"></i>
        <p>No hay reportes de análisis predictivo para este vehículo.</p>
      </div>
    `;
    return;
  }
  
  // Sort by date descending
  const sorted = [...items].sort((a, b) => new Date(b.fecha_analisis) - new Date(a.fecha_analisis));
  
  container.innerHTML = sorted.map(p => {
    let stateBadgeClass = 'badge-n-a';
    if (p.estado === 'CRÍTICO') stateBadgeClass = 'badge-pasado';
    else if (p.estado === 'EN OBSERVACIÓN') stateBadgeClass = 'badge-proximo';
    else if (p.estado === 'NORMAL') stateBadgeClass = 'badge-vigente';
    
    return `
      <div class="history-card">
        <div class="history-header">
          <span class="history-date">${p.fecha_analisis}</span>
          <span class="badge ${stateBadgeClass}">${p.estado}</span>
        </div>
        <div class="history-content">
          <strong>Fecha/KM Muestra:</strong> ${p.fecha_km_muestra || '-'}<br>
          <strong>Tipo:</strong> ${p.tipo || '-'}<br>
          <strong>Hallazgos:</strong> ${p.hallazgos}<br>
          <strong>Correcciones:</strong> ${p.correcciones || 'N/A'}
        </div>
      </div>
    `;
  }).join('');
}

function renderDetailWashList(vehicle) {
  const container = document.getElementById('detail-wash-list');
  const items = vehicle.form_responses || [];
  
  if (items.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding: 20px;">
        <i class="fa-solid fa-soap"></i>
        <p>No hay registros de lavado para este vehículo.</p>
      </div>
    `;
    return;
  }
  
  // Sort descending
  const sorted = [...items].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  
  container.innerHTML = sorted.map(w => `
    <div class="history-card">
      <div class="history-header">
        <span class="history-date">${w.timestamp || 'Fecha desconocida'}</span>
        <span class="badge badge-vigente">${w.wash_type || 'Lavado'}</span>
      </div>
      <div class="history-content">
        <strong>Evaluación de Suciedad:</strong> ${w.dirty_rating || '-'}<br>
        <strong>Participaron:</strong> ${w.participants || '1'} persona(s)<br>
        <strong>Calificación Servicio:</strong> ${w.external_service_rating || '5'}/5<br>
        <strong>Observaciones:</strong> ${w.observation || 'Ninguna'}
      </div>
    </div>
  `).join('');
}

// Set active tab in detail modal
function setModalActiveTab(tabId) {
  const tabButtons = document.querySelectorAll('.modal-tab-btn');
  const tabContents = document.querySelectorAll('.modal-body .tab-content');
  
  tabButtons.forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
  });
  
  tabContents.forEach(content => {
    content.classList.toggle('active', content.id === tabId);
  });
}

// ----------------------------------------------------
// UI HELPERS (PAGINATION, MODALS, TOASTS)
// ----------------------------------------------------
function renderPagination(containerId, currentPage, totalPages, onPageChange) {
  const container = document.getElementById(containerId);
  if (!container) return;
  
  let buttons = [];
  
  // Prev button
  buttons.push(`
    <button class="btn-page" ${currentPage === 1 ? 'disabled' : ''} data-page="${currentPage - 1}">
      <i class="fa-solid fa-chevron-left"></i>
    </button>
  `);
  
  // Page number buttons
  const startPage = Math.max(1, currentPage - 2);
  const endPage = Math.min(totalPages, startPage + 4);
  
  for (let i = startPage; i <= endPage; i++) {
    buttons.push(`
      <button class="btn-page ${i === currentPage ? 'active' : ''}" data-page="${i}">
        ${i}
      </button>
    `);
  }
  
  // Next button
  buttons.push(`
    <button class="btn-page" ${currentPage === totalPages ? 'disabled' : ''} data-page="${currentPage + 1}">
      <i class="fa-solid fa-chevron-right"></i>
    </button>
  `);
  
  container.innerHTML = buttons.join('');
  
  // Add listeners
  container.querySelectorAll('.btn-page').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const page = parseInt(btn.getAttribute('data-page'));
      if (page >= 1 && page <= totalPages && page !== currentPage) {
        onPageChange(page);
      }
    });
  });
}

function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add('active');
  }
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('active');
  }
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  let icon = 'fa-info-circle';
  if (type === 'success') icon = 'fa-check-circle';
  if (type === 'error') icon = 'fa-times-circle';
  
  toast.innerHTML = `
    <i class="fa-solid ${icon}"></i>
    <span>${message}</span>
    <button class="toast-close"><i class="fa-solid fa-xmark"></i></button>
  `;
  
  container.appendChild(toast);
  
  // Handle close click
  toast.querySelector('.toast-close').addEventListener('click', () => {
    toast.remove();
  });
  
  // Auto remove after 4 seconds
  setTimeout(() => {
    if (toast.parentNode) {
      toast.remove();
    }
  }, 4000);
}

// ----------------------------------------------------
// FORM SUBMISSIONS & ACTIONS
// ----------------------------------------------------
function setupEventListeners() {
  // Navigation Tabs switching
  const navItems = document.querySelectorAll('.sidebar .nav-item');
  const sections = document.querySelectorAll('.main-content .view-section');
  
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      navItems.forEach(n => n.classList.remove('active'));
      sections.forEach(s => s.classList.remove('active'));
      
      item.classList.add('active');
      const targetView = item.getAttribute('data-view');
      document.getElementById(targetView).classList.add('active');
      
      currentTab = targetView;
    });
  });
  
  // Modal tabs click delegation
  document.querySelector('.modal-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.modal-tab-btn');
    if (btn) {
      const tabId = btn.getAttribute('data-tab');
      setModalActiveTab(tabId);
    }
  });
  
  // Reload data button
  document.getElementById('btn-reload-data').addEventListener('click', () => {
    localStorage.removeItem('fleet_db');
    initApp();
  });
  
  // Search & Filters inputs - Vehicles
  document.getElementById('search-vehicle-input').addEventListener('input', (e) => {
    searchQueries.vehicles = e.target.value;
    activePages.vehicles = 1;
    renderVehiclesTable();
  });
  
  document.getElementById('filter-poblacion').addEventListener('change', (e) => {
    activeFilters.poblacion = e.target.value;
    activePages.vehicles = 1;
    renderVehiclesTable();
  });
  
  document.getElementById('filter-status-lub').addEventListener('change', (e) => {
    activeFilters.statusLub = e.target.value;
    activePages.vehicles = 1;
    renderVehiclesTable();
  });
  
  document.getElementById('filter-status-mpp').addEventListener('change', (e) => {
    activeFilters.statusMpp = e.target.value;
    activePages.vehicles = 1;
    renderVehiclesTable();
  });
  
  // Search & Filters inputs - Predictive
  document.getElementById('search-predictive-input').addEventListener('input', (e) => {
    searchQueries.predictive = e.target.value;
    activePages.predictive = 1;
    renderPredictiveTable();
  });
  
  document.getElementById('filter-predictive-status').addEventListener('change', (e) => {
    activeFilters.predictiveStatus = e.target.value;
    activePages.predictive = 1;
    renderPredictiveTable();
  });
  
  // LUB / MPP sub tabs in maintenance panel
  document.getElementById('sub-tab-lub').addEventListener('click', (e) => {
    document.getElementById('sub-tab-lub').classList.add('active');
    document.getElementById('sub-tab-mpp').classList.remove('active');
    scheduleMode = 'lub';
    activePages.schedule = 1;
    renderScheduleTable();
  });
  
  document.getElementById('sub-tab-mpp').addEventListener('click', (e) => {
    document.getElementById('sub-tab-mpp').classList.add('active');
    document.getElementById('sub-tab-lub').classList.remove('active');
    scheduleMode = 'mpp';
    activePages.schedule = 1;
    renderScheduleTable();
  });
  
  // Export button trigger
  document.getElementById('btn-export-excel').addEventListener('click', exportToExcel);
  
  // Add new vehicle trigger
  document.getElementById('btn-add-vehicle').addEventListener('click', () => {
    document.getElementById('form-vehicle').reset();
    document.getElementById('vehicle-form-title').textContent = 'Agregar Nuevo Móvil';
    document.getElementById('input-movil').disabled = false;
    openModal('modal-vehicle-form');
  });
  
  // Add vehicle form submit
  document.getElementById('form-vehicle').addEventListener('submit', (e) => {
    e.preventDefault();
    
    const movil = document.getElementById('input-movil').value.trim();
    const placa = document.getElementById('input-placa').value.trim().toUpperCase();
    const linea = document.getElementById('input-linea').value.trim().toUpperCase();
    const poblacion = document.getElementById('input-poblacion').value.trim();
    const soat = document.getElementById('input-soat').value;
    const rtm = document.getElementById('input-rtm').value;
    
    // Check if vehicle exists
    const existingIndex = fleetData.vehicles.findIndex(v => v.movil === movil);
    
    if (existingIndex > -1) {
      showToast('El número de móvil ya existe en la base de datos.', 'error');
      return;
    }
    
    const newVehicle = {
      movil,
      placa,
      linea,
      poblacion,
      soat,
      rtm,
      lubrication: {},
      mpp: {},
      predictive_analysis: [],
      form_responses: []
    };
    
    fleetData.vehicles.push(newVehicle);
    saveToLocalStorage();
    recalculateAllStatuses();
    populateFilters();
    
    // Rerender tables
    renderDashboard();
    renderVehiclesTable();
    
    closeModal('modal-vehicle-form');
    showToast(`Vehículo móvil ${movil} creado con éxito.`, 'success');
  });
  
  // Add Predictive Log submission (Mini-Form in modal)
  document.getElementById('form-mini-predictive').addEventListener('submit', (e) => {
    e.preventDefault();
    
    const vehicle = fleetData.vehicles.find(v => v.movil === currentVehicleDetailId);
    if (!vehicle) return;
    
    const pDate = document.getElementById('mini-pred-fecha').value;
    const pMuestra = document.getElementById('mini-pred-fecha-km').value;
    const pTipo = document.getElementById('mini-pred-tipo').value.trim().toUpperCase();
    const pEstado = document.getElementById('mini-pred-estado').value;
    const pHallazgos = document.getElementById('mini-pred-hallazgos').value.trim();
    const pCorr = document.getElementById('mini-pred-correcciones').value.trim();
    
    const report = {
      tipo: pTipo,
      clase: '',
      fecha_analisis: pDate,
      fecha_km_muestra: pMuestra,
      hallazgos: pHallazgos,
      correcciones: pCorr,
      estado: pEstado
    };
    
    if (!vehicle.predictive_analysis) vehicle.predictive_analysis = [];
    vehicle.predictive_analysis.push(report);
    
    saveToLocalStorage();
    showToast('Reporte de análisis predictivo guardado.', 'success');
    
    // Update view
    renderDetailPredictiveList(vehicle);
    renderPredictiveTable();
    
    document.getElementById('form-mini-predictive').reset();
    
    // Close collapsible details
    document.querySelector('#tab-predictive-hist details').open = false;
  });
  
  // Add Wash Rating submission (Mini-Form in modal)
  document.getElementById('form-mini-wash').addEventListener('submit', (e) => {
    e.preventDefault();
    
    const vehicle = fleetData.vehicles.find(v => v.movil === currentVehicleDetailId);
    if (!vehicle) return;
    
    const rating = {
      timestamp: getTodayString() + " 12:00:00",
      dirty_rating: document.getElementById('mini-wash-dirty').value,
      participants: document.getElementById('mini-wash-participants').value,
      external_service_rating: document.getElementById('mini-wash-service').value,
      wash_type: document.getElementById('mini-wash-type').value,
      observation: document.getElementById('mini-wash-obs').value.trim()
    };
    
    if (!vehicle.form_responses) vehicle.form_responses = [];
    vehicle.form_responses.push(rating);
    
    saveToLocalStorage();
    showToast('Evaluación de lavado registrada.', 'success');
    
    renderDetailWashList(vehicle);
    document.getElementById('form-mini-wash').reset();
    document.querySelector('#tab-wash-ratings details').open = false;
  });
  
  // Add Maintenance Update submit
  document.getElementById('form-update-maint').addEventListener('submit', (e) => {
    e.preventDefault();
    
    const movil = document.getElementById('update-maint-movil').value;
    const type = document.getElementById('update-maint-type').value;
    const serviceDate = document.getElementById('update-maint-date').value;
    const serviceKm = parseFloat(document.getElementById('update-maint-km').value) || 0;
    
    const vehicle = fleetData.vehicles.find(v => v.movil === movil);
    if (!vehicle) return;
    
    if (type === 'lub') {
      const freqKm = parseFloat(document.getElementById('update-maint-freq-km').value) || 5000;
      const freqDays = parseInt(document.getElementById('update-maint-freq-days').value) || 180;
      
      vehicle.lubrication = {
        descripcion: vehicle.lubrication.descripcion || 'LUBRICACION AUTOMATICA',
        f_ultima_lub: serviceDate,
        tiempo_aceite: 0,
        km_aceite: 0, // Reset oil age KM
        frecuencia_dias: freqDays,
        frecuencia_km: freqKm,
        prioridad_tiempo: freqDays,
        prioridad_km: freqKm,
        estado_tiempo: 'VIGENTE',
        estado_km: 'VIGENTE',
        tiempo_proximo: 0,
        km_proximo: 0
      };
      
      showToast(`Servicio de lubricación registrado para el móvil ${movil}.`, 'success');
    } else {
      vehicle.mpp = {
        descripcion: vehicle.mpp.descripcion || 'MPP PREVENTIVO',
        f_ultima_inspeccion: serviceDate,
        tiempo_mpp: 0,
        km_u_inspeccion: serviceKm,
        km_actual: serviceKm,
        km_del_mpp: serviceKm,
        estado_tiempo: 'VIGENTE',
        estado_km: 'VIGENTE'
      };
      
      showToast(`Inspección MPP registrada para el móvil ${movil}.`, 'success');
    }
    
    saveToLocalStorage();
    recalculateAllStatuses();
    
    // Refresh all views
    renderDashboard();
    renderVehiclesTable();
    renderScheduleTable();
    
    // If the detail modal is active, update its info too
    if (currentVehicleDetailId === movil) {
      viewVehicleDetail(movil);
    }
    
    closeModal('modal-update-maint');
  });
}

function openMaintUpdateModal(movil, type) {
  document.getElementById('update-maint-movil').value = movil;
  document.getElementById('update-maint-type').value = type;
  
  const todayStr = getTodayString();
  document.getElementById('update-maint-date').value = todayStr;
  
  const vehicle = fleetData.vehicles.find(v => v.movil === movil);
  
  if (type === 'lub') {
    document.getElementById('update-maint-title').textContent = `Móvil ${movil} - Registrar Lubricación`;
    document.getElementById('lbl-update-date').textContent = 'Fecha de Lubricación *';
    
    // Hide general inspection KM fields, show lubrication details
    document.getElementById('group-update-km').style.display = 'none';
    document.getElementById('group-update-freq-km').style.display = 'block';
    document.getElementById('group-update-freq-days').style.display = 'block';
    
    // Populate defaults
    if (vehicle && vehicle.lubrication) {
      document.getElementById('update-maint-freq-km').value = vehicle.lubrication.frecuencia_km || 5000;
      document.getElementById('update-maint-freq-days').value = vehicle.lubrication.frecuencia_dias || 180;
    } else {
      document.getElementById('update-maint-freq-km').value = 5000;
      document.getElementById('update-maint-freq-days').value = 180;
    }
  } else {
    document.getElementById('update-maint-title').textContent = `Móvil ${movil} - Registrar Inspección MPP`;
    document.getElementById('lbl-update-date').textContent = 'Fecha de Inspección *';
    
    // Show KM inputs
    document.getElementById('group-update-km').style.display = 'block';
    document.getElementById('group-update-freq-km').style.display = 'none';
    document.getElementById('group-update-freq-days').style.display = 'none';
    
    if (vehicle && vehicle.mpp) {
      document.getElementById('update-maint-km').value = vehicle.mpp.km_actual || '';
    } else {
      document.getElementById('update-maint-km').value = '';
    }
  }
  
  openModal('modal-update-maint');
}

// ----------------------------------------------------
// EXPORTING DATABASE TO MULTI-SHEET EXCEL
// ----------------------------------------------------
function exportToExcel() {
  if (fleetData.vehicles.length === 0) {
    showToast('No hay datos para exportar', 'error');
    return;
  }
  
  showToast('Generando libro de Excel...', 'info');
  
  const wb = XLSX.utils.book_new();
  
  // 1. Sheet: RECURSO ACTUAL
  const recursoData = fleetData.vehicles
    .filter(v => v.placa) // Only export vehicles that actually represent fleet units
    .map(v => ({
      "MOVIL": parseInt(v.movil) || v.movil,
      "POBLACIÓN": v.poblacion,
      "PLACA": v.placa,
      "LINEA": v.linea,
      "SOAT": v.soat ? new Date(v.soat) : "",
      "RTM": v.rtm ? new Date(v.rtm) : ""
    }));
  const wsRecurso = XLSX.utils.json_to_sheet(recursoData, { cellDates: true });
  XLSX.utils.book_append_sheet(wb, wsRecurso, "RECURSO ACTUAL");
  
  // 2. Sheet: BD LUB
  const lubData = fleetData.vehicles
    .filter(v => v.lubrication && v.lubrication.f_ultima_lub)
    .map(v => {
      const l = v.lubrication;
      return {
        "MÓVIL": parseInt(v.movil) || v.movil,
        "DESCRIPCIÓN": l.descripcion || "",
        "POBLACIÓN": v.poblacion,
        "F ULTIMA LUBRICACIÒN MOTOR": l.f_ultima_lub ? new Date(l.f_ultima_lub) : "",
        "TIEMPO DEL ACEITE": l.tiempo_aceite || 0,
        "KM DEL ACEITE": l.km_aceite || 0,
        "FRECUENCIA DIAS": l.frecuencia_dias || 180,
        "FRECUENCIA KM": l.frecuencia_km || 5000,
        "PRIORIDAD TIEMPO": l.prioridad_tiempo || 0,
        "PRIORIDAD KM": l.prioridad_km || 0,
        "ESTADO TIEMPO": l.estado_tiempo || "",
        "ESTADO KM": l.estado_km || "",
        "TIEMPO DE PRÓXIMO": l.tiempo_proximo || 0,
        "KM DE PRÓXIMO": l.km_proximo || 0
      };
    });
  const wsLub = XLSX.utils.json_to_sheet(lubData, { cellDates: true });
  XLSX.utils.book_append_sheet(wb, wsLub, "BD LUB");
  
  // 3. Sheet: BD MPP
  const mppData = fleetData.vehicles
    .filter(v => v.mpp && v.mpp.f_ultima_inspeccion)
    .map(v => {
      const m = v.mpp;
      return {
        "MOVIL": parseInt(v.movil) || v.movil,
        "DESCRIPCIÓN": m.descripcion || "",
        "F ULTIMA INSPECCION": m.f_ultima_inspeccion ? new Date(m.f_ultima_inspeccion) : "",
        "TIEMPO MPP": m.tiempo_mpp || 0,
        "KM U INSPECCIÓN": m.km_u_inspeccion || 0,
        "KM ACTUAL": m.km_actual || 0,
        "KM DEL MPP": m.km_del_mpp || 0,
        "ESTADO TIEMPO": m.estado_tiempo || "",
        "ESTADO KM": m.estado_km || "",
        "Placa": v.placa,
        "POBLACION": v.poblacion
      };
    });
  const wsMpp = XLSX.utils.json_to_sheet(mppData, { cellDates: true });
  XLSX.utils.book_append_sheet(wb, wsMpp, "BD MPP");
  
  // 4. Sheet: ANALISIS PREDICTIVO
  const predData = [];
  fleetData.vehicles.forEach(v => {
    (v.predictive_analysis || []).forEach(p => {
      predData.push({
        "MOVIL": parseInt(v.movil) || v.movil,
        "TIPO": p.tipo,
        "CLASE": p.clase,
        "FECHA ANALISIS": p.fecha_analisis ? new Date(p.fecha_analisis) : "",
        "FECHA Y KM MUESTRA": p.fecha_km_muestra,
        "HALLAZGOS ": p.hallazgos,
        "CORRECIONES": p.correcciones,
        "ESTADO": p.estado
      });
    });
  });
  const wsPred = XLSX.utils.json_to_sheet(predData, { cellDates: true });
  XLSX.utils.book_append_sheet(wb, wsPred, "ANALISIS PREDICTIVO");
  
  // 5. Sheet: Respuestas de formulario 1
  const formData = [];
  fleetData.vehicles.forEach(v => {
    (v.form_responses || []).forEach(f => {
      formData.push({
        "Marca temporal": f.timestamp,
        "MÓVIL ": parseInt(v.movil) || v.movil,
        "CALIFIQUE QUE TAN SUCIO ESTABA EL VEHÍCULO ANTES DEL LAVADO. \nDONDE 1 ES MUY LIMPIO Y 5 ES MUY SUCIO.": f.dirty_rating,
        "¿CUANTAS PERSONAS PARTICIPARON EN LA INTERVENCIÓN?": parseInt(f.participants) || 1,
        "Califique el servicio prestado en el lavadero externo (espacio único para satélite Rionegro)": parseInt(f.external_service_rating) || 5,
        "MARCA TEMPORAL": f.timestamp,
        "TIPO DE INTERVENCION": f.wash_type || "VEHÍCULO APROPIADO PARA LAVADO",
        "OBSERVACIONES": f.observation || ""
      });
    });
  });
  const wsForm = XLSX.utils.json_to_sheet(formData);
  XLSX.utils.book_append_sheet(wb, wsForm, "Respuestas de formulario 1");
  
  // Write Workbook file to system downloads folder
  try {
    XLSX.writeFile(wb, "Copia de MPP Y LUB MEDELLIN V2.0 (4) - ACTUALIZADO.xlsx");
    showToast('Archivo Excel descargado con éxito.', 'success');
  } catch (error) {
    console.error('Error writing Excel file:', error);
    showToast('Error al exportar archivo Excel.', 'error');
  }
}

// ----------------------------------------------------
// UTILITY FUNCTIONS
// ----------------------------------------------------
function getTodayString() {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}
