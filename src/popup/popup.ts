const btn = document.getElementById("toggle") as HTMLButtonElement;
const dot = document.getElementById("dot") as HTMLElement;
const note = document.getElementById("note") as HTMLElement;

// i18n: detect if Ukrainian/Russian or other
const isUk = /^(uk|ru)/i.test(navigator.language);
const t = {
  panelOn:   isUk ? " Панель увімкнена"  : " Panel enabled",
  panelOff:  isUk ? " Панель вимкнена"   : " Panel disabled",
  openYT:    isUk ? " Відкрий YouTube"    : " Open YouTube",
  note:      isUk ? "Відкрий YouTube або YouTube Studio, потім натисни кнопку вище."
                   : "Open YouTube or YouTube Studio, then click the button above.",
  subscribe: isUk ? "✈ Підписатись на Telegram" : "✈ Subscribe on Telegram",
};

// Apply i18n to static elements
note.textContent = t.note;
const subLink = document.getElementById("sub-link");
if (subLink) subLink.textContent = t.subscribe;

function setActive(on: boolean) {
  dot.style.background = on ? "#fb923c" : "#4b5563";
  btn.childNodes[btn.childNodes.length - 1].textContent = on ? t.panelOn : t.panelOff;
}

function setNoPage() {
  dot.style.background = "#4b5563";
  btn.childNodes[btn.childNodes.length - 1].textContent = t.openYT;
  btn.disabled = true;
  btn.style.opacity = "0.5";
  note.textContent = isUk ? "Перейди на youtube.com або studio.youtube.com"
                          : "Go to youtube.com or studio.youtube.com";
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
