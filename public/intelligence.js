(() => {
  "use strict";

  const state = { sources: [], taxonomy: {}, file: null, preview: null, activePost: null };
  const byId = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  const display = (value) => value === null || value === undefined || value === "" ? "—" : String(value);
  const metric = (value) => value === null || value === undefined ? "—" : Number(value).toLocaleString();
  const label = (value) => display(value).replaceAll("_", " ");

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: { "content-type": "application/json", "x-content-intelligence-request": "1", ...(options.headers || {}) }
    });
    const result = await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }));
    if (!response.ok || !result.ok) throw Object.assign(new Error(result.error || "Request failed."), { status: response.status, result });
    return result;
  }

  function notify(message, error = false) {
    const toast = byId("toast");
    toast.textContent = message;
    toast.className = `toast show${error ? " error" : ""}`;
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => { toast.className = "toast"; }, 3200);
  }

  function optionMarkup(values, selected = null, includeBlank = true) {
    return `${includeBlank ? '<option value="">Not classified</option>' : ""}${values.map((value) => `<option value="${escapeHtml(value)}"${value === selected ? " selected" : ""}>${escapeHtml(label(value))}</option>`).join("")}`;
  }

  function showRoute() {
    const route = location.hash === "#intelligence-import" ? "import" : location.hash === "#intelligence-posts" ? "posts" : "production";
    byId("productionView").hidden = route !== "production";
    byId("intelligenceView").hidden = route === "production";
    byId("intelligencePosts").hidden = route !== "posts";
    byId("intelligenceImport").hidden = route !== "import";
    byId("workspaceEyebrow").textContent = route === "production" ? "PRIVATE PRODUCTION WORKSPACE" : "FACEBOOK DATA FOUNDATION";
    byId("workspaceTitle").textContent = route === "production" ? "Content AI Production Console" : route === "posts" ? "Content Intelligence · Posts" : "Content Intelligence · Import";
    document.querySelectorAll(".workflow-nav a").forEach((link) => link.classList.toggle("active", route !== "production" && link.dataset.intelligenceRoute === route));
    if (route === "production") document.querySelector('[data-production-link]')?.classList.add("active");
    if (route === "posts") loadPosts();
  }

  async function loadFoundation() {
    try {
      const result = await api("/api/intelligence/sources");
      state.sources = result.sources;
      state.taxonomy = result.taxonomy;
      const sourceOptions = state.sources.map((source) => `<option value="${escapeHtml(source.source_id)}">${escapeHtml(source.name)} · ${escapeHtml(source.source_role)}</option>`).join("");
      byId("postSource").insertAdjacentHTML("beforeend", sourceOptions);
      byId("importSource").insertAdjacentHTML("beforeend", sourceOptions);
      byId("postTopic").insertAdjacentHTML("beforeend", optionMarkup(state.taxonomy.topic, null, false));
      byId("postFormat").insertAdjacentHTML("beforeend", optionMarkup(state.taxonomy.content_format, null, false));
    } catch (error) {
      byId("postsState").textContent = error.message;
      notify(error.message, true);
    }
  }

  function postQuery() {
    const pairs = {
      search: byId("postSearch").value, source_id: byId("postSource").value, role: byId("postRole").value,
      topic: byId("postTopic").value, format: byId("postFormat").value, date_from: byId("postDateFrom").value,
      date_to: byId("postDateTo").value, classification_status: byId("postClassification").value, sort: byId("postSort").value,
      limit: "200"
    };
    return new URLSearchParams(Object.entries(pairs).filter(([, value]) => value)).toString();
  }

  async function loadPosts() {
    byId("postsState").textContent = "Loading…";
    try {
      const result = await api(`/api/intelligence/posts?${postQuery()}`);
      byId("postCount").textContent = `${result.total} post${result.total === 1 ? "" : "s"}`;
      byId("postsState").textContent = result.total ? "Loaded" : "No imported data";
      byId("postsBody").innerHTML = result.posts.length ? result.posts.map((post) => {
        const metrics = post.latest_metrics || {};
        const classification = post.classification || {};
        return `<tr data-post-id="${escapeHtml(post.post_id)}" tabindex="0">
          <td>${escapeHtml(post.published_at ? post.published_at.slice(0, 10) : "—")}</td>
          <td>${escapeHtml(post.source_name)}</td><td><span class="role-badge role-${escapeHtml(post.source_role)}">${escapeHtml(post.source_role)}</span></td>
          <td class="preview-cell"><strong>${escapeHtml(post.title_or_hook || post.external_post_id || "Untitled post")}</strong><span>${escapeHtml((post.caption || "No caption").slice(0, 110))}</span></td>
          <td>${escapeHtml(label(classification.content_format))}</td><td>${escapeHtml(label(classification.topic))}</td><td>${escapeHtml(label(classification.hook))}</td><td>${escapeHtml(label(classification.emotion))}</td>
          <td class="numeric">${metric(metrics.reaction_count)}</td><td class="numeric">${metric(metrics.comment_count)}</td><td class="numeric">${metric(metrics.share_count)}</td><td class="numeric">${metric(metrics.view_count)}</td><td class="numeric">${metric(metrics.reach_count)}</td>
          <td><span class="status-dot ${classification.classification_source ? "is-classified" : ""}"></span>${classification.classification_source ? "Classified" : "Review"}</td></tr>`;
      }).join("") : '<tr><td colspan="14" class="empty-cell">No posts match these filters.</td></tr>';
    } catch (error) {
      byId("postsState").textContent = `Error: ${error.message}`;
      byId("postsBody").innerHTML = `<tr><td colspan="14" class="empty-cell">${escapeHtml(error.message)}</td></tr>`;
    }
  }

  function classificationSelect(field, value) {
    const taxonomyKey = field === "secondary_topic" ? "topic" : field;
    return `<label><span>${escapeHtml(label(field))}</span><select data-classification="${field}">${optionMarkup(state.taxonomy[taxonomyKey] || [], value)}</select></label>`;
  }

  async function openPost(postId) {
    try {
      const { post } = await api(`/api/intelligence/posts/${encodeURIComponent(postId)}`);
      state.activePost = post;
      const metrics = post.latest_metrics || {};
      const classification = post.classification || {};
      byId("drawerTitle").textContent = post.title_or_hook || post.external_post_id || "Facebook post";
      byId("drawerBody").innerHTML = `
        <section class="drawer-section"><p class="eyebrow">SOURCE POST</p><p class="full-caption">${escapeHtml(post.caption || "No caption imported.")}</p>
          <dl class="detail-list"><dt>Facebook URL</dt><dd>${post.post_url ? `<a href="${escapeHtml(post.post_url)}" target="_blank" rel="noopener">Open original post</a>` : "—"}</dd><dt>Publish date</dt><dd>${escapeHtml(display(post.published_at))}</dd><dt>Source</dt><dd>${escapeHtml(post.source_name)} · ${escapeHtml(post.source_role)}</dd><dt>Media reference</dt><dd class="break-word">${escapeHtml(display(post.media_reference))}</dd></dl></section>
        <section class="drawer-section"><p class="eyebrow">LATEST METRIC SNAPSHOT</p><div class="metric-strip">${["reaction_count", "comment_count", "share_count", "view_count", "reach_count", "click_count"].map((field) => `<div><span>${escapeHtml(label(field.replace("_count", "")))}</span><strong>${metric(metrics[field])}</strong></div>`).join("")}</div><p class="helper">Captured ${escapeHtml(display(metrics.captured_at))} · ${escapeHtml(display(metrics.metric_scope))}</p></section>
        <section class="drawer-section"><p class="eyebrow">MANUAL CLASSIFICATION</p><div class="drawer-form">${["topic", "secondary_topic", "hook", "emotion", "content_format", "visual", "intent"].map((field) => classificationSelect(field, classification[field])).join("")}
          <label><span>Confidence (0–1)</span><input data-classification="confidence" type="number" min="0" max="1" step="0.05" value="${escapeHtml(classification.confidence ?? "")}"></label>
          <label class="wide"><span>Notes</span><textarea data-classification="notes" maxlength="2000">${escapeHtml(classification.notes || "")}</textarea></label></div>
          <p class="classification-meta">Source: ${escapeHtml(display(classification.classification_source))} · Last updated: ${escapeHtml(display(classification.updated_at))}</p><button class="btn btn-primary" id="saveClassification" type="button">Save Manual Correction</button></section>
        <section class="drawer-section"><button class="raw-toggle" id="toggleRaw" type="button">View Raw Import Data</button><pre class="raw-data" id="rawData" hidden>${escapeHtml(JSON.stringify(post.raw_records.map((raw) => ({ import_batch_id: raw.import_batch_id, row_number: raw.row_number, imported_at: raw.imported_at, validation_status: raw.validation_status, original: JSON.parse(raw.original_json), warnings: parseRaw(raw.validation_warnings_json) })), null, 2))}</pre></section>`;
      byId("drawerBackdrop").hidden = false;
      byId("postDrawer").classList.add("open");
      byId("postDrawer").setAttribute("aria-hidden", "false");
      byId("saveClassification").addEventListener("click", saveClassification);
      byId("toggleRaw").addEventListener("click", () => { byId("rawData").hidden = !byId("rawData").hidden; });
    } catch (error) { notify(error.message, true); }
  }

  function parseRaw(value) { try { return JSON.parse(value); } catch (_) { return value; } }

  async function saveClassification() {
    const body = {};
    document.querySelectorAll("[data-classification]").forEach((input) => { body[input.dataset.classification] = input.value || null; });
    try {
      await api(`/api/intelligence/posts/${encodeURIComponent(state.activePost.post_id)}/classification`, { method: "PATCH", body: JSON.stringify(body) });
      notify("Manual classification saved.");
      await openPost(state.activePost.post_id);
      await loadPosts();
    } catch (error) { notify(error.message, true); }
  }

  function closeDrawer() {
    byId("drawerBackdrop").hidden = true;
    byId("postDrawer").classList.remove("open");
    byId("postDrawer").setAttribute("aria-hidden", "true");
  }

  async function readSelectedFile() {
    const file = byId("importFile").files[0];
    if (!file) throw new Error("Choose a CSV or JSON file first.");
    if (file.size > 5 * 1024 * 1024) throw new Error("Import file exceeds the 5 MB limit.");
    state.file = { name: file.name, content: await file.text() };
  }

  function importPayload(mapping = undefined) {
    return {
      source_id: byId("importSource").value,
      file_name: state.file?.name,
      content: state.file?.content,
      captured_at: byId("importCapturedAt").value ? new Date(byId("importCapturedAt").value).toISOString() : new Date().toISOString(),
      metric_scope: byId("importMetricScope").value,
      ...(mapping ? { mapping } : {})
    };
  }

  async function previewImport(mapping = undefined) {
    try {
      if (!mapping) await readSelectedFile();
      if (!byId("importSource").value) throw new Error("Choose My Page or Benchmark first.");
      byId("previewImport").disabled = true;
      const result = await api("/api/intelligence/import/preview", { method: "POST", body: JSON.stringify(importPayload(mapping)) });
      state.preview = result.preview;
      renderPreview();
    } catch (error) { notify(error.message, true); }
    finally { byId("previewImport").disabled = false; }
  }

  function renderPreview() {
    const preview = state.preview;
    byId("mappingCard").hidden = false;
    byId("qualityCard").hidden = false;
    byId("previewCard").hidden = false;
    byId("mappingGrid").innerHTML = Object.keys(preview.mapping).map((field) => `<label><span>${escapeHtml(field)}</span><select data-map-field="${escapeHtml(field)}"><option value="">Not mapped</option>${preview.headers.map((header) => `<option value="${escapeHtml(header)}"${preview.mapping[field] === header ? " selected" : ""}>${escapeHtml(header)}</option>`).join("")}</select></label>`).join("");
    const qualityLabels = { total_rows: "Total rows", valid_posts: "Valid posts", duplicates: "Duplicate posts in file", missing_post_id: "Missing post ID", missing_date: "Missing date", missing_caption: "Missing caption", missing_metrics: "Missing metrics", warnings: "Warnings" };
    byId("qualityMetrics").innerHTML = Object.entries(qualityLabels).map(([key, text]) => `<div><span>${text}</span><strong>${metric(preview.quality[key])}</strong></div>`).join("");
    byId("coverageMetrics").innerHTML = Object.entries(preview.quality.metric_coverage).map(([key, value]) => `<div><span>${escapeHtml(label(key))}</span><strong>${value}%</strong><i><b style="width:${Math.min(value, 100)}%"></b></i></div>`).join("");
    const messages = [...preview.fatal_errors.map((message) => ({ type: "fatal", message })), ...preview.warnings.slice(0, 12).map((warning) => ({ type: "warning", message: `Row ${warning.row}: ${warning.message}` }))];
    byId("importWarnings").innerHTML = messages.length ? messages.map((item) => `<p class="${item.type}">${escapeHtml(item.message)}</p>`).join("") : '<p class="success">Validation passed with no warnings.</p>';
    byId("importPreviewBody").innerHTML = preview.sample_rows.map((row) => `<tr><td>${row.row_number}</td><td>${escapeHtml(display(row.post.external_post_id))}</td><td>${escapeHtml(row.post.published_at?.slice(0, 10) || "—")}</td><td class="preview-cell"><span>${escapeHtml((row.post.caption || "No caption").slice(0, 120))}</span></td><td>${escapeHtml(label(row.post.content_format))}</td><td>${metric(row.metrics.reaction_count)}</td><td>${metric(row.metrics.comment_count)}</td><td>${metric(row.metrics.share_count)}</td><td>${row.valid ? (row.warnings.length ? "Warning" : "Valid") : "Invalid"}</td></tr>`).join("");
    byId("reprocessLabel").hidden = !preview.duplicate_import;
    byId("allowReprocess").checked = false;
    byId("confirmImport").disabled = preview.fatal_errors.length > 0 || Boolean(preview.duplicate_import);
    byId("importResult").hidden = true;
  }

  function selectedMapping() {
    return Object.fromEntries([...document.querySelectorAll("[data-map-field]")].map((select) => [select.dataset.mapField, select.value || null]));
  }

  async function confirmImport() {
    const button = byId("confirmImport");
    button.disabled = true;
    try {
      const payload = { ...importPayload(state.preview.mapping), preview_hash: state.preview.preview_hash, allow_reprocess: byId("allowReprocess").checked };
      const { result } = await api("/api/intelligence/import/confirm", { method: "POST", body: JSON.stringify(payload) });
      byId("importResult").hidden = false;
      byId("importResult").innerHTML = `<strong>Import complete · ${escapeHtml(result.status.toLowerCase())}</strong><div><span>Posts imported <b>${result.posts_imported}</b></span><span>Posts updated <b>${result.posts_updated}</b></span><span>Metric snapshots <b>${result.metric_snapshots_created}</b></span><span>Duplicates skipped <b>${result.duplicates_skipped}</b></span><span>Warnings <b>${result.warnings}</b></span></div>`;
      notify("Import stored successfully.");
    } catch (error) { notify(error.message, true); button.disabled = false; }
  }

  function bindEvents() {
    window.addEventListener("hashchange", showRoute);
    byId("refreshPosts").addEventListener("click", loadPosts);
    ["postSource", "postRole", "postTopic", "postFormat", "postDateFrom", "postDateTo", "postClassification", "postSort"].forEach((id) => byId(id).addEventListener("change", loadPosts));
    let searchTimer;
    byId("postSearch").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(loadPosts, 250); });
    byId("postsBody").addEventListener("click", (event) => { const row = event.target.closest("tr[data-post-id]"); if (row) openPost(row.dataset.postId); });
    byId("postsBody").addEventListener("keydown", (event) => { const row = event.target.closest("tr[data-post-id]"); if (row && ["Enter", " "].includes(event.key)) openPost(row.dataset.postId); });
    byId("closeDrawer").addEventListener("click", closeDrawer);
    byId("drawerBackdrop").addEventListener("click", closeDrawer);
    byId("previewImport").addEventListener("click", () => previewImport());
    byId("applyMapping").addEventListener("click", () => previewImport(selectedMapping()));
    byId("confirmImport").addEventListener("click", confirmImport);
    byId("allowReprocess").addEventListener("change", () => { byId("confirmImport").disabled = state.preview.fatal_errors.length > 0 || !byId("allowReprocess").checked; });
  }

  document.addEventListener("DOMContentLoaded", async () => {
    const local = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    byId("importCapturedAt").value = local;
    bindEvents();
    await loadFoundation();
    showRoute();
  });
})();
