export function makeDraggable(container, handle) {
  let isDragging = false, initialX, initialY, boxX, boxY;

  function dragStart(e) {
    e.preventDefault();
    isDragging = true;
    initialX = e.clientX;
    initialY = e.clientY;
    const rect = container.getBoundingClientRect();
    boxX = rect.left;
    boxY = rect.top;
    container.style.removeProperty("bottom");
    container.style.removeProperty("right");
    container.style.left = `${boxX}px`;
    container.style.top = `${boxY}px`;
    container.style.cursor = "grabbing";
  }

  function dragging(e) {
    if (!isDragging) return;
    container.style.left = `${boxX + (e.clientX - initialX)}px`;
    container.style.top = `${boxY + (e.clientY - initialY)}px`;
  }

  function dragEnd() {
    isDragging = false;
    container.style.cursor = "grab";
  }

  handle.addEventListener("mousedown", dragStart);
  document.addEventListener("mousemove", dragging);
  document.addEventListener("mouseup", dragEnd);
}
