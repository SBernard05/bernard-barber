
"use strict";

// Bernard Barber – společný skript pro všechny stránky.
// Rezervační funkce se spouští pouze na stránce s formulářem.
(() => {
  const form = document.getElementById("reservationForm");
  if (!form) return;

  const SUPABASE_URL = "https://chwgszwodpbphnzlrmvg.supabase.co";
  const TURNSTILE_SITE_KEY = "0x4AAAAAAFmV_ScnKFpbRsGC";
  const serviceIds = { haircut: 1, beard: 2, "hair-beard": 3 };
  const dateInput = document.getElementById("date");
  const timeSelect = document.getElementById("time");
  const bookingButton = form.querySelector('button[type="submit"]');
  const toastContainer = document.getElementById("toast-container");
  const turnstileContainer = document.getElementById("turnstile-container");

  if (!dateInput || !timeSelect || !bookingButton || !toastContainer || !turnstileContainer) {
    console.error("Bernard Barber: Chybí některý prvek rezervačního formuláře.");
    return;
  }

  let isBooking = false;
  let slotsRequestId = 0;
  let widgetId = null;
  let verificationPending = null;
  const originalButtonText = bookingButton.textContent;

  function pragueDate() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Prague",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date());

    const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}`;
  }

  function updateMinimumDate() {
    dateInput.min = pragueDate();

    if (dateInput.value && dateInput.value < dateInput.min) {
      dateInput.value = "";
      setTimePlaceholder("Nejdřív vyber den");
    }
  }

  function setTimePlaceholder(message) {
    timeSelect.replaceChildren(new Option(message, ""));
    timeSelect.disabled = true;
  }

  // --------------------------------------
  // TOAST NOTIFICATIONS
  // --------------------------------------

  function showToast(type, title, message) {
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.setAttribute("role", type === "error" ? "alert" : "status");

    const icon = document.createElement("span");
    icon.className = "toast-icon";
    icon.textContent = type === "success" ? "✓" : "!";

    const content = document.createElement("div");
    content.className = "toast-content";

    const heading = document.createElement("strong");
    heading.textContent = title;

    const description = document.createElement("span");
    description.textContent = message;

    content.append(heading, description);

    const close = document.createElement("button");
    close.type = "button";
    close.className = "toast-close";
    close.textContent = "×";
    close.setAttribute("aria-label", "Zavřít oznámení");

    close.addEventListener("click", () => toast.remove());

    toast.append(icon, content, close);
    toastContainer.append(toast);

    window.setTimeout(() => toast.remove(), 6000);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // --------------------------------------
  // SERVER RESPONSE
  // --------------------------------------

  async function parseResponse(response) {
    const raw = await response.text();
    let data = {};

    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      // Server nevrátil JSON.
    }

    if (!response.ok) {
      if (response.status === 409) {
        throw new Error("Tento čas už je obsazen. Vyber prosím jiný.");
      }

      if (response.status === 403) {
        throw new Error("Bezpečnostní ověření se nezdařilo. Zkus to znovu.");
      }

      throw new Error(
        typeof data.error === "string"
          ? data.error
          : `Server vrátil chybu ${response.status}.`
      );
    }

    return data;
  }

  // --------------------------------------
  // AVAILABLE TIMES
  // --------------------------------------

  async function loadAvailableTimes() {
    const requestId = ++slotsRequestId;
    const selectedDate = dateInput.value;

    setTimePlaceholder(
      selectedDate ? "Načítám volné termíny…" : "Nejdřív vyber den"
    );

    if (!selectedDate) return;

    updateMinimumDate();
    if (!dateInput.value) return;

    try {
      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/available-slots`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            date: selectedDate
          })
        }
      );

      const data = await parseResponse(response);

      if (
        requestId !== slotsRequestId ||
        dateInput.value !== selectedDate
      ) {
        return;
      }

      const slots = Array.isArray(data.slots) ? data.slots : [];

      const times = [
        ...new Set(
          slots.map(slot => {
            const raw =
              typeof slot === "string"
                ? slot
                : slot?.start_time ??
                  slot?.slot_time ??
                  slot?.time;

            if (typeof raw !== "string") return null;

            const match = raw.match(
              /(?:^|T)(\d{2}:\d{2})(?::\d{2})?/
            );

            return match ? match[1] : null;
          }).filter(Boolean)
        )
      ].sort();

      setTimePlaceholder(
        times.length ? "Vyber čas" : "Žádné volné termíny"
      );

      for (const time of times) {
        timeSelect.add(new Option(time, time));
      }

      timeSelect.disabled = times.length === 0;

    } catch (error) {
      if (requestId !== slotsRequestId) return;

      console.error("Načtení termínů:", error);

      setTimePlaceholder("Termíny se nepodařilo načíst");

      showToast(
        "error",
        "Chyba při načítání",
        "Volné termíny se nepodařilo načíst. Zkus to později."
      );
    }
  }

  // --------------------------------------
  // CLOUDFLARE TURNSTILE
  // --------------------------------------

  function waitForTurnstile() {
    return new Promise((resolve, reject) => {
      const start = Date.now();

      function check() {
        if (
          window.turnstile &&
          typeof window.turnstile.render === "function"
        ) {
          return resolve();
        }

        if (Date.now() - start > 12000) {
          return reject(
            new Error(
              "Bezpečnostní ověření se nenačetlo. Obnov stránku."
            )
          );
        }

        window.setTimeout(check, 100);
      }

      check();
    });
  }

  async function verifyVisitor() {
    await waitForTurnstile();

    if (widgetId === null) {
      widgetId = window.turnstile.render(
        turnstileContainer,
        {
          sitekey: TURNSTILE_SITE_KEY,
          size: "invisible",
          execution: "execute",
          appearance: "interaction-only",

          callback(token) {
            settleVerification(null, token);
          },

          "error-callback"() {
            settleVerification(
              new Error("Bezpečnostní ověření selhalo.")
            );
          },

          "expired-callback"() {
            settleVerification(
              new Error("Bezpečnostní ověření vypršelo.")
            );
          },

          "timeout-callback"() {
            settleVerification(
              new Error(
                "Bezpečnostní ověření trvalo příliš dlouho."
              )
            );
          }
        }
      );
    }

    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(
        () => settleVerification(
          new Error("Ověření vypršelo. Zkus to znovu.")
        ),
        30000
      );

      verificationPending = {
        resolve,
        reject,
        timeout
      };

      try {
        window.turnstile.execute(widgetId);
      } catch (error) {
        settleVerification(error);
      }
    });
  }

  function settleVerification(error, token) {
    if (!verificationPending) return;

    const pending = verificationPending;
    verificationPending = null;

    window.clearTimeout(pending.timeout);

    if (error) {
      pending.reject(error);
    } else {
      pending.resolve(token);
    }
  }

  function resetVerification() {
    if (widgetId !== null && window.turnstile) {
      try {
        window.turnstile.reset(widgetId);
      } catch (error) {
        console.warn("Turnstile reset:", error);
      }
    }
  }

  // --------------------------------------
  // INITIALIZATION
  // --------------------------------------

  dateInput.addEventListener("change", loadAvailableTimes);
  window.addEventListener("focus", updateMinimumDate);

  updateMinimumDate();
  setTimePlaceholder("Nejdřív vyber den");

  // --------------------------------------
  // CREATE BOOKING
  // --------------------------------------

  form.addEventListener("submit", async event => {
    event.preventDefault();

    if (isBooking || !form.reportValidity()) return;

    if (
      !dateInput.value ||
      dateInput.value < pragueDate() ||
      !timeSelect.value
    ) {
      showToast(
        "error",
        "Neplatný termín",
        "Vyber prosím platný den a volný čas."
      );
      return;
    }

    const serviceId =
      serviceIds[document.getElementById("service").value];

    if (!serviceId) {
      return showToast(
        "error",
        "Neplatná služba",
        "Vyber prosím službu."
      );
    }

    isBooking = true;
    bookingButton.disabled = true;
    bookingButton.textContent = "ODESÍLÁM REZERVACI…";

    try {
      const token = await verifyVisitor();

      const booking = {
        name: document.getElementById("name").value.trim(),
        phone: document.getElementById("phone").value.trim(),
        email: document.getElementById("email").value.trim(),
        service_id: serviceId,
        date: dateInput.value,
        time: timeSelect.value,
        note: document.getElementById("note").value.trim(),
        turnstile_token: token
      };

      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/create-booking`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(booking)
        }
      );

      const data = await parseResponse(response);

      if (data.success !== true) {
        throw new Error(
          typeof data.error === "string"
            ? data.error
            : "Rezervaci se nepodařilo potvrdit."
        );
      }

      // SUCCESS
      form.reset();
      ++slotsRequestId;

      setTimePlaceholder("Nejdřív vyber den");
      updateMinimumDate();

      showToast(
        "success",
        "Rezervace potvrzena!",
        "Termín byl úspěšně rezervován. Zkontroluj svůj e-mail."
      );

    } catch (error) {
      console.error("Rezervace:", error);

      showToast(
        "error",
        "Rezervace se nezdařila",
        error?.message || "Zkus to prosím znovu."
      );

      if (dateInput.value) {
        await loadAvailableTimes();
      }

    } finally {
      resetVerification();

      isBooking = false;
      bookingButton.disabled = false;
      bookingButton.textContent = originalButtonText;
    }
  });
})();
