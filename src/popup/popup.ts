const btn = document.getElementById("toggle") as HTMLButtonElement;
const dot = document.getElementById("dot") as HTMLElement;
const note = document.getElementById("note") as HTMLElement;

function setActive(on: boolean) {
  dot.style.background = on ? "#fb923c" : "#4b5563";
  btn.childNodes[btn.childNodes.length - 1].textContent = on ? " Панель увімкнена" : " Панель вимкнена";
}

function setNoPage() {
  dot.style.background = "#4b5563";
  btn.childNodes[btn.childNodes.length - 1].textContent = " Відкрий YouTube";
  btn.disabled = true;
  btn.style.opacity = "0.5";
  note.textContent = "Перейди на youtube.com або studio.youtube.com";
}

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const tabId = tabs[0]?.id;
  if (!tabId) { setNoPage(); return; }

  chrome.tabs.sendMessage(tabId, { type: "GET_PANEL_STATE" }, (resp) => {
    if (chrome.runtime.lastError || !resp) { setNoPage(); return; }
    setActive(resp.visible ?? true);
  });

  btn.addEventListener("click", () => {
    chrome.tabs.sendMessage(tabId, { type: "TOGGLE_PANEL" }, (resp) => {
      if (chrome.runtime.lastError || !resp) return;
      setActive(resp.visible ?? true);
    });
  });
});
