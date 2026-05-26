import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Các biến trạng thái
let laptopModel = null;
let warehouseModel = null;
let screenMesh = null;

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
    'Imac_keke.glb',
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
    'datawarehouse (1).glb',
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
