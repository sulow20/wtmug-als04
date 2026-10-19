"use strict";

const video = document.getElementById("video");
const cameraFrame = document.querySelector(".camera-frame");
const cameraPlaceholder = document.getElementById("cameraPlaceholder");
const startCameraButton = document.getElementById("startCamera");
const stopCameraButton = document.getElementById("stopCamera");
const messageElement = document.getElementById("message");

const singleModeButton = document.getElementById("singleMode");
const basketModeButton = document.getElementById("basketMode");
const modeDescription = document.getElementById("modeDescription");

const barcodeForm = document.getElementById("barcodeForm");
const barcodeInput = document.getElementById("barcodeInput");

const productSection = document.getElementById("productSection");
const productDetails = document.getElementById("productDetails");

const basketSection = document.getElementById("basketSection");
const basketList = document.getElementById("basketList");
const basketTotal = document.getElementById("basketTotal");
const basketCount = document.getElementById("basketCount");
const emptyBasket = document.getElementById("emptyBasket");
const clearBasketButton = document.getElementById("clearBasket");

const SUPPORTED_FORMATS = [
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "code_128",
  "itf",
  "codabar"
];

const COOLDOWN_MS = 1500;

let productsByBarcode = new Map();
let mode = "single";
let cameraStream = null;
let detector = null;
let scanning = false;
let scanLoopRunning = false;
let lastScanTimes = new Map();

let basket = [];
let nextBasketId = 1;

const money = new Intl.NumberFormat("tr-TR", {
  style: "currency",
  currency: "TRY"
});

function showMessage(text, type = "info") {
  messageElement.textContent = text;
  messageElement.className = "message";

  if (type === "error") {
    messageElement.classList.add("error");
  } else if (type === "success") {
    messageElement.classList.add("success");
  }
}

function normalizeBarcode(value) {
  return String(value ?? "").trim();
}

async function loadProducts() {
  try {
    const response = await fetch("./products.json", {
      cache: "no-cache"
    });

    if (!response.ok) {
      throw new Error("Ürün kataloğu yüklenemedi.");
    }

    const data = await response.json();

    if (!Array.isArray(data)) {
      throw new Error("Ürün kataloğu JSON dizisi olmalıdır.");
    }

    productsByBarcode = new Map();

    for (const product of data) {
      if (
        !product ||
        typeof product.barcode !== "string" ||
        !product.barcode.trim() ||
        typeof product.name !== "string" ||
        typeof product.brand !== "string" ||
        typeof product.category !== "string" ||
        typeof product.quantity !== "string" ||
        typeof product.price !== "number" ||
        !Number.isFinite(product.price) ||
        product.price < 0
      ) {
        console.warn("Geçersiz ürün kaydı atlandı:", product);
        continue;
      }

      const barcode = normalizeBarcode(product.barcode);

      if (productsByBarcode.has(barcode)) {
        console.warn("Tekrarlanan barkod atlandı:", barcode);
        continue;
      }

      productsByBarcode.set(barcode, {
        ...product,
        barcode
      });
    }

    if (productsByBarcode.size === 0) {
      throw new Error("Katalogda geçerli ürün bulunamadı.");
    }

    showMessage(
      `${productsByBarcode.size} ürün kataloğa yüklendi.`,
      "success"
    );
  } catch (error) {
    console.error(error);
    showMessage(
      "Ürün kataloğu yüklenemedi. products.json dosyasını ve sunucuyu kontrol edin.",
      "error"
    );

    startCameraButton.disabled = true;
    barcodeInput.disabled = true;
    barcodeForm.querySelector("button").disabled = true;
  }
}

function setMode(newMode) {
  mode = newMode;

  const isSingle = mode === "single";

  singleModeButton.classList.toggle("active", isSingle);
  basketModeButton.classList.toggle("active", !isSingle);

  singleModeButton.setAttribute("aria-pressed", String(isSingle));
  basketModeButton.setAttribute("aria-pressed", String(!isSingle));

  modeDescription.textContent = isSingle
    ? "Tek bir ürünün barkodunu okut."
    : "Ürünleri sırayla okut. Her ürün sepete eklenir.";

  basketSection.hidden = isSingle;

  if (!isSingle) {
    renderBasket();
  }

  showMessage(
    isSingle
      ? "Tekli Sorgu Modu seçildi."
      : "Sepet Modu seçildi."
  );
}

singleModeButton.addEventListener("click", () => {
  setMode("single");
});

basketModeButton.addEventListener("click", () => {
  setMode("basket");
});

function renderProduct(product) {
  productDetails.replaceChildren();

  const card = document.createElement("div");
  card.className = "product-card";

  const title = document.createElement("h3");
  title.className = "product-name";
  title.textContent = product.name;

  const price = document.createElement("div");
  price.className = "product-price";
  price.textContent = money.format(product.price);

  const data = document.createElement("dl");
  data.className = "product-data";

  const fields = [
    ["Barkod", product.barcode],
    ["Marka", product.brand],
    ["Kategori", product.category],
    ["Miktar", product.quantity]
  ];

  for (const [label, value] of fields) {
    const wrapper = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");

    dt.textContent = label;
    dd.textContent = value;

    wrapper.append(dt, dd);
    data.append(wrapper);
  }

  card.append(title, price, data);
  productDetails.append(card);
  productSection.hidden = false;
}

function renderBasket() {
  basketList.replaceChildren();

  const totalCents = basket.reduce(
    (sum, item) => sum + Math.round(item.price * 100),
    0
  );

  basketTotal.textContent = money.format(totalCents / 100);
  basketCount.textContent =
    `${basket.length} ürün · ${basket.length} kalem`;

  emptyBasket.hidden = basket.length > 0;

  for (const item of basket) {
    const li = document.createElement("li");
    li.className = "basket-item";

    const info = document.createElement("div");
    info.className = "basket-item-info";

    const name = document.createElement("strong");
    name.textContent = item.name;

    const detail = document.createElement("small");
    detail.textContent =
      `${item.brand} · ${item.quantity} · ${item.barcode}`;

    const priceArea = document.createElement("div");
    priceArea.className = "basket-price";

    const price = document.createElement("span");
    price.textContent = money.format(item.price);

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.textContent = "Kaldır";
    removeButton.setAttribute(
      "aria-label",
      `${item.name} ürününü sepetten kaldır`
    );

    removeButton.addEventListener("click", () => {
      basket = basket.filter(entry => entry.id !== item.id);
      renderBasket();
    });

    info.append(name, detail);
    priceArea.append(price, removeButton);
    li.append(info, priceArea);
    basketList.append(li);
  }
}

function processBarcode(rawBarcode, source = "manual") {
  const barcode = normalizeBarcode(rawBarcode);

  if (!barcode) {
    showMessage("Lütfen bir barkod numarası girin.", "error");
    return;
  }

  const now = Date.now();
  const previousTime = lastScanTimes.get(barcode) ?? 0;

  // Aynı barkod 1,5 saniye içinde tekrar işlenmez.
  if (now - previousTime < COOLDOWN_MS) {
    return;
  }

  lastScanTimes.set(barcode, now);

  // Bellek kullanımını sınırlamak için eski kayıtları temizle.
  for (const [key, time] of lastScanTimes) {
    if (now - time > 60_000) {
      lastScanTimes.delete(key);
    }
  }

  const product = productsByBarcode.get(barcode);

  if (!product) {
    showMessage("Ürün bulunamadı.", "error");
    return;
  }

  if (mode === "single") {
    renderProduct(product);
    showMessage(
      `${product.name} bulundu: ${money.format(product.price)}`,
      "success"
    );
  } else {
    basket.push({
      ...product,
      id: nextBasketId++
    });

    renderBasket();

    showMessage(
      `${product.name} sepete eklendi: ${money.format(product.price)}`,
      "success"
    );
  }

  if (source === "manual") {
    barcodeInput.value = "";
  }
}

barcodeForm.addEventListener("submit", event => {
  event.preventDefault();
  processBarcode(barcodeInput.value, "manual");
});

clearBasketButton.addEventListener("click", () => {
  basket = [];
  renderBasket();
  showMessage("Sepet temizlendi.");
});

function getCameraErrorMessage(error) {
  if (error?.name === "NotAllowedError" ||
      error?.name === "PermissionDeniedError") {
    return "Kamera izni reddedildi. Tarayıcı ayarlarından bu site için kamera izni verin veya barkodu elle girin.";
  }

  if (error?.name === "NotFoundError") {
    return "Kullanılabilir kamera bulunamadı. Barkodu elle girebilirsiniz.";
  }

  if (error?.name === "NotReadableError") {
    return "Kamera başka bir uygulama tarafından kullanılıyor olabilir. Diğer uygulamaları kapatıp tekrar deneyin.";
  }

  if (error?.name === "OverconstrainedError") {
    return "İstenen kamera ayarları desteklenmiyor. Varsayılan kamera ile tekrar deneyin.";
  }

  return "Kamera başlatılamadı. HTTPS bağlantısını ve tarayıcı izinlerini kontrol edin.";
}

async function startCamera() {
  if (scanning) return;

  if (!navigator.mediaDevices?.getUserMedia) {
    showMessage(
      "Kamera erişimi kullanılamıyor. HTTPS veya localhost üzerinden açın ve barkodu elle girin.",
      "error"
    );
    return;
  }

  if (!("BarcodeDetector" in window)) {
    showMessage(
      "Bu tarayıcı BarcodeDetector API'sini desteklemiyor. Desteklenen bir tarayıcı deneyin veya barkodu elle girin.",
      "error"
    );
    return;
  }

  try {
    startCameraButton.disabled = true;
    showMessage("Kamera hazırlanıyor...");

    const supported =
      await window.BarcodeDetector.getSupportedFormats();

    const formats = SUPPORTED_FORMATS.filter(
      format => supported.includes(format)
    );

    if (formats.length === 0) {
      throw new Error(
        "Bu tarayıcıda desteklenen klasik barkod formatı bulunamadı."
      );
    }

    detector = new window.BarcodeDetector({ formats });

    cameraStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    });

    video.srcObject = cameraStream;
    await video.play();

    scanning = true;
    cameraFrame.classList.add("scanning");
    cameraPlaceholder.hidden = true;

    startCameraButton.disabled = true;
    stopCameraButton.disabled = false;

    showMessage(
      "Kamera açık. Barkodu çerçeve içine yerleştirin.",
      "success"
    );

    scanLoop();
  } catch (error) {
    console.error("Kamera hatası:", error);

    stopCamera();

    showMessage(
      error instanceof Error &&
      error.message.includes("klasik barkod formatı")
        ? error.message
        : getCameraErrorMessage(error),
      "error"
    );
  } finally {
    if (!scanning) {
      startCameraButton.disabled = false;
    }
  }
}

async function scanLoop() {
  if (scanLoopRunning) return;

  scanLoopRunning = true;

  try {
    while (scanning) {
      if (
        detector &&
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        video.videoWidth > 0
      ) {
        try {
          const detected = await detector.detect(video);

          if (detected.length > 0) {
            // İlk klasik barkod kullanılır; QR formatı etkin değildir.
            const code = detected.find(item =>
              SUPPORTED_FORMATS.includes(item.format)
            );

            if (code?.rawValue) {
              processBarcode(code.rawValue, "camera");
            }
          }
        } catch (error) {
          console.error("Barkod algılama hatası:", error);

          showMessage(
            "Barkod okunurken bir hata oluştu. Kamerayı yeniden başlatmayı deneyin.",
            "error"
          );

          stopCamera();
          break;
        }
      }

      // Cihazı gereksiz yere sürekli meşgul etmemek için.
      await new Promise(resolve => setTimeout(resolve, 120));
    }
  } finally {
    scanLoopRunning = false;
  }
}

function stopCamera() {
  scanning = false;

  if (cameraStream) {
    for (const track of cameraStream.getTracks()) {
      track.stop();
    }
  }

  cameraStream = null;
  detector = null;
  video.pause();
  video.srcObject = null;

  cameraFrame.classList.remove("scanning");
  cameraPlaceholder.hidden = false;

  startCameraButton.disabled = productsByBarcode.size === 0;
  stopCameraButton.disabled = true;
}

startCameraButton.addEventListener("click", startCamera);
stopCameraButton.addEventListener("click", stopCamera);

document.addEventListener("visibilitychange", () => {
  if (document.hidden && scanning) {
    stopCamera();
    showMessage(
      "Kamera durduruldu. Devam etmek için kamerayı yeniden başlatın."
    );
  }
});

window.addEventListener("pagehide", stopCamera);

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  try {
    await navigator.serviceWorker.register("./sw.js");
  } catch (error) {
    console.error("Service worker kaydı başarısız:", error);
  }
}

async function init() {
  await loadProducts();
  await registerServiceWorker();
  setMode("single");
}

startCameraButton.addEventListener("click", () => {
  alert("Kamera butonu çalışıyor!");
});
console.log("MARKETIM JS ÇALIŞIYOR");
 init();
