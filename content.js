// content.js - Sleek Text Replacer
(function () {
  let rules = [];
  let selectionActive = false;
  let highlightEl = null;
  let modalEl = null;
  let previewOverlays = [];
  let lastSnapshot = null;

  /* ---------------- helpers ---------------- */
  function log(...args) { console.log("TextReplacer:", ...args); }

  function loadRules(cb) {
    chrome.storage.sync.get(["replacements"], (d) => {
      rules = Array.isArray(d.replacements) ? d.replacements : [];
      cb && cb();
    });
  }
  function saveRules(cb) {
    chrome.storage.sync.set({ replacements: rules }, () => cb && cb());
  }

  function isIgnoredElement(el) {
    if (!el || !el.nodeType) return true;
    const tag = el.nodeName;
    if (!tag) return true;
    const skip = ["SCRIPT", "STYLE", "NOSCRIPT", "IFRAME"];
    if (skip.includes(tag)) return true;
    if (el.isContentEditable) return true;
    return false;
  }
  function isVisibleElement(el) {
    try {
      const cs = window.getComputedStyle(el);
      if (!cs) return true;
      if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") return false;
      const r = el.getBoundingClientRect();
      return !(r.width === 0 && r.height === 0);
    } catch { return true; }
  }
  function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  function getCssSelector(el) {
    if (!(el instanceof Element)) return;
    const path = [];
    while (el.nodeType === Node.ELEMENT_NODE) {
      let selector = el.nodeName.toLowerCase();
      if (el.id) {
        selector += '#' + el.id.replace(/(:|\.|\[|\]|,|=)/g, '\\$1');
        path.unshift(selector);
        break; // ID is unique
      } else {
        let sib = el, nth = 1;
        while (sib = sib.previousElementSibling) {
          if (sib.nodeName.toLowerCase() === selector) nth++;
        }
        if (nth !== 1) selector += `:nth-of-type(${nth})`;
      }
      path.unshift(selector);
      el = el.parentNode;
    }
    return path.join(" > ");
  }

  /* ---------------- highlight box ---------------- */
  function createHighlightBox() {
    if (highlightEl) return;
    highlightEl = document.createElement("div");
    Object.assign(highlightEl.style, {
      position: "fixed",
      border: "2px solid #4cafef",
      borderRadius: "8px",
      pointerEvents: "none",
      zIndex: 2147483647,
      boxShadow: "0 0 10px rgba(76, 175, 239, 0.6)",
      transition: "all 0.15s ease"
    });

    const tip = document.createElement("div");
    tip.textContent = "✨ Click to replace text";
    Object.assign(tip.style, {
      position: "absolute",
      bottom: "100%",
      left: "50%",
      transform: "translate(-50%, -6px)",
      background: "rgba(0,0,0,0.75)",
      color: "#fff",
      padding: "2px 6px",
      borderRadius: "4px",
      fontSize: "11px",
      fontFamily: "Segoe UI, sans-serif",
      whiteSpace: "nowrap",
      pointerEvents: "none"
    });
    highlightEl.appendChild(tip);

    document.documentElement.appendChild(highlightEl);
  }
  function removeHighlightBox() {
    if (highlightEl) { highlightEl.remove(); highlightEl = null; }
  }

  /* ---------------- selection mode ---------------- */
  function startSelectionMode() {
    if (selectionActive) return;
    selectionActive = true;
    createHighlightBox();
    document.body.style.cursor = "crosshair";

    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown, true);
  }
  function stopSelectionMode() {
    selectionActive = false;
    removeHighlightBox();
    document.body.style.cursor = "";
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKeyDown, true);
    clearPreviewOverlays();
    closeModal();
  }
  function onMouseMove(e) {
    try {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || isIgnoredElement(el) || !isVisibleElement(el)) {
        highlightEl && (highlightEl.style.display = "none");
        return;
      }
      const rect = el.getBoundingClientRect();
      highlightEl.style.display = "block";
      Object.assign(highlightEl.style, {
        top: rect.top + "px",
        left: rect.left + "px",
        width: rect.width + "px",
        height: rect.height + "px",
      });
    } catch {}
  }
  function onClick(e) {
    if (modalEl && modalEl.contains(e.target)) return; // ignore clicks inside modal
    e.preventDefault();
    e.stopPropagation();
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el) return;
    const text = (window.getSelection().toString().trim() || el.innerText || "").trim();
    if (!text) return;
    const selector = getCssSelector(el);
    openModal(text, selector);
  }
  function onKeyDown(e) {
    if (e.key === "Escape") stopSelectionMode();
  }

  /* ---------------- modal ---------------- */
  function createModal() {
    if (modalEl) return modalEl;
    modalEl = document.createElement("div");
    Object.assign(modalEl.style, {
      position: "fixed",
      zIndex: 2147483647,
      left: "50%",
      top: "50%",
      transform: "translate(-50%, -50%) scale(1)",
      width: "420px",
      maxWidth: "90vw",
      background: "rgba(255, 255, 255, 0.85)",
      backdropFilter: "blur(12px) saturate(180%)",
      borderRadius: "16px",
      boxShadow: "0 8px 40px rgba(0,0,0,0.25)",
      padding: "20px",
      fontFamily: "Inter, Segoe UI, sans-serif",
      color: "#222",
      animation: "tr-fadein 0.2s ease"
    });

    if (!document.getElementById("tr-style")) {
      const styleTag = document.createElement("style");
      styleTag.id = "tr-style";
      styleTag.textContent = `
      @keyframes tr-fadein {
        from { opacity: 0; transform: translate(-50%, -50%) scale(0.95); }
        to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
      }
      button.tr-btn {
        padding: 8px 14px;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 13px;
        transition: background 0.2s ease, opacity 0.2s ease;
      }
      button.tr-btn:hover { opacity: 0.9; }
      button.tr-green { background: #4caf50; color: #fff; }
      button.tr-yellow { background: #ffb300; color: #fff; }
      button.tr-red { background: #e53935; color: #fff; }
      button.tr-gray { background: #e0e0e0; color: #111; }
      `;
      document.head.appendChild(styleTag);
    }

    document.documentElement.appendChild(modalEl);
    return modalEl;
  }
  function closeModal() { if (modalEl) { modalEl.remove(); modalEl = null; } }

  function openModal(token, selector) {
    createModal();
    modalEl.innerHTML = `
      <h2 style="margin:0 0 10px;font-size:18px;">Replace Text</h2>
      <div style="margin-bottom:10px;">
        <div style="font-size:13px;margin-bottom:4px;">Selected token:</div>
        <div id="tr-selected-token" style="padding:6px 10px;border-radius:8px;background:#f9f9f9;border:1px solid #ddd">${token}</div>
      </div>
      <input id="tr-input" placeholder="Replacement text" 
        style="width:100%;padding:10px;border-radius:8px;border:1px solid #ccc;margin-bottom:12px;" />
      <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;margin-bottom:12px;">
        <button id="tr-preview" class="tr-btn tr-yellow">Preview</button>
        <button id="tr-apply" class="tr-btn tr-green">Apply</button>
        <button id="tr-undo" class="tr-btn tr-red">Undo</button>
        <button id="tr-done" class="tr-btn tr-gray">Done</button>
      </div>
      <div id="tr-saved" style="font-size:13px;color:#333">Saved replacements:</div>
    `;

    modalEl.querySelector("#tr-preview").onclick = () => previewMatches(token, selector);
    modalEl.querySelector("#tr-apply").onclick = () => applyReplacement(token, selector);
    modalEl.querySelector("#tr-undo").onclick = () => undoLast();
    modalEl.querySelector("#tr-done").onclick = () => { closeModal(); stopSelectionMode(); };
    renderSaved();
  }

  /* ---------------- replacements ---------------- */
  function previewMatches(token, selector) {
    clearPreviewOverlays();
    const matches = findMatches(token, selector);
    matches.forEach(m => m.rects.forEach(r => {
      const o = document.createElement("div");
      Object.assign(o.style, {
        position: "fixed",
        left: r.left + "px",
        top: r.top + "px",
        width: r.width + "px",
        height: r.height + "px",
        background: "rgba(255, 235, 59, 0.4)",
        border: "1px solid rgba(255,193,7,0.6)",
        zIndex: 2147483646,
        borderRadius: "2px",
        pointerEvents: "none",
        animation: "pulse 1.2s infinite"
      });
      previewOverlays.push(o);
      document.documentElement.appendChild(o);
    }));
    if (!document.getElementById("tr-pulse-style")) {
      const s = document.createElement("style");
      s.id = "tr-pulse-style";
      s.textContent = `
      @keyframes pulse {
        0% { opacity: 0.6; }
        50% { opacity: 1; }
        100% { opacity: 0.6; }
      }`;
      document.head.appendChild(s);
    }
  }
  function clearPreviewOverlays() { previewOverlays.forEach(o => o.remove()); previewOverlays = []; }

  function applyReplacement(token, selector) {
    clearPreviewOverlays();
    const replacement = modalEl.querySelector("#tr-input").value.trim();
    if (!replacement) return;
    const matches = findMatches(token, selector);
    lastSnapshot = matches.map(m => ({ node: m.node, old: m.node.nodeValue }));
    matches.forEach(m => {
      m.node.nodeValue = m.node.nodeValue.replace(new RegExp(escapeRegExp(token), "gi"), replacement);
    });
    const newRule = {
      original: token,
      replacement,
      hostname: window.location.hostname,
      selector
    };
    const idx = rules.findIndex(r => r.hostname === newRule.hostname && r.selector === newRule.selector && r.original === newRule.original);
    if (idx >= 0) rules[idx] = newRule;
    else rules.push(newRule);
    saveRules(() => renderSaved());
  }
  function undoLast() {
    if (!lastSnapshot) return;
    lastSnapshot.forEach(s => { try { s.node.nodeValue = s.old; } catch {} });
    lastSnapshot = null;
  }

  function renderSaved() {
    const div = modalEl.querySelector("#tr-saved");
    div.innerHTML = "<b>Saved replacements:</b><br>";
    if (!rules.length) { div.innerHTML += "None yet."; return; }
    const pageRules = rules.filter(r => r.hostname === window.location.hostname);
    pageRules.forEach((r,i) => {
      const row = document.createElement("div");
      row.textContent = `"${r.original}" → "${r.replacement}" (on this page)`;
      const del = document.createElement("button");
      del.textContent = "×";
      del.className = "tr-btn tr-red";
      del.style.padding = "2px 6px";
      del.onclick = () => { rules.splice(i,1); saveRules(()=>renderSaved()); };
      row.appendChild(del);
      div.appendChild(row);
    });
  }

  function findMatches(token, selector) {
    const out = [];
    const re = new RegExp(escapeRegExp(token), "gi");
    let rootElement = document.body;
    if (selector) {
      try {
        rootElement = document.querySelector(selector) || document.body;
      } catch (e) { console.error("TextReplacer: Invalid selector", selector); }
    }

    const walker = document.createTreeWalker(rootElement, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (!n.nodeValue) return NodeFilter.FILTER_REJECT;
        const p = n.parentNode;
        if (!p) return NodeFilter.FILTER_REJECT;
        if ((modalEl && modalEl.contains(p)) || (highlightEl && highlightEl.contains(p))) return NodeFilter.FILTER_REJECT;
        if (isIgnoredElement(p) || !isVisibleElement(p)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let n;
    while ((n = walker.nextNode())) {
      let m;
      while ((m = re.exec(n.nodeValue)) !== null) {
        const range = document.createRange();
        range.setStart(n, m.index);
        range.setEnd(n, m.index + m[0].length);
        out.push({ node: n, rects: Array.from(range.getClientRects()) });
      }
    }
    return out;
  }

  /* ---------------- auto-apply saved rules ---------------- */
  function applyAllRules(root=document.body) {
    const pageRules = rules.filter(r => r.hostname === window.location.hostname);
    if (!pageRules.length) return;

    pageRules.forEach(r => {
      let targetElement;
      try {
        targetElement = root.matches(r.selector) ? root : root.querySelector(r.selector);
      } catch (e) { return; } // Invalid selector

      if (!targetElement) return;

      const walker = document.createTreeWalker(targetElement, NodeFilter.SHOW_TEXT, {
        acceptNode(n) {
          if (!n.nodeValue || !n.parentNode || isIgnoredElement(n.parentNode)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });

      let n;
      while ((n = walker.nextNode())) {
        const re = new RegExp(escapeRegExp(r.original), "gi");
        if (re.test(n.nodeValue)) {
          n.nodeValue = n.nodeValue.replace(re, r.replacement);
        }
      }
    });
  }
  function observeDOM() {
    const obs = new MutationObserver(muts => {
      muts.forEach(m => m.addedNodes.forEach(n => {
        if (n.nodeType === 1) applyAllRules(n);
      }));
    });
    obs.observe(document.body, {childList:true,subtree:true});
  }

  /* ---------------- messages ---------------- */
  chrome.runtime.onMessage.addListener((msg,_,res)=>{
    if (msg.action==="startSelection") { startSelectionMode(); res({ok:true}); }
    if (msg.action==="refreshReplacements") { loadRules(()=>applyAllRules()); res({ok:true}); }
  });

  /* ---------------- init ---------------- */
  loadRules(()=>{ applyAllRules(); observeDOM(); });
})();
