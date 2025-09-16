const userInputState = {};

export function initializeInputListeners(elements) {
  elements.forEach(el => {
    if (!el.dataset.listenerAdded) {
      const key = el.id || el.name || el.dataset.testId || `input-${Math.random().toString(36).substring(7)}`;

      el.addEventListener("input", e => { userInputState[key] = e.target.value; });
      el.addEventListener("change", e => { userInputState[key] = e.target.value; });

      userInputState[key] = el.value;
      el.dataset.listenerAdded = true;
    }
  });
}

export function getDOMSnapshot() {
  const allElements = Array.from(document.querySelectorAll("body *"));
  const relevantElements = allElements.filter(el =>
    (el.innerText && el.innerText.trim()) ||
    el.getAttribute("data-test-id") ||
    ["INPUT", "TEXTAREA"].includes(el.tagName)
  );

  return relevantElements.map(el => {
    const elementData = {
      tagName: el.tagName,
      text: el.innerText?.trim() || "",
      dataTestId: el.getAttribute("data-test-id"),
      className: el.className
    };

    if (["INPUT", "TEXTAREA"].includes(el.tagName)) {
      const key = el.id || el.name || el.dataset.testId || "";
      elementData.value = userInputState[key] ?? el.value;
      if (["checkbox", "radio"].includes(el.type)) {
        elementData.checked = el.checked;
      }
    }
    return elementData;
  });
}
