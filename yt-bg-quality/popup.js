const toggle = document.getElementById("toggle");

chrome.storage.sync.get(["enabled"], (res) => {
  const enabled = typeof res.enabled === "boolean" ? res.enabled : true;
  toggle.checked = enabled;
});

toggle.addEventListener("change", () => {
  chrome.storage.sync.set({ enabled: toggle.checked });
});
