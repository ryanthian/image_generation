(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  const readable = (value) => String(value || "—").replaceAll("_", " ");
  const signals = [["save_potential", "Save potential"], ["share_potential", "Share potential"], ["local_relevance", "Local relevance"], ["affiliate_fit", "Affiliate fit"], ["saturation", "Saturation"], ["novelty", "Novelty"], ["claim_risk", "Claim risk"], ["visual_potential", "Visual potential"]];
  let opportunities = [];

  function stored() { try { return JSON.parse(localStorage.getItem("content-ai-v4-2-approved") || "[]"); } catch (_) { return []; } }
  function save(items) { localStorage.setItem("content-ai-v4-2-approved", JSON.stringify(items)); }
  function productionDraft(opportunity) {
    const contentType = opportunity.recommended_template === "COLLECTION_GUIDE" ? "COLLECTION" : opportunity.recommended_template === "MISTAKE_BEFORE_AFTER" ? "MISTAKE_FIX" : opportunity.recommended_template === "RECIPE_STANDARD" ? "RECIPE" : opportunity.recommended_template === "KITCHEN_TECHNIQUE" ? "KITCHEN_HACK" : "SELECTION_GUIDE";
    return { Schema_Version: 4, Content_ID: `V4-2-${opportunity.opportunity_id}`, Title: opportunity.title, Topic: opportunity.topic, Content_Type: contentType, Template_Type: opportunity.recommended_template, Hook_Type: opportunity.hook_pattern, Hook_Text: opportunity.topic === "JEWELRY_CRYSTAL_CULTURE" ? `在一些佩戴文化中，${opportunity.title}` : opportunity.title, Caption: "", Status: "APPROVED_FOR_PRODUCTION", Opportunity_ID: opportunity.opportunity_id };
  }
  function render() {
    const approved = new Set(stored().map((item) => item.opportunity_id));
    $("opportunityCount").textContent = `${opportunities.length} explainable canary opportunities`;
    $("opportunityGrid").innerHTML = opportunities.map((item) => `<article class="card opportunity-card">
      <div class="opportunity-title"><p class="eyebrow">${escapeHtml(readable(item.content_mechanism))}</p><h3>${escapeHtml(item.title)}</h3><span class="badge">${escapeHtml(readable(item.recommended_template))}</span></div>
      <dl class="opportunity-meta"><div><dt>User need</dt><dd>${escapeHtml(readable(item.user_need))}</dd></div><div><dt>Mechanism</dt><dd>${escapeHtml(readable(item.content_mechanism))}</dd></div></dl>
      <div class="signal-grid">${signals.map(([key, label]) => `<div><span>${label}</span><b class="signal-${escapeHtml(String(item[key]).toLowerCase())}">${escapeHtml(readable(item[key]))}</b></div>`).join("")}</div>
      <section class="opportunity-evidence"><p class="eyebrow">WHY THIS WAS SURFACED</p><ul>${item.evidence_notes.slice(0, 4).map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul></section>
      <div class="opportunity-actions"><button class="btn btn-neutral" data-review="${escapeHtml(item.opportunity_id)}">Review evidence</button><button class="btn btn-primary" data-approve="${escapeHtml(item.opportunity_id)}" ${approved.has(item.opportunity_id) ? "disabled" : ""}>${approved.has(item.opportunity_id) ? "Approved for Production" : "Approve for Production"}</button><button class="text-action" data-skip="${escapeHtml(item.opportunity_id)}">Skip</button></div>
    </article>`).join("");
  }
  function showDetail(item) {
    $("opportunityDetail").hidden = false;
    $("opportunityDetail").innerHTML = `<p class="eyebrow">EVIDENCE REVIEW · HUMAN DECISION REQUIRED</p><h3>${escapeHtml(item.title)}</h3><p>Historical observations are planning evidence only. This system does not predict reach, earnings, or virality.</p><pre>${escapeHtml(JSON.stringify({ normalized_historical_metrics: item.historical_evidence, saturation: item.saturation, novelty: item.novelty, claim_risk: item.claim_risk }, null, 2))}</pre>`;
    $("opportunityDetail").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  function bind() {
    $("opportunityGrid").addEventListener("click", (event) => {
      const id = event.target.dataset.review || event.target.dataset.approve || event.target.dataset.skip;
      if (!id) return;
      const item = opportunities.find((candidate) => candidate.opportunity_id === id); if (!item) return;
      if (event.target.dataset.review) return showDetail(item);
      if (event.target.dataset.skip) { event.target.closest("article").hidden = true; return; }
      const approvals = stored();
      if (approvals.some((approved) => approved.opportunity_id === id)) return;
      approvals.push({ ...item, approval_status: "APPROVED", approved_at: new Date().toISOString(), production_draft: productionDraft(item) }); save(approvals); localStorage.setItem("capc:selectedSource", "V4.2 Approved Opportunities"); window.dispatchEvent(new Event("capc-approved-opportunity")); render();
      $("opportunityDetail").hidden = false;
      $("opportunityDetail").innerHTML = `<p class="eyebrow">APPROVED · PRODUCTION HANDOFF READY</p><h3>${escapeHtml(item.title)}</h3><p>This opportunity is now an approved V4-compatible draft in this browser. It has not created images, final assets, a Sheet record, a batch, or a Facebook post.</p><a class="btn btn-success" href="#recipe">Open existing V4.1 production workflow</a>`;
    });
  }
  document.addEventListener("DOMContentLoaded", async () => {
    try { const response = await fetch("/api/opportunities/canary"); const payload = await response.json(); if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not load opportunity canary."); opportunities = payload.opportunities; render(); bind(); }
    catch (error) { $("opportunityGrid").innerHTML = `<p class="empty-cell">${escapeHtml(error.message)}</p>`; }
  });
})();
