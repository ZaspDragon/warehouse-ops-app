document.addEventListener("DOMContentLoaded", () => {
  const tabs = document.querySelector("nav.tabs");
  if (!tabs || tabs.querySelector('[data-production-link="true"]')) return;

  const link = document.createElement("a");
  link.href = "production.html";
  link.className = "tab";
  link.dataset.productionLink = "true";
  link.textContent = "Receiving Production";
  link.setAttribute("aria-label", "Open Receiving Production dashboard");
  tabs.appendChild(link);
});
