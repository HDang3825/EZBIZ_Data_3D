import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Các biến trạng thái
let laptopModel = null;
let warehouseModel = null;
let screenMesh = null;
let warehouseMixer = null;   // Mixer hoạt ảnh chính cho mô hình warehouse
let doorOpenActions = [];    // Danh sách các ClipActions chạy đồng thời (cho Blender multi-clip)

// Các biến phục vụ Raycasting (bắt tọa độ chuột)
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// Kích thước màn hình / Các thông số mặc định
let screenCenterWorld = new THREE.Vector3(0, 4.2, -0.2); // Tọa độ màn hình dự phòng
let screenNormalWorld = new THREE.Vector3(0, 0, 1);    // Hướng pháp tuyến của màn hình

// Cập nhật hoạt ảnh trên Canvas texture (no-op theo yêu cầu giữ nguyên màn hình gốc)
export function updateScreenTexture(time) {
  // Không thực hiện thao tác vẽ đè để giữ nguyên màn hình mặc định của model 3D
}

// Tải mô hình 3D Laptop dạng GLTF/GLB
export function loadLaptopModel(scene, onLoadCallback, onLogCallback) {
  onLogCallback("[LOADER] Fetching laptop model Imac.glb...");

  const loader = new GLTFLoader();

  loader.load(
    'Imac-hhh.glb',
    (gltf) => {
      const modelGroup = gltf.scene;
      laptopModel = new THREE.Group();
      laptopModel.add(modelGroup);
      onLogCallback("[LOADER] Model loaded successfully. Analysing structure...");

      // Tính toán Bounding Box để căn giữa và tự động co giãn mô hình
      const box = new THREE.Box3().setFromObject(modelGroup);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());

      onLogCallback(`[LOADER] Dimensions: W:${size.x.toFixed(2)}, H:${size.y.toFixed(2)}, D:${size.z.toFixed(2)}`);

      // Căn giữa modelGroup bên trong container laptopModel
      modelGroup.position.copy(center).multiplyScalar(-1);

      // Co giãn mô hình về kích thước chuẩn (độ rộng khoảng 10 đơn vị)
      const maxDim = Math.max(size.x, size.y, size.z);
      const targetSize = 10;
      const scaleFactor = targetSize / maxDim;
      // Thiết lập vị trí, xoay, tỉ lệ theo cấu hình tối ưu do người dùng căn chỉnh
      laptopModel.scale.setScalar(0.6350);

      // Xoay mặt trước hướng về camera và nghiêng theo cấu hình căn chỉnh
      laptopModel.rotation.order = 'YXZ';
      laptopModel.rotation.y = 3.1416;
      laptopModel.rotation.x = 0.2000;

      // Định vị máy tính theo cấu hình căn chỉnh
      laptopModel.position.set(-0.2500, -0.5300, 0.0500);

      onLogCallback(`[LOADER] Auto-scaled model by factor: ${scaleFactor.toFixed(4)}`);

      // Duyệt qua mô hình để thiết lập ánh sáng, vật liệu và tìm màn hình
      laptopModel.traverse((child) => {


        if (child.isMesh) {
          // Bỏ qua nếu mesh đã bị ẩn
          if (child.visible === false) return;

          child.castShadow = true;
          child.receiveShadow = true;

          // Ghi log tên các mesh để tham khảo lập trình
          onLogCallback(` - Mesh found: ${child.name}`);

          // Phát hiện mesh màn hình (khớp cả tên 'Plane' vốn là màn hình trong GLB này)
          const nameLower = child.name.toLowerCase();
          const isScreen = nameLower.includes('screen') ||
            nameLower.includes('display') ||
            nameLower.includes('lcd') ||
            nameLower.includes('monitor') ||
            nameLower.includes('glass') ||
            nameLower.includes('mat_screen') ||
            nameLower.includes('màn hình') ||
            child.name === 'Plane';

          if (isScreen && !screenMesh) {
            screenMesh = child;
            onLogCallback(`[SYSTEM] Matched screen mesh: "${child.name}"`);

            // Khử hoàn toàn phản xạ gây lóa/cháy sáng trên màn hình (biến thành màn hình nhám chống chói)
            if (child.material) {
              child.material.roughness = 1.0;
              child.material.metalness = 0.0;
              if (child.material.map) {
                child.material.map.anisotropy = 16; // Tăng chất lượng hiển thị sắc nét cho texture màn hình
              }
            }
          }
        }
      });

      // Nếu không tìm thấy mesh màn hình bằng tên, tạo một mặt phẳng overlay dự phòng
      // đặt đúng vị trí màn hình laptop thông thường (nghiêng khoảng 5-10 độ, ở phía trên tâm).
      if (!screenMesh) {
        onLogCallback("[WARNING] No mesh named 'screen/display' found. Injecting a Virtual Screen Portal overlay.");

        // Tạo hình học mặt phẳng khớp với tỷ lệ chuẩn
        const planeGeo = new THREE.PlaneGeometry(7.8, 5.2);
        const fallbackMat = new THREE.MeshStandardMaterial({ color: 0x111115, roughness: 0.5 });
        const screenOverlay = new THREE.Mesh(planeGeo, fallbackMat);

        // Định vị vị trí màn hình trên các mô hình laptop phổ biến (đế nằm phẳng trên XZ, nghiêng nhẹ về sau)
        screenOverlay.position.set(0, 2.8, -0.6);
        screenOverlay.rotation.x = -0.15; // Hơi nghiêng về phía sau
        screenOverlay.name = "VirtualScreenPortal";

        laptopModel.add(screenOverlay);
        screenMesh = screenOverlay;
      }

      // Thêm mô hình laptop vào scene
      scene.add(laptopModel);

      // Tính toán tọa độ thế giới của màn hình để căn chỉnh camera chính xác
      screenMesh.updateWorldMatrix(true, true);
      screenMesh.getWorldPosition(screenCenterWorld);

      // Vector pháp tuyến hướng thẳng ra ngoài màn hình
      const normalMatrix = new THREE.Matrix3().getNormalMatrix(screenMesh.matrixWorld);
      screenNormalWorld.set(0, 0, 1).applyMatrix3(normalMatrix).normalize();

      onLogCallback(`[SYSTEM] Laptop screen calibrated. Center: ${screenCenterWorld.x.toFixed(1)}, ${screenCenterWorld.y.toFixed(1)}, ${screenCenterWorld.z.toFixed(1)}`);

      onLoadCallback(laptopModel);
    },
    (xhr) => {
      if (xhr.total > 0) {
        const percent = (xhr.loaded / xhr.total * 100).toFixed(0);
        onLogCallback(`[LOADER] Progress: ${percent}%`);
      }
    },
    (err) => {
      onLogCallback(`[ERROR] Failed to load model: ${err.message}. Generating default laptop shape...`);
      createFallbackLaptop(scene, onLoadCallback, onLogCallback);
    }
  );
}

// Bộ tạo laptop dự phòng nếu file GLB không tải được
function createFallbackLaptop(scene, onLoadCallback, onLogCallback) {
  laptopModel = new THREE.Group();

  // Phần đế laptop
  const baseGeo = new THREE.BoxGeometry(8, 0.4, 6);
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x22252a, metalness: 0.9, roughness: 0.2 });
  const base = new THREE.Mesh(baseGeo, metalMat);
  base.position.y = 0.2;
  laptopModel.add(base);

  // Lớp đè khu vực bàn phím
  const keyboardGeo = new THREE.PlaneGeometry(7.2, 3.8);
  const kbMat = new THREE.MeshStandardMaterial({ color: 0x111115, roughness: 0.5 });
  const keyboard = new THREE.Mesh(keyboardGeo, kbMat);
  keyboard.rotation.x = -Math.PI / 2;
  keyboard.position.set(0, 0.41, 0.8);
  laptopModel.add(keyboard);

  // Nắp gập chứa màn hình
  const lidGroup = new THREE.Group();
  lidGroup.position.set(0, 0.3, -2.8);
  lidGroup.rotation.x = -0.3; // Góc nghiêng mở nắp

  const backLidGeo = new THREE.BoxGeometry(8, 5.5, 0.3);
  const backLid = new THREE.Mesh(backLidGeo, metalMat);
  backLid.position.y = 2.6;
  backLid.position.z = -0.15;
  lidGroup.add(backLid);

  // Màn hình hiển thị
  const screenMat = new THREE.MeshStandardMaterial({
    color: 0x0b0c10,
    roughness: 0.1,
    metalness: 0.5
  });
  const screenGeo = new THREE.PlaneGeometry(7.6, 5.0);
  const screen = new THREE.Mesh(screenGeo, screenMat);
  screen.position.y = 2.6;
  screen.position.z = 0.01;
  lidGroup.add(screen);

  laptopModel.add(lidGroup);
  scene.add(laptopModel);

  screenMesh = screen;

  screenMesh.updateWorldMatrix(true, true);
  screenMesh.getWorldPosition(screenCenterWorld);
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(screenMesh.matrixWorld);
  screenNormalWorld.set(0, 0, 1).applyMatrix3(normalMatrix).normalize();

  onLogCallback("[SYSTEM] Generated default 3D laptop container.");
  onLoadCallback(laptopModel);
}

// Tương tác Raycast phát hiện chuột
export function handleMouseMove(event, camera, containerWidth, containerHeight) {
  mouse.x = (event.clientX / containerWidth) * 2 - 1;
  mouse.y = -(event.clientY / containerHeight) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);

  if (laptopModel) {
    const intersects = raycaster.intersectObject(laptopModel, true);

    if (intersects.length > 0) {
      const hitObj = intersects[0].object;
      const isScreenIntersection = (hitObj === screenMesh || hitObj.name.toLowerCase().includes('screen') || hitObj.name.toLowerCase().includes('display'));

      if (isScreenIntersection) {
        document.body.style.cursor = 'pointer';
        return true;
      }
    }
  }

  document.body.style.cursor = 'default';
  return false;
}

// Bắt sự kiện click chuột để kích hoạt zoom camera
export function handleMouseClick(event, camera, containerWidth, containerHeight, onZoomTriggered) {
  mouse.x = (event.clientX / containerWidth) * 2 - 1;
  mouse.y = -(event.clientY / containerHeight) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);

  if (laptopModel) {
    const intersects = raycaster.intersectObject(laptopModel, true);

    if (intersects.length > 0) {
      const hitObj = intersects[0].object;
      const isScreenIntersection = (hitObj === screenMesh || hitObj.name.toLowerCase().includes('screen') || hitObj.name.toLowerCase().includes('display'));

      if (isScreenIntersection) {
        onZoomTriggered();
        return true;
      }
    }
  }
  return false;
}

// Lấy tọa độ camera đích cho chế độ Tổng quan và Zoom cận cảnh
export function getCameraZoomTargets() {
  // Cần zoom thẳng vào chính diện màn hình.
  // Tính vị trí dọc theo vector pháp tuyến màn hình, cách khoảng 4.8 đơn vị.
  const distance = 4.8;
  const zoomPos = new THREE.Vector3()
    .copy(screenCenterWorld)
    .addScaledVector(screenNormalWorld, distance);

  // Khi zoom vào, tiêu điểm nhìn của camera sẽ là tâm của màn hình
  const zoomLookAt = new THREE.Vector3().copy(screenCenterWorld);

  return {
    position: zoomPos,
    target: zoomLookAt
  };
}

export function getOverviewTargets() {
  // Vị trí camera mặc định để nhìn toàn cảnh laptop
  return {
    position: new THREE.Vector3(0, 2.5, 13),
    target: new THREE.Vector3(0, 0, 0)
  };
}

// Tải mô hình Data Warehouse (Giai đoạn 2)
export function loadWarehouseModel(scene, onLoadCallback, onLogCallback) {
  onLogCallback("[LOADER] Fetching data warehouse model...");

  const loader = new GLTFLoader();

  loader.load(
    'EZ-DMT1.glb',
    (gltf) => {
      const modelGroup = gltf.scene;
      warehouseModel = new THREE.Group();
      warehouseModel.add(modelGroup);
      onLogCallback("[LOADER] Warehouse model loaded successfully. Analysing structure...");

      // Tính toán Bounding Box để căn giữa và tự động co giãn mô hình
      const box = new THREE.Box3().setFromObject(modelGroup);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());

      onLogCallback(`[LOADER] Warehouse Dimensions: W:${size.x.toFixed(2)}, H:${size.y.toFixed(2)}, D:${size.z.toFixed(2)}`);

      // Căn giữa modelGroup bên trong container warehouseModel
      modelGroup.position.copy(center).multiplyScalar(-1);

      // Co giãn mô hình về kích thước chuẩn (độ rộng khoảng 10 đơn vị)
      const maxDim = Math.max(size.x, size.y, size.z);
      const targetSize = 10;
      const scaleFactor = targetSize / maxDim;
      warehouseModel.scale.setScalar(scaleFactor);

      // Xoay 180 độ quanh Y để đổi hướng (xoay đầu) của hành lang
      warehouseModel.rotation.y = Math.PI;

      // Khởi tạo Mixer hoạt ảnh nếu có trong file GLB
      if (gltf.animations && gltf.animations.length > 0) {
        onLogCallback(`[ANIMATION] Found ${gltf.animations.length} animation clips in EZ-DMT.glb.`);
        warehouseMixer = new THREE.AnimationMixer(warehouseModel); // Đổi target sang warehouseModel để đảm bảo tương thích phân cấp
        doorOpenActions = [];

        // Tạo action cho TẤT CẢ các clip hoạt ảnh để chạy đồng thời (vấn đề Blender multi-clip)
        gltf.animations.forEach((clip, i) => {
          onLogCallback(`[ANIMATION] Preparing clip ${i}: "${clip.name}" (Duration: ${clip.duration.toFixed(2)}s)`);
          const action = warehouseMixer.clipAction(clip);
          action.setLoop(THREE.LoopOnce);
          action.clampWhenFinished = true;
          doorOpenActions.push(action);
        });
      }

      // Thiết lập bóng đổ cho các mesh trong warehouse
      warehouseModel.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      // Mặc định ẩn mô hình warehouse khi khởi tạo
      warehouseModel.visible = false;
      scene.add(warehouseModel);

      onLogCallback("[SYSTEM] Data Warehouse model configured.");
      onLoadCallback(warehouseModel);
    },
    (xhr) => {
      if (xhr.total > 0) {
        const percent = (xhr.loaded / xhr.total * 100).toFixed(0);
        onLogCallback(`[LOADER] Warehouse Progress: ${percent}%`);
      }
    },
    (err) => {
      onLogCallback(`[ERROR] Failed to load warehouse model: ${err.message}`);
    }
  );
}

export function getLaptopModel() {
  return laptopModel;
}

export function getWarehouseModel() {
  return warehouseModel;
}

export function getScreenCenterWorld() {
  return screenCenterWorld;
}

export function getAnimationMixer() {
  return warehouseMixer;
}

export function playDoorOpenAnimation() {
  console.log("playDoorOpenAnimation called! Actions count:", doorOpenActions.length);
  if (doorOpenActions && doorOpenActions.length > 0) {
    doorOpenActions.forEach((action, idx) => {
      console.log(`Action ${idx}: name="${action.getClip().name}", isRunning=${action.isRunning()}, timeScale=${action.timeScale}`);
      action.reset();
      action.play();
    });
    return true;
  }
  console.warn("No doorOpenActions found in playDoorOpenAnimation!");
  return false;
}

export function resetDoorAnimation() {
  if (doorOpenActions && doorOpenActions.length > 0) {
    doorOpenActions.forEach(action => {
      action.stop(); // Dừng hoạt ảnh, đưa cửa về trạng thái đóng ban đầu
    });
  }
  if (warehouseMixer) {
    warehouseMixer.stopAllAction(); // Đảm bảo mọi mesh được reset hoàn toàn về vị trí ban đầu
  }
}

// Khởi tạo trình xem 3D cho robot Doraemon (doraemon.glb)
export function initRobotViewer(container) {
  // Clear container
  container.innerHTML = '';
  
  const width = container.clientWidth || 320;
  const height = container.clientHeight || 240;

  // Scene
  const scene = new THREE.Scene();
  scene.background = null; // Trong suốt để hiển thị nền glassmorphism

  // Tạo môi trường phản xạ (Environment Map) từ "ice_river" để tạo bóng phản chiếu kim loại cho robot
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

  // Camera
  const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
  camera.position.set(0, 1.2, 3.8);

  // Renderer
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  // Controls
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.maxPolarAngle = Math.PI / 2 + 0.1; // Hơi thấp dưới chân đế một chút
  controls.minDistance = 1.5;
  controls.maxDistance = 10;
  controls.target.set(0, 0.6, 0);

  // Ánh sáng (Sci-Fi Lights)
  const ambientLight = new THREE.AmbientLight(0xffffff, 1.5); // Ánh sáng môi trường đều màu sáng
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 2.5);
  dirLight.position.set(5, 8, 5);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 1024;
  dirLight.shadow.mapSize.height = 1024;
  scene.add(dirLight);

  // Ánh sáng phụ dịu nhẹ (Dùng DirectionalLight thay thế PointLight để phân bổ ánh sáng đều, tránh tạo đốm sáng tròn phản chiếu trên bề mặt bóng)
  const fillLight1 = new THREE.DirectionalLight(0x00f2fe, 0.8);
  fillLight1.position.set(-6, 3, 4);
  scene.add(fillLight1);

  const fillLight2 = new THREE.DirectionalLight(0xdb2777, 0.4);
  fillLight2.position.set(6, 2, -4);
  scene.add(fillLight2);

  // Loader
  const loader = new GLTFLoader();
  let mixer = null;
  const clock = new THREE.Clock();
  let robotModel = null;
  let reqId = null;
  let isDestroyed = false;

  loader.load(
    'doraemon.glb',
    (gltf) => {
      if (isDestroyed) return;
      
      robotModel = gltf.scene;
      
      // Tính toán Bounding Box để tự động căn chỉnh tỷ lệ và định vị
      const box = new THREE.Box3().setFromObject(robotModel);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      
      // Đặt tâm của mô hình về (0, 0, 0) cục bộ
      robotModel.position.x += (robotModel.position.x - center.x);
      robotModel.position.y += (robotModel.position.y - box.min.y); // Đứng trên mặt sàn (y=0)
      robotModel.position.z += (robotModel.position.z - center.z);

      // Tự động scale để mô hình cao tầm 1.6 đơn vị
      const targetHeight = 1.6;
      const scaleFactor = targetHeight / size.y;
      robotModel.scale.setScalar(scaleFactor);

      // Thiết lập các thông số căn chỉnh mặc định do người dùng tùy chỉnh
      robotModel.position.set(0.0000, -0.4200, -0.0250);
      robotModel.rotation.y = 0.0000;
      robotModel.scale.setScalar(0.4806);
      
      // Đổ bóng cho tất cả mesh
      robotModel.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          if (child.material) {
            child.material.roughness = Math.min(child.material.roughness, 0.5);
            child.material.metalness = Math.max(child.material.metalness, 0.3);
          }
        }
      });

      scene.add(robotModel);

      // Bật Animation
      if (gltf.animations && gltf.animations.length > 0) {
        mixer = new THREE.AnimationMixer(robotModel);
        gltf.animations.forEach((clip) => {
          const action = mixer.clipAction(clip);
          action.play();
        });
      }
    },
    undefined,
    (err) => {
      console.error("Lỗi khi tải mô hình Doraemon:", err);
      container.innerHTML = `<div style="color: #ef4444; display: flex; align-items: center; justify-content: center; height: 100%; font-size: 0.9rem;">Lỗi tải mô hình 3D.</div>`;
    }
  );

  // Animation Loop
  function animate() {
    if (isDestroyed) return;
    reqId = requestAnimationFrame(animate);

    const delta = clock.getDelta();
    if (mixer) mixer.update(delta);
    if (controls) controls.update();
    
    // Tự động xoay nhẹ mô hình
    if (robotModel && !controls.state === -1) {
      robotModel.rotation.y += 0.003;
    }

    renderer.render(scene, camera);
  }
  
  animate();

  // Resize Handler
  const resizeObserver = new ResizeObserver((entries) => {
    for (let entry of entries) {
      const w = entry.contentRect.width || container.clientWidth;
      const h = entry.contentRect.height || container.clientHeight;
      if (renderer && camera) {
        renderer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
    }
  });
  resizeObserver.observe(container);

  return {
    getModel: () => robotModel,
    destroy: () => {
      isDestroyed = true;
      resizeObserver.disconnect();
      if (reqId) cancelAnimationFrame(reqId);
      if (controls) controls.dispose();
      if (envTexture) envTexture.dispose();
      if (renderer) {
        renderer.dispose();
        if (renderer.domElement && renderer.domElement.parentNode) {
          renderer.domElement.parentNode.removeChild(renderer.domElement);
        }
      }
      scene.traverse((object) => {
        if (object.isMesh) {
          if (object.geometry) object.geometry.dispose();
          if (object.material) {
            if (Array.isArray(object.material)) {
              object.material.forEach((mat) => { if (mat.dispose) mat.dispose(); });
            } else {
              if (object.material.dispose) object.material.dispose();
            }
          }
        }
      });
    }
  };
}

