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
  getScreenCenterWorld,
  playDoorOpenAnimation,
  getAnimationMixer,
  resetDoorAnimation
} from './model-viewer.js';

// Các trạng thái của Camera
const STATE_OVERVIEW = 0;
const STATE_ZOOMING_IN = 1;
const STATE_ZOOMED_IN = 2;
const STATE_ZOOMING_OUT = 3;
const STATE_TRANSITIONING = 4;   // Bay qua màn hình để chuyển sang giai đoạn 2
const STATE_TRANSITIONING_STAGE3 = 5; // Bay qua cánh cửa đang mở để sang giai đoạn 3

// Các giai đoạn (Stages) của hệ thống
const STAGE_1_IMAC = 1;
const STAGE_2_WAREHOUSE = 2;
const STAGE_3_SPACE = 3;

let systemState = STATE_OVERVIEW;
let currentStage = STAGE_1_IMAC;
let currentSlide = 1; // 1: iMac Overview, 2: Warehouse, 3: Warehouse + Panel, 4: Warehouse Panel Dismissed

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
const animClock = new THREE.Clock(); // Đồng hồ chuyên dụng cho hoạt ảnh (tránh xung đột getDelta)

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
  renderer.toneMapping = THREE.LinearToneMapping; // Đổi sang Linear giống sandbox
  renderer.toneMappingExposure = 1.0; // Exposure mặc định = 1.0 (0.0 trong GUI gltf-viewer)

  // Khởi tạo bộ điều khiển OrbitControls (xoay camera)
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.maxPolarAngle = Math.PI / 2 - 0.05; // Giới hạn không cho camera đi dưới mặt đất
  controls.minDistance = 4;
  controls.maxDistance = 25;
  controls.target.copy(overviewLookAt);

  // Ánh sáng phụ góc sườn trái cố định trong Scene để tránh cháy sáng khi Camera nhìn trực diện
  const sideLightLeft = new THREE.DirectionalLight('#ffffff', 1.0);
  sideLightLeft.position.set(-6, 5, 8); // Chiếu từ phía trước - trái - trên
  scene.add(sideLightLeft);

  // Tạo môi trường phản xạ (Environment Map) từ "ice_river" của Online3DViewer để mô phỏng ánh sáng phản chiếu chân thực nhất
  const cubeLoader = new THREE.CubeTextureLoader();
  cubeLoader.setCrossOrigin('anonymous');
  const envTexture = cubeLoader.load([
    'https://raw.githubusercontent.com/kovacsv/Online3DViewer/master/website/assets/envmaps/ice_river/posx.jpg',
    'https://raw.githubusercontent.com/kovacsv/Online3DViewer/master/website/assets/envmaps/ice_river/negx.jpg',
    'https://raw.githubusercontent.com/kovacsv/Online3DViewer/master/website/assets/envmaps/ice_river/posy.jpg',
    'https://raw.githubusercontent.com/kovacsv/Online3DViewer/master/website/assets/envmaps/ice_river/negy.jpg',
    'https://raw.githubusercontent.com/kovacsv/Online3DViewer/master/website/assets/envmaps/ice_river/posz.jpg',
    'https://raw.githubusercontent.com/kovacsv/Online3DViewer/master/website/assets/envmaps/ice_river/negz.jpg'
  ]);
  scene.environment = envTexture;

  // Ánh sáng môi trường dịu (khớp với ambientIntensity = 0.3 của sandbox)
  const ambientLight = new THREE.AmbientLight('#ffffff', 0.3);
  scene.add(ambientLight);

  // Ánh sáng cố định chiếu bóng đổ (chuyển sang góc sườn (6, 3, 5) để phản xạ hắt chéo, không dội trực diện vào Camera)
  const dirLight1 = new THREE.DirectionalLight('#ffffff', 0.7);
  dirLight1.position.set(6, 3, 5);
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

  logToTerminal("Three.js Engine initialized with Sandbox Studio Lighting.", "success");
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
  if (panelLeft) {
    panelLeft.style.opacity = '0.3';
    panelLeft.style.pointerEvents = 'auto';
  }
  if (panelRight) {
    panelRight.style.opacity = '0.3';
    panelRight.style.pointerEvents = 'auto';
  }
}

// Kích hoạt hiệu ứng hoạt ảnh Zoom ra ngoài tổng quan
function triggerZoomOut() {
  if (systemState === STATE_OVERVIEW || systemState === STATE_ZOOMING_OUT) return;

  currentSlide = 1; // Đồng bộ slide về trang đầu

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

    // Ẩn bảng so sánh Data Warehouse và trả về trạng thái mặc định
    const infoPanel = document.getElementById('dw-info-panel');
    if (infoPanel) {
      infoPanel.classList.add('hidden');
      infoPanel.classList.remove('collapsed');
      const toggleIcon = document.getElementById('toggle-icon');
      if (toggleIcon) {
        toggleIcon.innerHTML = `<polyline points="18 15 12 9 6 15"></polyline>`;
      }
    }

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
  if (panelLeft) {
    panelLeft.style.opacity = '1';
    panelLeft.style.pointerEvents = 'auto';
  }
  if (panelRight) {
    panelRight.style.opacity = '1';
    panelRight.style.pointerEvents = 'auto';
  }
}

// Bắt đầu quá trình chuyển cảnh từ iMac sang Data Warehouse (Giai đoạn 2)
function triggerStage2Transition() {
  if (currentStage !== STAGE_1_IMAC) return;

  currentSlide = 2; // Đồng bộ slide sang trang 2 (Warehouse ẩn bảng)

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
  if (panelLeft) {
    panelLeft.style.opacity = '0';
    panelLeft.style.pointerEvents = 'none';
  }
  if (panelRight) {
    panelRight.style.opacity = '0';
    panelRight.style.pointerEvents = 'none';
  }
}

// Bắt đầu quá trình chuyển cảnh từ Data Warehouse sang Không gian Cosmic (Giai đoạn 3)
function triggerStage3Transition() {
  if (currentStage !== STAGE_2_WAREHOUSE) return;

  logToTerminal("[STAGE 3] Entering cosmic storage dimension...", "cyan");

  currentStage = STAGE_3_SPACE;
  currentSlide = 8;
  systemState = STATE_ZOOMED_IN;
  controls.enabled = false; // Khóa OrbitControls tạm thời

  // Khử hình nền tĩnh để lộ video
  document.body.classList.add('stage3-active');

  // 1. Kích hoạt phát video nền autoplay + loop và làm mờ các thành phần 3D cũ
  const bgVideo = document.getElementById('bg-video-stage3');
  if (bgVideo) {
    bgVideo.classList.add('active');
    bgVideo.currentTime = 0;
    bgVideo.play().catch(err => {
      console.warn("Autoplay blocked or failed:", err);
    });
  }

  // 2. Ẩn bảng thông tin Data Warehouse
  const infoPanel = document.getElementById('dw-info-panel');
  if (infoPanel) {
    infoPanel.classList.add('hidden');
  }

  // 3. Ẩn mô hình Data Warehouse và iMac để xem trọn vẹn video background Cosmic
  const warehouse = getWarehouseModel();
  if (warehouse) {
    warehouse.visible = false;
  }
  const laptop = getLaptopModel();
  if (laptop) {
    laptop.visible = false;
  }

  // 3.1 Ẩn WebGL canvas và hai bảng điều khiển hai bên sườn (để lộ hoàn toàn video nền)
  const canvas = document.getElementById('webgl-canvas');
  if (canvas) {
    canvas.style.transition = 'opacity 0.6s ease';
    canvas.style.opacity = '0';
    canvas.style.pointerEvents = 'none';
  }
  const panelLeft = document.querySelector('.panel-left');
  const panelRight = document.querySelector('.panel-right');
  if (panelLeft) {
    panelLeft.style.transition = 'opacity 0.6s ease';
    panelLeft.style.opacity = '0';
    panelLeft.style.pointerEvents = 'none';
  }
  if (panelRight) {
    panelRight.style.transition = 'opacity 0.6s ease';
    panelRight.style.opacity = '0';
    panelRight.style.pointerEvents = 'none';
  }

  // 4. Định vị camera và đổi tên Node
  camera.position.set(0, 0, 15);
  controls.target.set(0, 0, 0);
  controls.update();

  const nodeName = document.getElementById('node-name');
  if (nodeName) {
    nodeName.textContent = "Cosmic Data Space";
  }

  // 5. Hiển thị HUD cards của Giai đoạn 3
  const stage3Hud = document.getElementById('stage3-hud-container');
  if (stage3Hud) {
    stage3Hud.classList.remove('hidden');
  }

  logToTerminal("[STAGE 3] Cosmic Space Background activated.", "success");
}

// Quay trở lại Giai đoạn 2 từ Giai đoạn 3
function triggerStage2From3() {
  if (currentStage !== STAGE_3_SPACE) return;

  currentStage = STAGE_2_WAREHOUSE;
  currentSlide = 7;
  systemState = STATE_ZOOMED_IN;

  // Khôi phục lại hình nền tĩnh của Stage 1 & 2
  document.body.classList.remove('stage3-active');

  // 1. Tắt/Ẩn video nền
  const bgVideo = document.getElementById('bg-video-stage3');
  if (bgVideo) {
    bgVideo.classList.remove('active');
    bgVideo.pause();
  }

  // 1.1 Khôi phục hiển thị WebGL canvas và hai bảng điều khiển hai bên sườn
  const canvas = document.getElementById('webgl-canvas');
  if (canvas) {
    canvas.style.opacity = '1';
    canvas.style.pointerEvents = 'auto';
  }
  const panelLeft = document.querySelector('.panel-left');
  const panelRight = document.querySelector('.panel-right');
  if (panelLeft) {
    panelLeft.style.opacity = '1';
    panelLeft.style.pointerEvents = 'auto';
  }
  if (panelRight) {
    panelRight.style.opacity = '1';
    panelRight.style.pointerEvents = 'auto';
  }

  // 2. Hiển thị lại mô hình Data Warehouse
  const warehouse = getWarehouseModel();
  if (warehouse) {
    warehouse.visible = true;
  }

  // 3. Khôi phục camera và góc nhìn của Warehouse
  camera.position.set(0, -0.15, 3.5);
  controls.target.set(0, -0.15, 0);
  controls.update();

  controls.enabled = true;
  controls.minDistance = 1;
  controls.maxDistance = 8;
  controls.maxPolarAngle = Math.PI - 0.05;

  const nodeName = document.getElementById('node-name');
  if (nodeName) {
    nodeName.textContent = "Data Warehouse Core";
  }

  // 4. Ẩn HUD cards của Giai đoạn 3 và đóng cửa trạm dữ liệu trở lại
  const stage3Hud = document.getElementById('stage3-hud-container');
  if (stage3Hud) {
    stage3Hud.classList.add('hidden');
  }

  // Đóng cửa hành lang dữ liệu trở lại trạng thái ban đầu
  resetDoorAnimation();
 
  logToTerminal("[STAGE 2] Returned to Data Warehouse Core.", "warning");
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



  // Đăng ký sự kiện Thu nhỏ / Mở rộng bảng so sánh ở Giai đoạn 2
  const btnTogglePanel = document.getElementById('btn-toggle-panel');
  const infoPanel = document.getElementById('dw-info-panel');
  const toggleIcon = document.getElementById('toggle-icon');
  if (btnTogglePanel && infoPanel) {
    btnTogglePanel.addEventListener('click', (e) => {
      e.stopPropagation(); // Tránh sự kiện nhấp lan ra ngoài canvas
      const isCollapsed = infoPanel.classList.toggle('collapsed');
      if (toggleIcon) {
        if (isCollapsed) {
          // Biểu tượng mũi tên đi xuống
          toggleIcon.innerHTML = `<polyline points="6 9 12 15 18 9"></polyline>`;
        } else {
          // Biểu tượng mũi tên đi lên
          toggleIcon.innerHTML = `<polyline points="18 15 12 9 6 15"></polyline>`;
        }
      }
    });
  }

  // Lắng nghe phím mũi tên và các phím điều khiển từ xa của bút chuyển slide (presenter clicker)
  // Các bút chuyển slide thường giả lập PageDown/PageUp hoặc ArrowDown/ArrowUp hoặc ArrowRight/ArrowLeft
  window.addEventListener('keydown', (e) => {
    // -------------------------------------------------------------
    // TÍNH NĂNG ACTIVE HOVER CÁC MỤC DATA WAREHOUSE BẰNG PHÍM 1, 2, 3, 4 (STAGE 2)
    // -------------------------------------------------------------
    if (currentStage === STAGE_2_WAREHOUSE) {
      const numKeys = ['1', '2', '3', '4'];
      if (numKeys.includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();

        const items = document.querySelectorAll('.comparison-item');
        const targetIndex = parseInt(e.key) - 1;

        if (items[targetIndex]) {
          const isAlreadyActive = items[targetIndex].classList.contains('active');

          // Xóa class active ở tất cả các mục
          items.forEach(item => item.classList.remove('active'));

          if (!isAlreadyActive) {
            // Thêm active vào mục được chọn
            items[targetIndex].classList.add('active');

            // Cuộn mượt mà đến mục đó trong bảng nếu cần
            items[targetIndex].scrollIntoView({ behavior: 'smooth', block: 'nearest' });

            const title = items[targetIndex].querySelector('h4').textContent;
            logToTerminal(`🔍 Đang thuyết trình mục ${e.key}: ${title}`, "success");
          } else {
            logToTerminal(`🔍 Bỏ chọn mục ${e.key}`, "warning");
          }
        }
        return;
      }
    }

    // -------------------------------------------------------------
    // TÍNH NĂNG ĐIỀU CHỈNH VỊ TRÍ LAPTOP/IMAC (GIAI ĐOẠN 1) THEO YÊU CẦU CỦA USER
    // -------------------------------------------------------------
    const laptop = getLaptopModel();
    if (laptop && currentStage === STAGE_1_IMAC) {
      const step = e.shiftKey ? 0.01 : 0.05; // Giữ Shift để dịch chuyển tinh tế hơn
      const rotStep = e.shiftKey ? 0.01 : 0.05;
      const scaleStep = e.shiftKey ? 0.005 : 0.02;
      let adjusted = false;

      const keyLower = e.key.toLowerCase();
      if (keyLower === 'j') {
        laptop.position.x -= step;
        adjusted = true;
      } else if (keyLower === 'l') {
        laptop.position.x += step;
        adjusted = true;
      } else if (keyLower === 'i') {
        laptop.position.y += step;
        adjusted = true;
      } else if (keyLower === 'k') {
        laptop.position.y -= step;
        adjusted = true;
      } else if (keyLower === 'u') {
        laptop.position.z -= step;
        adjusted = true;
      } else if (keyLower === 'o') {
        laptop.position.z += step;
        adjusted = true;
      } else if (keyLower === 'y') {
        laptop.rotation.y += rotStep;
        adjusted = true;
      } else if (keyLower === 'h') {
        laptop.rotation.y -= rotStep;
        adjusted = true;
      } else if (keyLower === 't') {
        laptop.rotation.x += rotStep;
        adjusted = true;
      } else if (keyLower === 'g') {
        laptop.rotation.x -= rotStep;
        adjusted = true;
      } else if (e.key === '[') {
        laptop.scale.addScalar(-scaleStep);
        adjusted = true;
      } else if (e.key === ']') {
        laptop.scale.addScalar(scaleStep);
        adjusted = true;
      }

      if (adjusted) {
        e.preventDefault();
        e.stopPropagation();

        // Định dạng cấu hình tọa độ hiện tại
        const posText = `Pos: (${laptop.position.x.toFixed(4)}, ${laptop.position.y.toFixed(4)}, ${laptop.position.z.toFixed(4)})`;
        const rotText = `Rot: (${laptop.rotation.x.toFixed(4)}, ${laptop.rotation.y.toFixed(4)}, ${laptop.rotation.z.toFixed(4)})`;
        const scaleText = `Scale: ${laptop.scale.x.toFixed(4)}`;

        // In ra console chi tiết dạng code copy-paste
        console.clear();
        console.log(`%c[ADJUSTMENT] CẤU HÌNH MÁY TÍNH MỚI:`, "color: #00ffff; font-weight: bold; font-size: 14px;");
        console.log(`Copy đoạn code bên dưới và gửi lại cho dev:`);
        console.log(`%c----------------------------------------------------`, "color: #888;");
        console.log(`laptopModel.position.set(${laptop.position.x.toFixed(4)}, ${laptop.position.y.toFixed(4)}, ${laptop.position.z.toFixed(4)});`);
        console.log(`laptopModel.rotation.y = ${laptop.rotation.y.toFixed(4)};`);
        if (Math.abs(laptop.rotation.x) > 0.001) {
          console.log(`laptopModel.rotation.x = ${laptop.rotation.x.toFixed(4)};`);
        }
        console.log(`laptopModel.scale.setScalar(${(laptop.scale.x).toFixed(4)});`);
        console.log(`%c----------------------------------------------------`, "color: #888;");

        // In ra màn hình log
        logToTerminal(`📐 Đã chỉnh: ${posText} | ${rotText} | ${scaleText}`, "cyan");
        return;
      }
    }

    const nextKeys = ['ArrowRight', 'PageDown', 'ArrowDown'];
    const prevKeys = ['ArrowLeft', 'PageUp', 'ArrowUp'];

    if (nextKeys.includes(e.key)) {
      if (currentStage === STAGE_1_IMAC && (systemState === STATE_OVERVIEW || systemState === STATE_ZOOMED_IN)) {
        e.preventDefault();
        e.stopPropagation();
        triggerStage2Transition(); // Đặt currentSlide = 2 trong hàm
      } else if (currentStage === STAGE_2_WAREHOUSE) {
        const infoPanel = document.getElementById('dw-info-panel');
        const items = document.querySelectorAll('.comparison-item');
        if (infoPanel) {
          if (currentSlide === 2) {
            e.preventDefault();
            e.stopPropagation();
            currentSlide = 3;
            infoPanel.classList.remove('hidden');
            // Reset active classes and set active on the first item
            items.forEach(item => item.classList.remove('active'));
            if (items[0]) {
              items[0].classList.add('active');
              items[0].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
              logToTerminal(`[STAGE 2] Hiện bảng & mục 1: ${items[0].querySelector('h4').textContent}`, "success");
            }
          } else if (currentSlide >= 3 && currentSlide <= 5) {
            e.preventDefault();
            e.stopPropagation();
            const targetIndex = currentSlide - 2; // currentSlide 3 -> index 1, slide 4 -> index 2, slide 5 -> index 3
            currentSlide++;
            items.forEach(item => item.classList.remove('active'));
            if (items[targetIndex]) {
              items[targetIndex].classList.add('active');
              items[targetIndex].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
              logToTerminal(`[STAGE 2] Mục ${targetIndex + 1}: ${items[targetIndex].querySelector('h4').textContent}`, "success");
            }
          } else if (currentSlide === 6) {
            e.preventDefault();
            e.stopPropagation();
            currentSlide = 7;
            items.forEach(item => item.classList.remove('active'));
            infoPanel.classList.add('hidden');
            infoPanel.classList.remove('collapsed');
            const toggleIcon = document.getElementById('toggle-icon');
            if (toggleIcon) {
              toggleIcon.innerHTML = `<polyline points="18 15 12 9 6 15"></polyline>`;
            }
            logToTerminal("[STAGE 2] Đóng bảng so sánh. Sẵn sàng vào Giai đoạn 3.", "warning");
          } else if (currentSlide === 7) {
            e.preventDefault();
            e.stopPropagation();

            // 1. Chạy hoạt ảnh mở cửa từ GLB
            const hasAnim = playDoorOpenAnimation();
            if (hasAnim) {
              logToTerminal("[ANIMATION] 🚪 Đang mở cửa trạm dữ liệu DMT...", "warning");
            } else {
              logToTerminal("[ANIMATION] Tiến hành bay camera qua cổng dữ liệu...", "warning");
            }

            // 2. Kích hoạt camera bay tiến thẳng vào cửa
            systemState = STATE_TRANSITIONING_STAGE3;
            controls.enabled = false;

            // Tọa độ đích của camera: Bay hoàn toàn đi xuyên qua cánh cửa (Z = -8.0 vượt qua cánh cửa ở khoảng -5.0)
            targetCamPos.set(0, -0.15, -8.0);
            targetLookAt.set(0, -0.15, -12.0);

            // 3. Sau 2.5 giây (để camera bay từ từ, mượt mà đi xuyên qua cửa), chuyển cảnh hẳn sang Stage 3
            setTimeout(() => {
              triggerStage3Transition();
            }, 1000);
          }
        }
      }
    } else if (prevKeys.includes(e.key)) {
      if (currentStage === STAGE_3_SPACE) {
        e.preventDefault();
        e.stopPropagation();
        triggerStage2From3();
      } else if (currentStage === STAGE_2_WAREHOUSE) {
        const infoPanel = document.getElementById('dw-info-panel');
        const items = document.querySelectorAll('.comparison-item');
        if (infoPanel) {
          if (currentSlide === 7) {
            e.preventDefault();
            e.stopPropagation();
            currentSlide = 6;
            infoPanel.classList.remove('hidden');
            items.forEach(item => item.classList.remove('active'));
            if (items[3]) {
              items[3].classList.add('active');
              items[3].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
              logToTerminal(`[STAGE 2] Hiện lại bảng & mục 4: ${items[3].querySelector('h4').textContent}`, "success");
            }
          } else if (currentSlide >= 4 && currentSlide <= 6) {
            e.preventDefault();
            e.stopPropagation();
            currentSlide--;
            const targetIndex = currentSlide - 3; // currentSlide 5 -> index 2, slide 4 -> index 1, slide 3 -> index 0
            items.forEach(item => item.classList.remove('active'));
            if (items[targetIndex]) {
              items[targetIndex].classList.add('active');
              items[targetIndex].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
              logToTerminal(`[STAGE 2] Mục ${targetIndex + 1}: ${items[targetIndex].querySelector('h4').textContent}`, "success");
            }
          } else if (currentSlide === 3) {
            e.preventDefault();
            e.stopPropagation();
            currentSlide = 2;
            items.forEach(item => item.classList.remove('active'));
            infoPanel.classList.add('hidden');
            infoPanel.classList.remove('collapsed');
            const toggleIcon = document.getElementById('toggle-icon');
            if (toggleIcon) {
              toggleIcon.innerHTML = `<polyline points="18 15 12 9 6 15"></polyline>`;
            }
            logToTerminal("[STAGE 2] Ẩn bảng so sánh.", "warning");
          } else if (currentSlide === 2) {
            e.preventDefault();
            e.stopPropagation();
            triggerZoomOut(); // Đặt currentSlide = 1 trong hàm
          }
        }
      }
    }
  }, true);
}

// Vòng lặp Render chính (Animation loop)
function animate() {
  requestAnimationFrame(animate);

  const time = clock.getElapsedTime();
  const delta = animClock.getDelta(); // Sử dụng animClock chuyên dụng để lấy delta chính xác

  // Cập nhật Animation Mixer của Warehouse
  const activeMixer = getAnimationMixer();
  if (activeMixer) {
    activeMixer.update(delta);
    if (Math.random() < 0.005) {
      console.log("WarehouseMixer updating! Delta:", delta, "Mixer time:", activeMixer.time);
    }
  }

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
      logToTerminal("💡 THUYẾT TRÌNH DATA WAREHOUSE (Stage 2):", "warning");
      logToTerminal(" - Nhấn Mũi Tên Phải (ArrowRight) / PageDown để xem & Highlight tuần tự từng mục trong bảng!", "cyan");
      logToTerminal(" - Có thể bấm phím số 1, 2, 3, 4 để chuyển nhanh trực tiếp đến mục bất kỳ!", "cyan");
    }
  } else if (systemState === STATE_TRANSITIONING_STAGE3) {
    const speed = 0.0051; // Giảm tốc độ xuống 0.01 để camera lướt đi siêu chậm và sang trọng
    camera.position.lerp(targetCamPos, speed);
    controls.target.lerp(targetLookAt, speed);
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
      logToTerminal("🔧 ĐIỀU CHỈNH VỊ TRÍ MÁY TÍNH (Stage 1):", "warning");
      logToTerminal(" - Phím J / L: Sang trái / Sang phải", "cyan");
      logToTerminal(" - Phím I / K: Đi lên / Đi xuống", "cyan");
      logToTerminal(" - Phím U / O: Tiến ra sau / Tiến ra trước", "cyan");
      logToTerminal(" - Phím Y / H: Xoay quanh Y (+/-)", "cyan");
      logToTerminal(" - Phím T / G: Xoay quanh X (+/-)", "cyan");
      logToTerminal(" - Phím [ / ]: Thu nhỏ / Phóng to tỉ lệ", "cyan");
      logToTerminal(" * Giữ SHIFT để dịch chuyển tinh chỉnh từng chút một.", "success");
      logToTerminal(" * Vị trí mới sẽ tự động in ra Console trình duyệt để copy!", "success");

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
