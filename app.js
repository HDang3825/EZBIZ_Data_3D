import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  loadLaptopModel,
  loadWarehouseModel,
  updateScreenTexture,
  handleMouseMove,
  handleMouseClick,
  getCameraZoomTargets,
  getOverviewTargets,
  getLaptopModel,
  getWarehouseModel,
  getScreenCenterWorld
} from './model-viewer.js';

// Các trạng thái của Camera
const STATE_OVERVIEW = 0;
const STATE_ZOOMING_IN = 1;
const STATE_ZOOMED_IN = 2;
const STATE_ZOOMING_OUT = 3;
const STATE_TRANSITIONING = 4;   // Bay qua màn hình để chuyển sang giai đoạn 2

// Các giai đoạn (Stages) của hệ thống
const STAGE_1_IMAC = 1;
const STAGE_2_WAREHOUSE = 2;

let systemState = STATE_OVERVIEW;
let currentStage = STAGE_1_IMAC;

// Biến hỗ trợ phân biệt Click và Drag (để xoay không bị thoát cảnh)
let clickStartX = 0;
let clickStartY = 0;
let isDragging = false;

// Các biến cốt lõi của Three.js
let scene, camera, renderer, controls;

// Các vector đích để phục vụ phép nội suy (di chuyển camera)
const targetCamPos = new THREE.Vector3();
const targetLookAt = new THREE.Vector3();
const overviewCamPos = new THREE.Vector3(0, 2.5, 13);
const overviewLookAt = new THREE.Vector3(0, 0, 0);

// Khởi tạo đồng hồ hệ thống
const clock = new THREE.Clock();

// Hàm ghi log vào cửa sổ terminal
function logToTerminal(message, type = '') {
  const terminal = document.getElementById('terminal-logs');
  if (!terminal) return;

  const time = new Date().toLocaleTimeString();
  const line = document.createElement('div');
  line.className = 'log-line';

  if (type === 'success') line.classList.add('text-success');
  else if (type === 'cyan') line.classList.add('text-cyan');
  else if (type === 'danger') line.classList.add('text-danger');
  else if (type === 'warning') line.classList.add('text-warning');

  line.textContent = `[${time}] ${message}`;
  terminal.appendChild(line);
  terminal.scrollTop = terminal.scrollHeight;
}

// Giả lập cập nhật thông số Telemetry
function updateTelemetry() {
  const cpuVal = document.getElementById('cpu-val');
  const cpuFill = document.getElementById('cpu-fill');
  const gpuVal = document.getElementById('gpu-val');
  const gpuFill = document.getElementById('gpu-fill');
  const latencyVal = document.getElementById('node-conn');

  // Các dao động nhỏ ngẫu nhiên
  const cpu = Math.floor(20 + Math.sin(clock.getElapsedTime()) * 5 + Math.random() * 8);
  const temp = Math.floor(55 + Math.cos(clock.getElapsedTime() * 0.8) * 3 + Math.random() * 4);
  const latency = (90 + Math.random() * 15).toFixed(1);

  if (cpuVal) cpuVal.textContent = `${cpu}%`;
  if (cpuFill) cpuFill.style.width = `${cpu}%`;
  if (gpuVal) gpuVal.textContent = `${temp}°C`;
  if (gpuFill) {
    gpuFill.style.width = `${temp}%`;
    if (temp > 62) {
      gpuFill.className = 'progress-fill danger';
    } else {
      gpuFill.className = 'progress-fill warning';
    }
  }
  if (latencyVal) latencyVal.textContent = `${latency} ms`;
}

// Cập nhật đồng hồ thời gian thực
function startClock() {
  setInterval(() => {
    const clockEl = document.getElementById('live-clock');
    if (clockEl) {
      const d = new Date();
      clockEl.textContent = d.toLocaleTimeString();
    }
  }, 1000);
}

// Thiết lập Scene, Ánh sáng, Hệ thống hạt (Space Dust)
function initThree() {
  const canvas = document.getElementById('webgl-canvas');
  const w = window.innerWidth;
  const h = window.innerHeight;

  // Khởi tạo không gian 3D
  scene = new THREE.Scene();

  // Khởi tạo Camera góc nhìn
  camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
  camera.position.copy(overviewCamPos);

  // Khởi tạo bộ dựng hình WebGLRenderer (hỗ trợ trong suốt - alpha: true)
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.65;

  // Khởi tạo bộ điều khiển OrbitControls (xoay camera)
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.maxPolarAngle = Math.PI / 2 - 0.05; // Giới hạn không cho camera đi dưới mặt đất
  controls.minDistance = 4;
  controls.maxDistance = 25;
  controls.target.copy(overviewLookAt);

  // Tạo môi trường phản xạ (Environment Map) giả lập studio để chất liệu kim loại của laptop phản chiếu ánh sáng trắng sáng tự nhiên
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  const roomEnv = new RoomEnvironment(renderer);
  // Traverse và làm dịu cường độ các tấm sáng trong RoomEnvironment để tránh phản xạ quá rực làm cháy sáng vỏ máy
  roomEnv.traverse((child) => {
    if (child.material && child.material.color) {
      child.material.color.multiplyScalar(0.25);
    }
  });

  const envTexture = pmremGenerator.fromScene(roomEnv, 0.04).texture;
  scene.environment = envTexture;
  pmremGenerator.dispose();
  roomEnv.dispose();

  // Ánh sáng môi trường dịu (nhường vai trò phản xạ và chiếu sáng chính cho Environment Map)
  const ambientLight = new THREE.AmbientLight('#ffffff', 0.25);
  scene.add(ambientLight);

  // Ánh sáng chính chiếu góc xéo ngang tầm mắt phía trước (giảm Y xuống 1.5 để hoàn toàn loại bỏ góc chiếu từ trên cao)
  const dirLight1 = new THREE.DirectionalLight('#ffffff', 0.15);
  dirLight1.position.set(2, 1.5, 8);
  dirLight1.castShadow = true;
  dirLight1.shadow.mapSize.width = 2048;
  dirLight1.shadow.mapSize.height = 2048;
  dirLight1.shadow.camera.near = 0.5;
  dirLight1.shadow.camera.far = 25;
  dirLight1.shadow.camera.left = -6;
  dirLight1.shadow.camera.right = 6;
  dirLight1.shadow.camera.top = 6;
  dirLight1.shadow.camera.bottom = -6;
  dirLight1.shadow.bias = -0.0005;
  scene.add(dirLight1);

  // Ánh sáng phụ mềm tầm thấp ở phía sau để chiếu nhẹ các góc khuất
  const dirLight2 = new THREE.DirectionalLight('#ffffff', 0.1);
  dirLight2.position.set(-5, 2, -5);
  scene.add(dirLight2);

  logToTerminal("Three.js Engine initialized.", "success");
}

// Kích hoạt hiệu ứng hoạt ảnh Zoom màn hình
function triggerZoomIn() {
  if (systemState === STATE_ZOOMED_IN || systemState === STATE_ZOOMING_IN) return;

  // Lấy tọa độ mục tiêu
  const targets = getCameraZoomTargets();
  targetCamPos.copy(targets.position);
  targetLookAt.copy(targets.target);

  systemState = STATE_ZOOMING_IN;
  controls.enabled = false; // Vô hiệu hóa OrbitControls trong lúc camera di chuyển

  logToTerminal("Zooming into Laptop Screen Portal...", "cyan");

  // Làm mờ các bảng UI để nhìn rõ màn hình laptop hơn
  const panelLeft = document.querySelector('.panel-left');
  const panelRight = document.querySelector('.panel-right');
  if (panelLeft) panelLeft.style.opacity = '0.3';
  if (panelRight) panelRight.style.opacity = '0.3';
}

// Kích hoạt hiệu ứng hoạt ảnh Zoom ra ngoài tổng quan
function triggerZoomOut() {
  if (systemState === STATE_OVERVIEW || systemState === STATE_ZOOMING_OUT) return;

  if (currentStage === STAGE_2_WAREHOUSE) {
    // 1. Chuyển lại mô hình sang iMac
    const laptop = getLaptopModel();
    const warehouse = getWarehouseModel();
    if (laptop) laptop.visible = true;
    if (warehouse) warehouse.visible = false;

    // 2. Định vị camera ngay sát màn hình iMac để chuẩn bị phóng to lùi ra ngoài
    const zoomTargets = getCameraZoomTargets();
    camera.position.copy(zoomTargets.position);
    controls.target.copy(zoomTargets.target);

    // Khôi phục lại cấu hình góc xoay và giới hạn OrbitControls cho iMac
    controls.minDistance = 4;
    controls.maxDistance = 25;
    controls.maxPolarAngle = Math.PI / 2 - 0.05;

    currentStage = STAGE_1_IMAC;

    // Đổi tiêu đề UI về mặc định
    const nodeName = document.getElementById('node-name');
    if (nodeName) nodeName.textContent = "Overview Laptop";
  }

  // Lấy tọa độ góc nhìn tổng quan
  const targets = getOverviewTargets();

  systemState = STATE_ZOOMING_OUT;

  const btnBackEl = document.getElementById('btn-back');
  if (btnBackEl) btnBackEl.classList.add('hidden');
  logToTerminal("Returning to overall view...", "warning");

  // Khôi phục lại độ hiển thị của các panel UI
  const panelLeft = document.querySelector('.panel-left');
  const panelRight = document.querySelector('.panel-right');
  if (panelLeft) panelLeft.style.opacity = '1';
  if (panelRight) panelRight.style.opacity = '1';
}

// Bắt đầu quá trình chuyển cảnh từ iMac sang Data Warehouse (Giai đoạn 2)
function triggerStage2Transition() {
  if (currentStage !== STAGE_1_IMAC) return;
  
  // Lấy tọa độ zoom cận cảnh màn hình để làm mục tiêu bay trung gian
  const zoomTargets = getCameraZoomTargets();
  targetCamPos.copy(zoomTargets.position);
  targetLookAt.copy(zoomTargets.target);

  currentStage = STAGE_2_WAREHOUSE;
  systemState = STATE_TRANSITIONING;
  controls.enabled = false; // Khóa OrbitControls trong lúc camera di chuyển tự động
  logToTerminal("[STAGE 2] Initiating server portal fly-in transition...", "cyan");

  // Làm mờ các bảng UI để tập trung vào hành lang 3D
  const panelLeft = document.querySelector('.panel-left');
  const panelRight = document.querySelector('.panel-right');
  if (panelLeft) panelLeft.style.opacity = '0';
  if (panelRight) panelRight.style.opacity = '0';
}

// Đăng ký các sự kiện tương tác của UI & Cửa sổ trình duyệt
function setupEvents() {
  // Tự động focus vào cửa sổ trang web khi người dùng rê chuột vào vùng canvas 3D
  const canvas = document.getElementById('webgl-canvas');
  if (canvas) {
    canvas.addEventListener('mouseenter', () => {
      window.focus();
    });
  }

  window.addEventListener('resize', () => {
    const w = window.innerWidth;
    const h = window.innerHeight;

    camera.aspect = w / h;
    camera.updateProjectionMatrix();

    renderer.setSize(w, h);
  });

  // Sự kiện rê chuột để Raycast hovers
  window.addEventListener('mousemove', (e) => {
    // Chỉ chạy Raycast khi ở chế độ Tổng quan
    if (systemState === STATE_OVERVIEW) {
      handleMouseMove(e, camera, window.innerWidth, window.innerHeight);
    }
  });

  // Ghi nhận tọa độ khi bắt đầu nhấn chuột/chạm để phân biệt Click và Drag
  window.addEventListener('pointerdown', (e) => {
    clickStartX = e.clientX;
    clickStartY = e.clientY;
    isDragging = false;
  });

  // Kiểm tra khoảng cách kéo khi nhả chuột/chạm
  window.addEventListener('pointerup', (e) => {
    const dx = e.clientX - clickStartX;
    const dy = e.clientY - clickStartY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    // Nếu khoảng cách kéo lớn hơn 5px, coi như là hành động xoay (drag)
    if (dist > 5) {
      isDragging = true;
    }
  });

  // Sự kiện click chuột để Raycast click
  window.addEventListener('click', (e) => {
    // Nếu là thao tác kéo xoay camera, bỏ qua sự kiện click để tránh thoát cảnh
    if (isDragging) {
      isDragging = false;
      return;
    }

    // Không kích hoạt zoom/thoát zoom khi người dùng đang click vào các phần tử UI nút bấm
    if (e.target.closest('.dashboard-ui') || e.target.closest('button')) return;

    if (systemState === STATE_OVERVIEW) {
      handleMouseClick(e, camera, window.innerWidth, window.innerHeight, triggerZoomIn);
    } else if (systemState === STATE_ZOOMED_IN) {
      // Chỉ zoom out khi click ngoài màn hình ở Giai đoạn 1 (iMac)
      // Ở Giai đoạn 2 (Warehouse), nhấp chuột trên canvas không tự động thoát về iMac
      if (currentStage === STAGE_1_IMAC) {
        triggerZoomOut();
      }
    }
  });

  // Đăng ký các sự kiện nút bấm tương tác (có kiểm tra an toàn sự tồn tại của phần tử)
  const btnZoom = document.getElementById('btn-zoom-screen');
  if (btnZoom) btnZoom.addEventListener('click', triggerZoomIn);

  const btnReset = document.getElementById('btn-reset-view');
  if (btnReset) {
    btnReset.addEventListener('click', () => {
      if (currentStage === STAGE_2_WAREHOUSE) {
        triggerZoomOut();
      } else if (systemState === STATE_OVERVIEW) {
        controls.reset();
        logToTerminal("Camera position reset to default overview.");
      } else {
        triggerZoomOut();
      }
    });
  }

  const btnBack = document.getElementById('btn-back');
  if (btnBack) btnBack.addEventListener('click', triggerZoomOut);

  // Lắng nghe phím mũi tên và các phím điều khiển từ xa của bút chuyển slide (presenter clicker)
  // Các bút chuyển slide thường giả lập PageDown/PageUp hoặc ArrowDown/ArrowUp hoặc ArrowRight/ArrowLeft
  window.addEventListener('keydown', (e) => {
    const nextKeys = ['ArrowRight', 'PageDown', 'ArrowDown'];
    const prevKeys = ['ArrowLeft', 'PageUp', 'ArrowUp'];

    if (nextKeys.includes(e.key)) {
      if (currentStage === STAGE_1_IMAC && (systemState === STATE_OVERVIEW || systemState === STATE_ZOOMED_IN)) {
        e.preventDefault();
        e.stopPropagation();
        triggerStage2Transition();
      }
    } else if (prevKeys.includes(e.key)) {
      if (currentStage === STAGE_2_WAREHOUSE) {
        e.preventDefault();
        e.stopPropagation();
        triggerZoomOut();
      }
    }
  }, true);
}

// Vòng lặp Render chính (Animation loop)
function animate() {
  requestAnimationFrame(animate);

  const time = clock.getElapsedTime();
  const delta = clock.getDelta();

  // Cập nhật hoạt ảnh màn hình laptop (Vẽ canvas động)
  updateScreenTexture(time);

  // Cập nhật dao động các thông số đo lường hệ thống
  updateTelemetry();

  // Nội suy tuyến tính di chuyển camera mượt mà (Lerping)
  if (systemState === STATE_ZOOMING_IN) {
    const speed = 0.06; // Tốc độ di chuyển camera
    camera.position.lerp(targetCamPos, speed);
    controls.target.lerp(targetLookAt, speed);

    if (camera.position.distanceTo(targetCamPos) < 0.03) {
      camera.position.copy(targetCamPos);
      controls.target.copy(targetLookAt);
      systemState = STATE_ZOOMED_IN;
      const btnBackEl = document.getElementById('btn-back');
      if (btnBackEl) btnBackEl.classList.remove('hidden');
      logToTerminal("[PORTAL] Connected to virtual screen workspace.", "success");

      const nodeName = document.getElementById('node-name');
      if (nodeName) nodeName.textContent = "Sub-system Screen Portal";
    }
  } else if (systemState === STATE_ZOOMING_OUT) {
    const speed = 0.06;
    camera.position.lerp(overviewCamPos, speed);
    controls.target.lerp(overviewLookAt, speed);

    if (camera.position.distanceTo(overviewCamPos) < 0.03) {
      camera.position.copy(overviewCamPos);
      controls.target.copy(overviewLookAt);
      systemState = STATE_OVERVIEW;
      controls.enabled = true; // Bật lại tính năng xoay camera tự do
      const nodeName = document.getElementById('node-name');
      if (nodeName) nodeName.textContent = "Overview Laptop";
    }
  } else if (systemState === STATE_TRANSITIONING) {
    const speed = 0.08;
    const screenCenter = getScreenCenterWorld(); // Lấy tâm màn hình iMac thế giới

    // Bay thẳng camera vào tâm màn hình iMac
    camera.position.lerp(screenCenter, speed);
    controls.target.lerp(screenCenter, speed);

    // Khi camera đã tiến rất sát màn hình (đâm xuyên qua màn hình)
    if (camera.position.distanceTo(screenCenter) < 0.15) {
      // 1. Ẩn iMac, hiển thị Data Warehouse
      const laptop = getLaptopModel();
      const warehouse = getWarehouseModel();
      if (laptop) laptop.visible = false;
      if (warehouse) warehouse.visible = true;

      // 2. Định vị camera trực tiếp tại vị trí xem trong Data Warehouse
      // Đặt camera ở vị trí lùi lại hơn (ví dụ Z = 3.5 thay vì 1.5) để góc nhìn rộng hơn và không bị quá sâu.
      // Đặt target tại (0, -0.15, 0) để tạo khoảng cách 3.5 đơn vị, nhỏ hơn maxDistance (8).
      // Điều này ngăn chặn hoàn toàn việc OrbitControls kéo camera zoom sâu thêm 1 lần nữa!
      camera.position.set(0, -0.15, 3.5);
      controls.target.set(0, -0.15, 0); 
      controls.update(); // Đồng bộ hóa OrbitControls ngay lập tức!

      // 3. Hoàn thành chuyển cảnh ngay lập tức và mở khóa camera
      systemState = STATE_ZOOMED_IN; 
      controls.enabled = true; // Mở lại OrbitControls để người dùng tự do tham quan
      
      // Giới hạn OrbitControls trong Warehouse để người dùng không bay ra khỏi hộp
      controls.minDistance = 1;
      controls.maxDistance = 8;
      controls.maxPolarAngle = Math.PI - 0.05; // Mở rộng góc xoay dọc để không bị giật camera lên trên

      // Đổi tiêu đề UI
      const nodeName = document.getElementById('node-name');
      if (nodeName) nodeName.textContent = "Data Warehouse Core";
      
      logToTerminal("[STAGE 2] Entered Virtual Data Warehouse successfully.", "success");
    }
  }

  if (controls.enabled) {
    controls.update();
  }
  renderer.render(scene, camera);
}

// Khởi động hệ thống khi tải trang xong
window.addEventListener('DOMContentLoaded', () => {
  startClock();
  initThree();
  setupEvents();

  // Tải mô hình iMac 3D trước
  loadLaptopModel(
    scene,
    (model) => {
      logToTerminal("[SYSTEM] iMac model loaded.", "success");
      
      // Tải tiếp mô hình Data Warehouse (Giai đoạn 2)
      loadWarehouseModel(
        scene,
        (whModel) => {
          logToTerminal("[SYSTEM] Data Warehouse model loaded.", "success");
          // Bắt đầu chạy vòng lặp render sau khi tải xong cả 2
          animate();
        },
        (logMsg) => {
          if (logMsg.includes('[ERROR]')) {
            logToTerminal(logMsg, 'danger');
          } else if (logMsg.includes('[WARNING]')) {
            logToTerminal(logMsg, 'warning');
          } else {
            logToTerminal(logMsg);
          }
        }
      );
    },
    (logMsg) => {
      // Logs tải laptop
      if (logMsg.includes('[ERROR]')) {
        logToTerminal(logMsg, 'danger');
      } else if (logMsg.includes('[WARNING]')) {
        logToTerminal(logMsg, 'warning');
      } else {
        logToTerminal(logMsg);
      }
    }
  );
});
