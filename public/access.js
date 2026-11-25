const status = document.getElementById("access-status");

async function openFromLink() {
  const key = new URLSearchParams(location.hash.slice(1)).get("access");
  if (key === null) return;
  history.replaceState(null, "", location.pathname + location.search);
  if (/^[A-Za-z0-9_-]{32,128}$/.test(key)) {
    status.textContent = "Opening the dashboard…";
    try {
      const response = await fetch("/api/dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "open", key }),
      });
      if (response.ok) location.replace("/");
      else if (response.status === 401) status.textContent = "This access link is invalid. Use your current private link.";
      else status.textContent = "Could not open the dashboard. Try the private link again.";
    } catch {
      status.textContent = "Could not reach the dashboard. Try the private link again.";
    }
  } else {
    status.textContent = "This access link is incomplete. Open the full private link.";
  }
}

window.addEventListener("hashchange", openFromLink);
openFromLink();
