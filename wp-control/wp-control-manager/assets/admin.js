document.addEventListener("submit", (event) => {
  const form = event.target.closest("form[data-wpc-confirm]");
  if (form && !window.confirm(form.dataset.wpcConfirm)) {
    event.preventDefault();
  }
});

document.addEventListener("change", (event) => {
  if (!event.target.matches("[data-wpc-select-all]")) {
    return;
  }
  const table = event.target.closest("table");
  for (const box of table.querySelectorAll('input[name="sites[]"]')) {
    box.checked = event.target.checked;
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || event.target.matches("input, textarea, select")) {
    return;
  }
  const close = document.querySelector(".wpc-drawer .wpc-close");
  if (close) {
    window.location.href = close.href;
  }
});
