/**
 * Vanilla-DOM overlay widgets shared across pages (SPEC §6.4 / SRS US-09~14):
 * the exclude bottom-sheet, the block-confirmation dialog, and the undo toast.
 * Each renders into a dedicated <div id="overlay-root"> every page must have.
 */

function overlayRoot() {
  let root = document.getElementById("overlay-root");
  if (!root) {
    root = document.createElement("div");
    root.id = "overlay-root";
    document.body.appendChild(root);
  }
  return root;
}

function clearOverlay() {
  overlayRoot().innerHTML = "";
}

const ICON_EVENT = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 15l6-6M9 9h6v6"/></svg>`;
const ICON_ARTIST = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="3.4"/><path d="M5 20c0-3.9 3.1-6.5 7-6.5s7 2.6 7 6.5"/></svg>`;
const ICON_TYPE = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 7h7l2-3h4l2 3h3v13H3z"/><path d="M12 11v5"/></svg>`;
const ICON_CHEVRON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="var(--muted)" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg>`;
const ICON_UNDO = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 10a8 8 0 1 1 2 5"/><path d="M4 4v6h6"/></svg>`;
const ICON_CHECK = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="var(--coral-ink)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>`;
const ICON_FLAG = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4"/><path d="M5 4h13l-3 4 3 4H5"/></svg>`;

/**
 * @param {object} event
 * @param {{ onHideEvent(): void, onBlockArtist(): void, onBlockType(): void, onReportIssue(): void }} handlers
 */
export function openExcludeMenu(event, handlers) {
  const headliner = event.headliners[0] ?? event.title_raw;
  const type = event.tags_type[0];

  const html = `
    <div class="overlay-scrim" data-close></div>
    <div class="sheet" role="dialog" aria-modal="true">
      <div class="sheet-handle"></div>
      <div class="sheet-header">
        <div class="sheet-header__title">${escapeHtml(headliner)}</div>
        <div class="sheet-header__sub">${escapeHtml(event.date)} · ${escapeHtml(event.venue)}</div>
      </div>
      <button class="sheet-option" data-action="hide-event">
        <span class="sheet-option__icon">${ICON_EVENT}</span>
        <span class="sheet-option__label">只隱藏這一場</span>
        ${ICON_CHEVRON}
      </button>
      <button class="sheet-option" data-action="block-artist">
        <span class="sheet-option__icon sheet-option__icon--accent">${ICON_ARTIST}</span>
        <span class="sheet-option__label">封鎖此演出者：${escapeHtml(headliner)}</span>
        ${ICON_CHEVRON}
      </button>
      ${
        type
          ? `<button class="sheet-option" data-action="block-type">
              <span class="sheet-option__icon">${ICON_TYPE}</span>
              <span class="sheet-option__label">封鎖此類型：${escapeHtml(type)}</span>
              ${ICON_CHEVRON}
            </button>`
          : ""
      }
      <button class="sheet-option" data-action="report-issue" style="border-top:1px solid var(--border);margin-top:6px;padding-top:14px;">
        <span class="sheet-option__icon">${ICON_FLAG}</span>
        <span class="sheet-option__label">回報這場資訊有誤</span>
        ${ICON_CHEVRON}
      </button>
      <button class="btn-ghost" data-close style="margin:14px 22px 0;width:calc(100% - 44px);">取消</button>
    </div>
  `;

  overlayRoot().innerHTML = html;
  const root = overlayRoot();
  root.querySelectorAll("[data-close]").forEach((el) => el.addEventListener("click", clearOverlay));
  root.querySelector('[data-action="hide-event"]')?.addEventListener("click", () => {
    clearOverlay();
    handlers.onHideEvent();
  });
  root.querySelector('[data-action="block-artist"]')?.addEventListener("click", () => {
    clearOverlay();
    handlers.onBlockArtist();
  });
  root.querySelector('[data-action="block-type"]')?.addEventListener("click", () => {
    clearOverlay();
    handlers.onBlockType();
  });
  root.querySelector('[data-action="report-issue"]')?.addEventListener("click", () => {
    clearOverlay();
    handlers.onReportIssue();
  });
}

/** FR-xx (2026-09-22): free-text issue report for one card, prefilled with enough context (title/date/venue) that Max doesn't have to go hunting for which event this was about. */
export function openReportDialog(event, onSubmit) {
  const title = event.headliners?.length ? event.headliners.join(" / ") : event.title_raw;
  const html = `
    <div class="overlay-scrim" data-close></div>
    <div class="dialog-box" role="dialog" aria-modal="true">
      <div class="dialog-box__title">回報這場資訊有誤</div>
      <div class="dialog-box__body">「${escapeHtml(title)}」・${escapeHtml(event.date)} ${escapeHtml(event.venue ?? "")}</div>
      <div class="field-group">
        <label class="field-label" for="report-description">哪裡不對？（例如：時間/票價/場館錯誤、場次已取消、重複顯示…）</label>
        <textarea class="field-input" id="report-description" rows="4" placeholder="請描述問題"></textarea>
      </div>
      <div style="display:flex;gap:10px;">
        <button class="btn-ghost" data-close style="flex:1;">取消</button>
        <button class="btn-primary" data-confirm style="flex:1;">送出</button>
      </div>
    </div>
  `;
  overlayRoot().innerHTML = html;
  const root = overlayRoot();
  root.querySelectorAll("[data-close]").forEach((el) => el.addEventListener("click", clearOverlay));
  root.querySelector("[data-confirm]")?.addEventListener("click", () => {
    const description = root.querySelector("#report-description").value.trim();
    if (!description) return;
    clearOverlay();
    onSubmit(description);
  });
}

/**
 * Single-select bottom sheet for the timeline's city/month/price filter
 * chips (SPEC §6). Picking any option applies it immediately and closes —
 * no separate "confirm" step, matching openExcludeMenu's one-tap style.
 * @param {string} title
 * @param {{label: string, value: string|number|null}[]} options - value: null means "no filter"
 * @param {string|number|null} currentValue
 * @param {(value: string|number|null) => void} onSelect
 */
export function openFilterSheet(title, options, currentValue, onSelect) {
  const html = `
    <div class="overlay-scrim" data-close></div>
    <div class="sheet" role="dialog" aria-modal="true">
      <div class="sheet-handle"></div>
      <div class="sheet-header">
        <div class="sheet-header__title">${escapeHtml(title)}</div>
      </div>
      ${options
        .map(
          (opt, i) => `
        <button class="sheet-option" data-index="${i}">
          <span class="sheet-option__label">${escapeHtml(opt.label)}</span>
          ${opt.value === currentValue ? ICON_CHECK : ""}
        </button>`,
        )
        .join("")}
      <button class="btn-ghost" data-close style="margin:14px 22px 0;width:calc(100% - 44px);">取消</button>
    </div>
  `;
  overlayRoot().innerHTML = html;
  const root = overlayRoot();
  root.querySelectorAll("[data-close]").forEach((el) => el.addEventListener("click", clearOverlay));
  root.querySelectorAll("[data-index]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const opt = options[Number(btn.dataset.index)];
      clearOverlay();
      onSelect(opt.value);
    });
  });
}

/** FR-48: shown before blocking an artist who has favorited events. */
export function confirmBlockArtist(artistName, favoritedCount, onConfirm) {
  const html = `
    <div class="overlay-scrim" data-close></div>
    <div class="dialog-box" role="dialog" aria-modal="true">
      <div class="dialog-box__title">封鎖此演出者？</div>
      <div class="dialog-box__body">
        「${escapeHtml(artistName)}」目前有 <b style="color:var(--text);">${favoritedCount} 場已收藏</b>的場次。封鎖後這些場次仍會照常顯示（收藏優先於排除規則），只是該演出者未來的其他新場次將不再出現。
      </div>
      <div style="display:flex;gap:10px;">
        <button class="btn-ghost" data-close style="flex:1;">取消</button>
        <button class="btn-primary" data-confirm style="flex:1;">仍要封鎖</button>
      </div>
    </div>
  `;
  overlayRoot().innerHTML = html;
  const root = overlayRoot();
  root.querySelectorAll("[data-close]").forEach((el) => el.addEventListener("click", clearOverlay));
  root.querySelector("[data-confirm]")?.addEventListener("click", () => {
    clearOverlay();
    onConfirm();
  });
}

let toastTimer = null;

/** FR-45/US-12: 5-second undo toast. Calling this again replaces any toast still showing. */
export function showUndoToast(message, onUndo) {
  clearTimeout(toastTimer);
  const existing = document.getElementById("undo-toast");
  existing?.remove();

  const toast = document.createElement("div");
  toast.id = "undo-toast";
  toast.className = "toast";
  toast.innerHTML = `
    <div class="toast__row">
      <span>${escapeHtml(message)}</span>
      <button class="toast__undo">${ICON_UNDO}復原</button>
    </div>
    <div class="toast__bar"><div class="toast__bar-fill"></div></div>
  `;
  document.body.appendChild(toast);

  toast.querySelector(".toast__undo").addEventListener("click", () => {
    clearTimeout(toastTimer);
    toast.remove();
    onUndo();
  });

  toastTimer = setTimeout(() => toast.remove(), 5000);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * FR-16/US-16 (SPEC M8): 待整理頁「指派藝人」. Only collects the fields
 * needed to build an artists.yml entry — it never writes the file itself
 * (this is a static frontend, and M8 is explicitly a manual-commit dev
 * action per SPEC §11).
 * @param {{ title_raw?: string }} item
 * @param {(fields: { canonical: string, aliases: string[], tagsOrigin: string }) => void} onSubmit
 */
export function openAssignArtistDialog(item, onSubmit) {
  const guessedName = (item.title_raw ?? "").split(/[-–(（]/)[0].trim();

  const html = `
    <div class="overlay-scrim" data-close></div>
    <div class="dialog-box" role="dialog" aria-modal="true">
      <div class="dialog-box__title">指派藝人</div>
      <div class="dialog-box__body">原始標題：「${escapeHtml(item.title_raw ?? "")}」</div>
      <div class="field-group">
        <label class="field-label" for="assign-canonical">正式藝人名稱</label>
        <input class="field-input" id="assign-canonical" type="text" value="${escapeHtml(guessedName)}" />
      </div>
      <div class="field-group">
        <label class="field-label" for="assign-aliases">別名（逗號分隔，選填）</label>
        <input class="field-input" id="assign-aliases" type="text" placeholder="例如：暱稱、英文拼寫" />
      </div>
      <div class="field-group">
        <label class="field-label" for="assign-origin">來源地</label>
        <select class="field-input" id="assign-origin">
          <option value="本地">本地</option>
          <option value="亞洲其他">亞洲其他</option>
          <option value="日韓">日韓</option>
          <option value="歐美">歐美</option>
        </select>
      </div>
      <div style="display:flex;gap:10px;">
        <button class="btn-ghost" data-close style="flex:1;">取消</button>
        <button class="btn-primary" data-confirm style="flex:1;">產生 YAML</button>
      </div>
    </div>
  `;
  overlayRoot().innerHTML = html;
  const root = overlayRoot();
  root.querySelectorAll("[data-close]").forEach((el) => el.addEventListener("click", clearOverlay));
  root.querySelector("[data-confirm]")?.addEventListener("click", () => {
    const canonical = root.querySelector("#assign-canonical").value.trim();
    if (!canonical) return;
    const aliases = root
      .querySelector("#assign-aliases")
      .value.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const tagsOrigin = root.querySelector("#assign-origin").value;
    clearOverlay();
    onSubmit({ canonical, aliases, tagsOrigin });
  });
}

/** Shows a copyable YAML snippet for the user to paste into data/artists.yml by hand. */
export function showYamlSnippetDialog(snippet) {
  const html = `
    <div class="overlay-scrim" data-close></div>
    <div class="dialog-box" role="dialog" aria-modal="true">
      <div class="dialog-box__title">貼到 data/artists.yml</div>
      <div class="dialog-box__body">
        複製下面這段，貼到 <code>data/artists.yml</code> 檔案最後，存檔後 commit，下次 <code>npm run fetch</code> 就會正確歸類這位藝人的場次。
      </div>
      <textarea class="field-input" readonly rows="5" style="font-family:ui-monospace,monospace;font-size:12px;" id="yaml-snippet">${escapeHtml(snippet)}</textarea>
      <div style="display:flex;gap:10px;margin-top:10px;">
        <button class="btn-ghost" data-close style="flex:1;">關閉</button>
        <button class="btn-primary" data-copy style="flex:1;">複製</button>
      </div>
    </div>
  `;
  overlayRoot().innerHTML = html;
  const root = overlayRoot();
  root.querySelectorAll("[data-close]").forEach((el) => el.addEventListener("click", clearOverlay));
  root.querySelector("[data-copy]")?.addEventListener("click", async () => {
    const textarea = root.querySelector("#yaml-snippet");
    try {
      await navigator.clipboard.writeText(textarea.value);
      root.querySelector("[data-copy]").textContent = "已複製";
    } catch {
      textarea.focus();
      textarea.select();
    }
  });
}

/**
 * 2026-09-22: replaces the old always-on-first-visit, dismiss-forever intro
 * card (Max: 內容變長之後想改成彈窗，機制照現有 .dialog-box 走) — this is
 * reachable any time from the ⓘ icon in the topbar instead of showing once
 * and then being gone for good, and now also covers the two features added
 * the same day (report an issue, on-sale calendar reminder) that the old
 * card predates.
 */
export function openIntroDialog() {
  const html = `
    <div class="overlay-scrim" data-close></div>
    <div class="dialog-box" role="dialog" aria-modal="true">
      <div class="dialog-box__title">LiveRadar 是什麼？</div>
      <div class="dialog-box__body">
        把 KKTIX、拓元、iNDIEVOX、FANSI GO、Ticket Plus 的音樂展演演出全部收在一起，不用再一個一個網站翻。
      </div>
      <div style="font-size:12px;color:var(--muted);line-height:1.9;border-top:1px solid var(--border);padding-top:10px;">
        ★ 收藏喜歡的場次，✕ 排除不想看到的，之後都會記住。<br>
        可以篩城市、月份、類型、地區、價格，也可以直接搜尋演出者。<br>
        登入帳號後，換裝置也不會不見。<br>
        🚩 場次資訊有誤？卡片的 ✕ 選單裡可以直接回報。<br>
        🔔 尚未開賣的場次可以加入行事曆，開賣前會提醒你。
      </div>
      <button class="btn-ghost" data-close style="margin-top:14px;width:100%;">關閉</button>
    </div>
  `;
  overlayRoot().innerHTML = html;
  const root = overlayRoot();
  root.querySelectorAll("[data-close]").forEach((el) => el.addEventListener("click", clearOverlay));
}
