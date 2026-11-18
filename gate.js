const heading = document.getElementById("heading");
const message = document.getElementById("message");
const countdown = document.getElementById("countdown");
const button = document.getElementById("access");
const targetUrl = location.hash.slice(1);

function showBlocked() {
  heading.textContent = "ACCESO BLOQUEADO";
  message.textContent = "Vete a hacer algo más, no desperdicie su tiempo.";
  countdown.textContent = "";
  button.hidden = true;
}

async function initialize() {
  try {
    const state = await chrome.runtime.sendMessage({ type: "gate:getState", targetUrl });
    if (state.status === "blocked") {
      showBlocked();
      return;
    }
    if (state.status !== "waiting") {
      throw new Error("No se pudo identificar el sitio solicitado.");
    }

    let remaining = state.waitSeconds;
    const updateCountdown = () => {
      if (remaining <= 0) {
        countdown.textContent = "";
        button.hidden = false;
        return;
      }
      countdown.textContent = `Podrás acceder en ${remaining} segundos.`;
      remaining--;
      setTimeout(updateCountdown, 1000);
    };
    updateCountdown();
  } catch (error) {
    heading.textContent = "No se pudo iniciar";
    message.textContent = error.message;
    countdown.textContent = "";
  }
}

button.addEventListener("click", async () => {
  button.disabled = true;
  button.textContent = "Iniciando...";
  try {
    const result = await chrome.runtime.sendMessage({ type: "gate:start", targetUrl });
    if (result.ok) return;
    if (result.blocked) {
      showBlocked();
      return;
    }
    throw new Error(result.error || "No se pudo iniciar la sesión.");
  } catch (error) {
    heading.textContent = "No se pudo iniciar";
    message.textContent = error.message;
    button.disabled = false;
    button.textContent = "Acceder";
  }
});

void initialize();
