(() => {
  const addRowBtn = document.getElementById("addRow");
  const table = document.getElementById("itemsTable");
  const tpl = document.getElementById("rowTemplate");
  const isPaidEl = document.getElementById("isPaid");
  const paymentWrap = document.getElementById("paymentMethodWrap");
  const grandTotalEl = document.getElementById("grandTotal");

  function formatRupiah(number) {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      minimumFractionDigits: 0,
    }).format(number);
  }

  function updatePaymentVisibility() {
    if (!isPaidEl || !paymentWrap) return;
    paymentWrap.style.display = String(isPaidEl.value) === "1" ? "block" : "none";
  }

  function calculateGrandTotal() {
    if (!table || !grandTotalEl) return;
    const rowTotals = table.querySelectorAll(".js-row-total");
    let total = 0;
    rowTotals.forEach((el) => {
      const val = parseInt(el.getAttribute("data-value") || "0", 10);
      total += val;
    });
    grandTotalEl.textContent = formatRupiah(total);
  }

  function updateRowCalculations(row) {
    const select = row.querySelector(".js-product-select");
    const qtyInput = row.querySelector(".js-qty-input");
    const unitPriceEl = row.querySelector(".js-unit-price");
    const rowTotalEl = row.querySelector(".js-row-total");

    if (!select || !qtyInput || !unitPriceEl || !rowTotalEl) return;

    const selectedOption = select.options[select.selectedIndex];
    const price = parseInt(selectedOption.getAttribute("data-price") || "0", 10);
    const qty = parseInt(qtyInput.value || "0", 10);
    const total = price * qty;

    unitPriceEl.textContent = formatRupiah(price);
    rowTotalEl.textContent = formatRupiah(total);
    rowTotalEl.setAttribute("data-value", total);

    calculateGrandTotal();
  }

  function onTableChange(e) {
    const row = e.target.closest(".itemRow");
    if (!row) return;
    if (e.target.classList.contains("js-product-select") || e.target.classList.contains("js-qty-input")) {
      updateRowCalculations(row);
    }
  }

  function onRemoveClick(e) {
    const btn = e.target.closest(".js-remove");
    if (!btn) return;
    const row = btn.closest("tr");
    if (!row) return;
    const tbody = row.parentElement;
    if (tbody && tbody.querySelectorAll("tr").length <= 1) return;
    row.remove();
    calculateGrandTotal();
  }

  function addRow() {
    if (!tpl || !table) return;
    const tbody = table.querySelector("tbody");
    const node = tpl.content.cloneNode(true);
    tbody.appendChild(node);
  }

  updatePaymentVisibility();
  if (isPaidEl) isPaidEl.addEventListener("change", updatePaymentVisibility);
  if (addRowBtn) addRowBtn.addEventListener("click", addRow);
  if (table) {
    table.addEventListener("click", onRemoveClick);
    table.addEventListener("change", onTableChange);
    table.addEventListener("input", onTableChange); // For quantity typing
  }

  // Initial calculation for first row
  const firstRow = table.querySelector(".itemRow");
  if (firstRow) updateRowCalculations(firstRow);
})();

