"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const $ = (id) => document.getElementById(id);

  const video = $("video");
  const cameraFrame = document.querySelector(".camera-frame");
  const cameraPlaceholder = $("cameraPlaceholder");
  const startButton = $("startCamera");
  const stopButton = $("stopCamera");
  const message = $("message");

  const singleButton = $("singleMode");
  const basketButton = $("basketMode");
  const modeDescription = $("modeDescription");

  const barcodeForm = $("barcodeForm");
  const barcodeInput = $("barcodeInput");
  const searchButton = barcodeForm?.querySelector('button[type="submit"]');

  const productSection = $("productSection");
  const productDetails = $("productDetails");

  const basketSection = $("basketSection");
  const basketList = $("basketList");
  const basketTotal = $("basketTotal");
  const basketCount = $("basketCount");
  const emptyBasket = $("emptyBasket");
  const clearBasketButton = $("clearBasket");

  const requiredElements = {
    video,
    cameraFrame,
    cameraPlaceholder,
    startButton,
    stopButton,
    message,
    singleButton,
    basketButton,
    modeDescription,
    barcodeForm,
    barcodeInput,
    productSection,
    productDetails,
    basketSection,
    basketList,
    basketTotal,
    basketCount,
    emptyBasket,
    clearBasketButton
  };

  const missingElements = Object.entries(requiredElements)
    .filter(([, element]) => !element)
    .map(([name]) => name);

  if (missingElements.length) {
    alert(
      "HTML elemanları bulunamadı: " +
      missingElements.join(", ") +
      ". index.html dosyasını kontrol et."
    );
    return;
  }

  const FORMATS = [
    "ean_13",
    "ean_8",
    "upc_a",
    "upc_e",
    "code_128",
    "itf",
    "codabar"
  ];

  const COOLDOWN_MS = 1500;

  const money = new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY"
  });

  let products = new Map();
  let mode = "single";
  let stream = null;
  let detector = null;
  let scanning = false;
  let scanLoopRunning = false;
  let lastScans = new Map();
  let basket = [];
  let nextId = 1;

  function showMessage(text, type = "info") {
    message.textContent = text;
    message.className = "message";

    if (type === "error") {
      message.classList.add("error");
    } else if (type === "success") {
      message.classList.add("success");
    }
  }

  function normalizeBarcode(value) {
    return String(value ?? "").trim();
  }

  async function loadProducts() {
    try {
      showMessage("Ürün kataloğu yükleniyor...");

      const response = await fetch("./products.json", {
        cache: "no-store"
      });

      if (!response.ok) {
        throw new Error(
          "products.json yüklenemedi. HTTP " + response.status
        );
      }

      const data = await response.json();

      if (!Array.isArray(data)) {
        throw new Error("JSON içeriği bir ürün dizisi olmalıdır.");
      }

      const catalog = new Map();

      for (const p of data) {
        if (
          !p ||
          p.barcode == null ||
          typeof p.name !== "string" ||
          typeof p.brand !== "string" ||
          typeof p.category !== "string" ||
          typeof p.quantity !== "string" ||
          !Number.isFinite(Number(p.price)) ||
          Number(p.price) < 0
        ) {
          console.warn("Geçersiz ürün kaydı:", p);
          continue;
        }

        const barcode = normalizeBarcode(p.barcode);

        if (!barcode) continue;

        catalog.set(barcode, {
          ...p,
          barcode,
          price: Number(p.price)
        });
      }

      if (!catalog.size) {
        throw new Error("JSON dosyasında geçerli ürün yok.");
      }

      products = catalog;

      // Katalog yüklenince arama etkinleşir.
      barcodeInput.disabled = false;
      if (searchButton) searchButton.disabled = false;
      startButton.disabled = false;

      showMessage(
        products.size + " ürün yüklendi. Barkod girebilirsin.",
        "success"
      );
    } catch (error) {
      console.error("Katalog hatası:", error);

      // Elle giriş düğmesi kullanılabilir kalır; katalog hatası bildirilir.
      barcodeInput.disabled = false;
      if (searchButton) searchButton.disabled = false;
      startButton.disabled = false;

      showMessage(
        "Ürün kataloğu yüklenemedi: " +
        error.message +
        ". products.json dosyasını kontrol et.",
        "error"
      );
    }
  }

  function setMode(newMode) {
    mode = newMode;
    const isSingle = mode === "single";

    singleButton.classList.toggle("active", isSingle);
    basketButton.classList.toggle("active", !isSingle);

    singleButton.setAttribute("aria-pressed", String(isSingle));
    basketButton.setAttribute("aria-pressed", String(!isSingle));

    modeDescription.textContent = isSingle
      ? "Tek bir ürünün barkodını sorgula."
      : "Ürünleri sırayla okut veya barkodlarını elle gir.";

    basketSection.hidden = isSingle;

    if (!isSingle) renderBasket();

    showMessage(
      isSingle ? "Tekli Sorgu Modu." : "Sepet Modu."
    );
  }

  function renderProduct(p) {
    productDetails.replaceChildren();

    const card = document.createElement("div");
    card.className = "product-card";

    const title = document.createElement("h3");
    title.className = "product-name";
    title.textContent = p.name;

    const price = document.createElement("div");
    price.className = "product-price";
    price.textContent = money.format(p.price);

    const details = document.createElement("dl");
    details.className = "product-data";

    for (const [label, value] of [
      ["Barkod", p.barcode],
      ["Marka", p.brand],
      ["Kategori", p.category],
      ["Miktar", p.quantity]
    ]) {
      const wrapper = document.createElement("div");
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");

      dt.textContent = label;
      dd.textContent = value;

      wrapper.append(dt, dd);
      details.append(wrapper);
    }

    card.append(title, price, details);
    productDetails.append(card);
    productSection.hidden = false;
  }

  function renderBasket() {
    basketList.replaceChildren();

    const cents = basket.reduce(
      (sum, p) => sum + Math.round(p.price * 100),
      0
    );

    basketTotal.textContent = money.format(cents / 100);
    basketCount.textContent = basket.length + " ürün";
    emptyBasket.hidden = basket.length > 0;

    for (const p of basket) {
      const li = document.createElement("li");
      li.className = "basket-item";

      const info = document.createElement("div");
      info.className = "basket-item-info";

      const name = document.createElement("strong");
      name.textContent = p.name;

      const detail = document.createElement("small");
      detail.textContent =
        p.brand + " · " + p.quantity + " · " + p.barcode;

      const priceBox = document.createElement("div");
      priceBox.className = "basket-price";

      const price = document.createElement("span");
      price.textContent = money.format(p.price);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Kaldır";

      remove.addEventListener("click", () => {
        basket = basket.filter(item => item.id !== p.id);
        renderBasket();
      });

      info.append(name, detail);
      priceBox.append(price, remove);
      li.append(info, priceBox);
      basketList.append(li);
    }
  }

  function processBarcode(value, source = "manual") {
    const barcode = normalizeBarcode(value);

    if (!barcode) {
      showMessage("Lütfen barkod numarası gir.", "error");
      return;
    }

    const now = Date.now();
    const previous = lastScans.get(barcode);

    if (previous !== undefined && now - previous < COOLDOWN_MS) {
      return;
    }

    lastScans.set(barcode, now);

    for (const [key, time] of lastScans) {
      if (now - time > 60000) lastScans.delete(key);
    }

    const p = products.get(barcode);

    if (!p) {
      showMessage("Ürün bulunamadı.", "error");
      return;
    }

    if (mode === "single") {
      renderProduct(p);
      showMessage(
        p.name + " bulundu: " + money.format(p.price),
        "success"
      );
    } else {
      basket.push({ ...p, id: nextId++ });
      renderBasket();

      showMessage(
        p.name + " sepete eklendi: " + money.format(p.price),
        "success"
      );
    }

    if (source === "manual") {
      barcodeInput.value = "";
      barcodeInput.focus();
    }
  }

  barcodeForm.addEventListener("submit", event => {
    event.preventDefault();
    processBarcode(barcodeInput.value, "manual");
  });

  singleButton.addEventListener("click", () => setMode("single"));
  basketButton.addEventListener("click", () => setMode("basket"));

  clearBasketButton.addEventListener("click", () => {
    basket = [];
    renderBasket();
    showMessage("Sepet temizlendi.");
  });

  function stopCamera() {
    scanning = false;

    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }

    stream = null;
    detector = null;
    video.pause();
    video.srcObject = null;

    cameraFrame.classList.remove("scanning");
    cameraPlaceholder.hidden = false;

    startButton.disabled = false;
    stopButton.disabled = true;
  }

  function cameraError(error) {
    console.error("Kamera hatası:", error);

    if (error?.name === "NotAllowedError") {
      return "Kamera izni reddedildi. Chrome site ayarlarından izin ver.";
    }

    if (error?.name === "NotFoundError") {
      return "Kamera bulunamadı.";
    }

    if (error?.name === "NotReadableError") {
      return "Kamera başka bir uygulamada kullanılıyor olabilir.";
    }

    if (error?.name === "SecurityError") {
      return "Kamera için HTTPS bağlantısı gerekli.";
    }

    if (error?.name === "NotSupportedError") {
      return "Tarayıcı kamera veya barkod özelliğini desteklemiyor.";
    }

    return "Kamera açılamadı: " + (error?.message || "Bilinmeyen hata");
  }

  async function startCamera() {
    if (scanning) return;

    if (!navigator.mediaDevices?.getUserMedia) {
      showMessage(
        "Kamera erişimi yok. Siteyi HTTPS üzerinden aç.",
        "error"
      );
      return;
    }

    if (!("BarcodeDetector" in window)) {
      showMessage(
        "Bu Chrome sürümü BarcodeDetector API'sini desteklemiyor. Chrome'u güncelle veya barkodu elle gir.",
        "error"
      );
      return;
    }

    startButton.disabled = true;
    showMessage("Kamera başlatılıyor...");

    try {
      const supported = await window.BarcodeDetector.getSupportedFormats();
      const formats = FORMATS.filter(f => supported.includes(f));

      if (!formats.length) {
        throw new Error("Desteklenen klasik barkod formatı yok.");
      }

      detector = new window.BarcodeDetector({ formats });

      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" }
        }
      });

      video.srcObject = stream;
      await video.play();

      scanning = true;
      cameraFrame.classList.add("scanning");
      cameraPlaceholder.hidden = true;
      stopButton.disabled = false;

      showMessage("Kamera açık. Barkodu çerçeveye yerleştir.", "success");

      scanLoop();
    } catch (error) {
      stopCamera();
      showMessage(cameraError(error), "error");
    }
  }

  async function scanLoop() {
    if (scanLoopRunning) return;

    scanLoopRunning = true;

    try {
      while (scanning) {
        try {
          if (
            detector &&
            video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
          ) {
            const codes = await detector.detect(video);
            const found = codes.find(code =>
              FORMATS.includes(code.format)
            );

            if (found?.rawValue) {
              processBarcode(found.rawValue, "camera");
            }
          }
        } catch (error) {
          console.error("Tarama hatası:", error);
          showMessage("Barkod okunamadı. Kamerayı yeniden başlat.", "error");
          stopCamera();
          break;
        }

        await new Promise(resolve => setTimeout(resolve, 150));
      }
    } finally {
      scanLoopRunning = false;
    }
  }

  startButton.addEventListener("click", startCamera);
  stopButton.addEventListener("click", () => {
    stopCamera();
    showMessage("Kamera durduruldu.");
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && scanning) {
      stopCamera();
    }
  });

  window.addEventListener("pagehide", stopCamera);

  async function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;

    try {
      await navigator.serviceWorker.register("./sw.js");
    } catch (error) {
      console.warn("Service worker kaydedilemedi:", error);
    }
  }

  async function init() {
    await loadProducts();
    await registerServiceWorker();
    setMode("single");
  }

  init();
});
