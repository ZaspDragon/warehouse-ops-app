(function () {
  document.write('<script src="responsive-ui-core.js?v=20260726-navigation"><\/script>');

  document.addEventListener("DOMContentLoaded", () => {
    const tabs = document.querySelector("nav.tabs");
    if (!tabs) return;

    const addLink = (href, label, key) => {
      if (tabs.querySelector(`[data-page-link="${key}"]`)) return;
      const link = document.createElement("a");
      link.href = href;
      link.className = "tab";
      link.dataset.pageLink = key;
      link.textContent = label;
      link.setAttribute("aria-label", `Open ${label}`);
      tabs.appendChild(link);
    };

    addLink("production.html", "Receiving Production", "receiving-production");
    addLink("po-checking.html", "PO Checking", "po-checking");
  });
})();
