/* ============================================================
   Password gate — hides the journal until the password is entered.
   Client-side only: keeps casual visitors out, not a real lock.
   ============================================================ */

(() => {
  "use strict";

  // SHA-256 of the password, so the plain text isn't in the source.
  const HASH = "2e50541b9dd3b0ae30bac8de947d49f5cc78693558a97cc4781694ad302cbc77";
  const KEY = "thesis-journal-unlocked";

  const root = document.documentElement;

  let unlocked = false;
  try { unlocked = localStorage.getItem(KEY) === HASH; } catch (_) {}
  if (unlocked) return;

  root.classList.add("is-locked");

  async function sha256(text) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function build() {
    const gate = document.createElement("form");
    gate.className = "gate";
    gate.innerHTML = `
      <h1 class="gate-title">Thesis Journal</h1>
      <label class="gate-label" for="gateInput">Password</label>
      <input id="gateInput" class="gate-input" type="password" autocomplete="current-password" autofocus />
      <button type="submit" class="add-btn gate-btn">Enter</button>
      <p class="gate-error" id="gateError" hidden>That's not it — try again.</p>
    `;
    document.body.appendChild(gate);

    const input = gate.querySelector("#gateInput");
    const error = gate.querySelector("#gateError");
    input.focus();

    gate.addEventListener("submit", async (e) => {
      e.preventDefault();
      if ((await sha256(input.value)) === HASH) {
        try { localStorage.setItem(KEY, HASH); } catch (_) {}
        root.classList.remove("is-locked");
        gate.remove();
      } else {
        error.hidden = false;
        input.value = "";
        input.focus();
      }
    });
  }

  if (document.body) build();
  else document.addEventListener("DOMContentLoaded", build);
})();
