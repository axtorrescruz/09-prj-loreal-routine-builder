const workerUrl = "https://loreal-worker.axtorr7701.workers.dev/"; // Cloudflare Worker endpoint (single source-of-truth)

/* ---------------- DOM references ---------------- */
const searchInput = document.getElementById("searchInput");
const categoryFilter = document.getElementById("categoryFilter");
const productsContainer = document.getElementById("productsContainer");
const selectedProductsList = document.getElementById("selectedProductsList");
const generateRoutineBtn = document.getElementById("generateRoutine");
const clearAllBtn = document.getElementById("clearAllBtn");
const showMoreBtn = document.getElementById("showMoreBtn");
// additional button parts inside the generate button and copy button
const btnSpinner =
  generateRoutineBtn && generateRoutineBtn.querySelector(".btn-spinner");
const btnLabel =
  generateRoutineBtn && generateRoutineBtn.querySelector(".btn-label");
const copyRoutineBtn = document.getElementById("copyRoutineBtn");
const sendBtn = document.getElementById("sendBtn");

const chatForm = document.getElementById("chatForm");
const userInput = document.getElementById("userInput");
const chatWindow = document.getElementById("chatWindow");

/* ---------------- Application state ---------------- */
let products = []; // full products list from products.json
let selectedProductIds = []; // array of numeric ids
let conversationHistory = []; // { role: 'user'|'assistant' , content: '...' }
let productsToShow = 9; // pagination: how many products to show initially and increment
let expandedProductIds = new Set(); // track expanded details so they survive re-renders
let lastRoutineText = ""; // store last generated routine for copy-to-clipboard

const LOCAL_KEY = "selectedProducts"; // localStorage key

/* ---------------- Utility helpers ---------------- */
function saveSelectedToLocalStorage() {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(selectedProductIds));
  } catch (err) {
    console.warn(
      "localStorage not available, falling back to in-memory storage.",
      err
    );
  }
}

function loadSelectedFromLocalStorage() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (err) {
    console.warn("Could not read selected products from localStorage", err);
    return [];
  }
}

function debounce(fn, wait = 200) {
  let t;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
}

/* ---------------- Product loading & rendering ---------------- */
async function loadProducts() {
  // Fetch product data from products.json in the project.
  try {
    const res = await fetch("products.json");
    const data = await res.json();
    products = data.products || [];
    return products;
  } catch (err) {
    console.error("Failed to load products.json", err);
    productsContainer.innerHTML = `<div class="placeholder-message">Failed to load products.</div>`;
    products = [];
    return products;
  }
}

function getFilteredProducts() {
  // Apply category + search filters together.
  const category = categoryFilter.value || "";
  const query = (searchInput.value || "").trim().toLowerCase();

  return products.filter((p) => {
    const matchesCategory = !category || p.category === category;
    const hay = `${p.name} ${p.brand} ${p.description}`.toLowerCase();
    const matchesQuery = !query || hay.includes(query);
    return matchesCategory && matchesQuery;
  });
}

function detectAndSetDirection() {
  // Determine page direction from HTML lang or browser locale.
  const rtlLangs = ["ar", "he", "fa", "ur", "ps", "dv", "syr"];
  const lang = (
    document.documentElement.lang ||
    navigator.language ||
    "en"
  ).toLowerCase();
  const prefix = lang.split("-")[0];
  const isRtl = rtlLangs.includes(prefix);
  document.documentElement.dir = isRtl ? "rtl" : "ltr";
  document.body.classList.toggle("rtl", isRtl);
}

// helper to check runtime direction (used by render functions)
function isPageRtl() {
  return String(document.documentElement.dir || "").toLowerCase() === "rtl";
}

function renderProductGrid() {
  const allList = getFilteredProducts();
  if (!allList.length) {
    productsToShow = 9; // reset
    productsContainer.innerHTML = `<div class="placeholder-message">No matching products.</div>`;
    if (showMoreBtn) showMoreBtn.style.display = "none";
    return;
  }

  const total = allList.length;
  let list = allList.slice(0, productsToShow);

  // Use CSS 'direction' to flip the visual flow for RTL.
  if (productsContainer) {
    productsContainer.style.direction = isPageRtl() ? "rtl" : "ltr";
  }

  productsContainer.innerHTML = list
    .map((p) => {
      const isSelected = selectedProductIds.includes(p.id);
      const isExpanded = expandedProductIds.has(p.id);
      return `
      <article class="product-card ${isSelected ? "selected" : ""}" data-id="${
        p.id
      }" tabindex="0" role="button" aria-pressed="${isSelected}">
        <div class="product-media">
          <img src="${p.image}" alt="${p.name}" />
        </div>
        <div class="product-body">
          <h3 class="product-name">${p.name}</h3>
          <p class="product-brand">${p.brand}</p>
          <div class="product-actions">
            <button class="info-btn" aria-expanded="${isExpanded}" aria-controls="desc-${
        p.id
      }">Details</button>
          </div>
          <div id="desc-${p.id}" class="product-desc ${
        isExpanded ? "open" : ""
      }" aria-hidden="${!isExpanded}">${escapeHtml(p.description)}</div>
        </div>
        <div class="select-badge" aria-hidden="true">${
          isSelected ? '<i class="fa-solid fa-check"></i>' : ""
        }</div>
      </article>`;
    })
    .join("\n");

  // Show or hide the Show More button depending on whether there are more products
  if (showMoreBtn) {
    if (productsToShow < total) {
      showMoreBtn.style.display = "block";
    } else {
      showMoreBtn.style.display = "none";
    }
  }

  // Attach event handlers for cards after DOM is updated.
  attachProductCardHandlers();
}

function escapeHtml(text) {
  // minimal escape for product descriptions inserted as HTML
  return (text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function attachProductCardHandlers() {
  const cards = productsContainer.querySelectorAll(".product-card");
  cards.forEach((card) => {
    const id = Number(card.dataset.id);

    // click toggles selection
    card.addEventListener("click", (e) => {
      // ignore clicks on the info button
      if (e.target.closest(".info-btn")) return;
      toggleSelect(id);
    });

    // keyboard accessibility: Enter/Space toggles selection
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleSelect(id);
      }
    });

    // info button toggles description and persist state in expandedProductIds
    const infoBtn = card.querySelector(".info-btn");
    const desc = card.querySelector(".product-desc");
    if (infoBtn && desc) {
      infoBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const currentlyExpanded = expandedProductIds.has(id);
        if (currentlyExpanded) {
          expandedProductIds.delete(id);
        } else {
          expandedProductIds.add(id);
        }
        const nowExpanded = expandedProductIds.has(id);
        // update DOM attributes/classes for the toggled product only
        infoBtn.setAttribute("aria-expanded", String(nowExpanded));
        desc.setAttribute("aria-hidden", String(!nowExpanded));
        desc.classList.toggle("open", nowExpanded);
      });
    }
  });
}

/* ---------------- Selection handling ---------------- */
function toggleSelect(productId) {
  const idx = selectedProductIds.indexOf(productId);
  if (idx === -1) {
    selectedProductIds.push(productId);
  } else {
    selectedProductIds.splice(idx, 1);
  }
  saveSelectedToLocalStorage();
  renderProductGrid();
  renderSelectedProducts();
}

function renderSelectedProducts() {
  if (!selectedProductIds.length) {
    selectedProductsList.innerHTML = `<div class="placeholder-message">No products selected yet.</div>`;
    return;
  }

  const nodes = selectedProductIds
    .map((id) => products.find((p) => p.id === id))
    .filter(Boolean)
    .map(
      (p) => `
      <div class="selected-chip" data-id="${p.id}">
        <img src="${p.image}" alt="${p.name}" />
        <div class="chip-info">
          <div class="chip-name">${p.name}</div>
          <div class="chip-brand">${p.brand}</div>
        </div>
        <button class="remove-chip" aria-label="Remove ${p.name}">&times;</button>
      </div>`
    )
    .join("\n");

  selectedProductsList.innerHTML = nodes;

  // attach remove handlers
  const removeBtns = selectedProductsList.querySelectorAll(".remove-chip");
  removeBtns.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const card = e.target.closest(".selected-chip");
      const id = Number(card.dataset.id);
      selectedProductIds = selectedProductIds.filter((x) => x !== id);
      saveSelectedToLocalStorage();
      renderSelectedProducts();
      renderProductGrid();
    });
  });
}

function clearAllSelections() {
  selectedProductIds = [];
  saveSelectedToLocalStorage();
  renderSelectedProducts();
  renderProductGrid();
}

/* ---------------- Worker integration ---------------- */
async function callWorker(messages) {
  // messages is an array of { role, content }
  // The Cloudflare Worker is responsible for contacting OpenAI securely.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(workerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`Worker error: ${res.status}`);
    const data = await res.json();

    // expected: data.choices[0].message.content
    const content =
      data?.choices?.[0]?.message?.content ?? data?.result ?? null;
    if (!content) {
      console.error("Unexpected worker response:", data);
      throw new Error("Unexpected response from worker");
    }
    return content;
  } catch (err) {
    clearTimeout(timeout);
    console.error("callWorker failed", err);
    throw err;
  }
}

/* ---------------- Chat & routine generation ---------------- */
function renderChat() {
  chatWindow.innerHTML = conversationHistory
    .map((m) => {
      const cls = m.role === "assistant" ? "msg-assistant" : "msg-user";
      return `<div class="chat-message ${cls}"><div class="msg-content">${escapeHtml(
        m.content
      )}</div></div>`;
    })
    .join("\n");
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

async function generateRoutine() {
  if (!selectedProductIds.length) {
    // show friendly message in chat
    conversationHistory.push({
      role: "assistant",
      content:
        "Please select one or more products before generating a routine.",
    });
    renderChat();
    return;
  }

  // Build minimal product payload
  const selectedProductData = selectedProductIds
    .map((id) => products.find((p) => p.id === id))
    .filter(Boolean)
    .map((p) => ({
      name: p.name,
      brand: p.brand,
      category: p.category,
      description: p.description,
    }));

  // System + user messages - keep concise and explicit
  const messages = [
    {
      role: "system",
      content:
        "You are a helpful beauty advisor that crafts clear step-by-step routines using given products.",
    },
    {
      role: "user",
      content: `Create a personalized, step-by-step routine using only these selected products. Be concise and include when to use each item (AM/PM or pre/post styling), and any important cautions. Products: ${JSON.stringify(
        selectedProductData
      )}`,
    },
  ];

  // push a 'generating...' placeholder to the chat
  conversationHistory.push({
    role: "assistant",
    content: "Generating your personalized routine…",
  });
  renderChat();

  // show spinner / disable generate button while the worker runs
  if (generateRoutineBtn) generateRoutineBtn.disabled = true;
  if (btnSpinner) btnSpinner.hidden = false;
  if (btnLabel) btnLabel.textContent = "Generating…";

  try {
    const assistantText = await callWorker(messages);
    // replace the last assistant placeholder with real content
    // (simple approach: remove last and push real response)
    if (
      conversationHistory.length &&
      conversationHistory[conversationHistory.length - 1].content.includes(
        "Generating your personalized routine"
      )
    ) {
      conversationHistory.pop();
    }
    const trimmed = assistantText.trim();
    // store for copy-to-clipboard
    lastRoutineText = trimmed;
    if (copyRoutineBtn) copyRoutineBtn.disabled = false;

    conversationHistory.push({ role: "assistant", content: trimmed });
    renderChat();
  } catch (err) {
    conversationHistory.push({
      role: "assistant",
      content:
        "Sorry — I couldn't generate the routine right now. Please try again.",
    });
    renderChat();
  } finally {
    // restore button state
    if (btnSpinner) btnSpinner.hidden = true;
    if (btnLabel) btnLabel.textContent = "Generate Routine";
    if (generateRoutineBtn) generateRoutineBtn.disabled = false;
  }
}

chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = (userInput.value || "").trim();
  if (!text) return;
  // append user message and render immediately
  conversationHistory.push({ role: "user", content: text });
  renderChat();
  userInput.value = "";

  // Limit history sent to worker to the last N messages to control tokens
  const N = 12;
  const messagesToSend = conversationHistory.slice(-N);

  try {
    const assistantText = await callWorker(messagesToSend);
    conversationHistory.push({
      role: "assistant",
      content: assistantText.trim(),
    });
    renderChat();
  } catch (err) {
    conversationHistory.push({
      role: "assistant",
      content: "Sorry — I couldn't reach the server. Try again.",
    });
    renderChat();
  }
});

// copy-to-clipboard handler for last generated routine
if (copyRoutineBtn) {
  copyRoutineBtn.addEventListener("click", async () => {
    if (!lastRoutineText) {
      alert("No generated routine available to copy.");
      return;
    }
    try {
      await navigator.clipboard.writeText(lastRoutineText);
      // small, simple feedback for beginners
      alert("Routine copied to clipboard.");
    } catch (err) {
      console.warn("Copy failed", err);
      alert(
        "Could not copy to clipboard. You can select the routine text and copy manually."
      );
    }
  });
}

/* ---------------- Initialization & event wiring ---------------- */
generateRoutineBtn.addEventListener("click", generateRoutine);
clearAllBtn.addEventListener("click", () => {
  if (confirm("Clear all selected products?")) clearAllSelections();
});

// filtering handlers
categoryFilter.addEventListener("change", () => {
  productsToShow = 9; // reset page when filter changes
  renderProductGrid();
});
searchInput.addEventListener(
  "input",
  debounce(() => {
    productsToShow = 9; // reset page when search changes
    renderProductGrid();
  }, 200)
);

if (showMoreBtn) {
  showMoreBtn.addEventListener("click", () => {
    productsToShow += 9;
    renderProductGrid();
  });
}

// restore selections on load and render initial UI
(async function init() {
  await loadProducts();
  selectedProductIds = loadSelectedFromLocalStorage()
    .map(Number)
    .filter(Boolean);
  // detect document direction before rendering
  detectAndSetDirection();
  // ensure UI defaults (no unintended loading states)
  if (btnSpinner) btnSpinner.hidden = true;
  if (btnLabel) btnLabel.textContent = "Generate Routine";
  if (copyRoutineBtn) copyRoutineBtn.disabled = true;

  renderProductGrid();
  renderSelectedProducts();
  // init empty chat message
  conversationHistory.push({
    role: "assistant",
    content:
      'Hi — select products and click "Generate Routine" to get started. Ask follow-up questions after a routine is generated.',
  });
  renderChat();
})();

const observer = new MutationObserver(() => {
    const sample = document.querySelector(".selection");

    if (!sample) return;

    const original = sample.getAttribute("data-original");

    // Browser translation changed the text → apply RTL layout
    if (original && sample.textContent.trim() !== original.trim()) {
        document.documentElement.setAttribute("dir", "rtl");
        document.body.classList.add("translated-rtl");
        observer.disconnect();
    }
});

// Save each element’s original text so we can detect translation
document.querySelectorAll(".selection").forEach(el => {
    el.setAttribute("data-original", el.textContent);
});

// Start monitoring the page for auto-translation
observer.observe(document.body, { childList: true, subtree: true });