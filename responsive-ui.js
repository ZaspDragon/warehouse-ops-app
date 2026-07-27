document.write('<script src="responsive-ui-core.js?v=20260726"><\/script>');

document.addEventListener("DOMContentLoaded", () => {
  const tabs = document.querySelector("nav.tabs");
  if (!tabs || tabs.querySelector('[data-receiving-tools="true"]')) return;

  const productionLink = document.createElement("a");
  productionLink.href = "production.html";
  productionLink.className = "tab";
  productionLink.dataset.receivingTools = "true";
  productionLink.textContent = "Receiving Production";
  productionLink.setAttribute("aria-label", "Open truck and pallet receiving production");

  const checkerLink = document.createElement("a");
  checkerLink.href = "po-checking.html";
  checkerLink.className = "tab";
  checkerLink.dataset.receivingTools = "true";
  checkerLink.textContent = "PO Checking";
  checkerLink.setAttribute("aria-label", "Open PO checker production");

  tabs.append(productionLink, checkerLink);
});
