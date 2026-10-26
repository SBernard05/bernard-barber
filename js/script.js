
const SUPABASE_URL =
    "https://chwgszwodpbphnzlrmvg.supabase.co";

// Replace with your PUBLIC Cloudflare Site Key.
// Never put the Secret Key here.
const TURNSTILE_SITE_KEY =
    "0x4AAAAAAFmV_ScnKFpbRsGC";

const dateInput = document.getElementById("date");
const timeSelect = document.getElementById("time");
const bookingForm = document.querySelector(".booking-form");
const bookingButton = bookingForm.querySelector(
    'button[type="submit"]'
);
const bookingMessage = document.getElementById("booking-message");

const serviceIds = {
    haircut: 1,
    beard: 2,
    "hair-beard": 3
};

let turnstileWidgetId = null;
let pendingVerification = null;
let isBooking = false;

// --------------------------------------
// SET MINIMUM DATE
// --------------------------------------

const today = new Date();

const localToday = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0")
].join("-");

dateInput.min = localToday;

// --------------------------------------
// LOAD AVAILABLE TIMES
// --------------------------------------

async function loadAvailableTimes() {
    const selectedDate = dateInput.value;

    timeSelect.disabled = true;
    timeSelect.innerHTML =
        '<option value="">Loading available times...</option>';

    if (!selectedDate) {
        timeSelect.innerHTML =
            '<option value="">First select a date</option>';
        return;
    }

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

        if (!response.ok) {
            throw new Error("Could not load available times");
        }

        const result = await response.json();
        const slots = result.slots;

        // Ignore an outdated request if the date changed.
        if (dateInput.value !== selectedDate) {
            return;
        }

        timeSelect.innerHTML =
            '<option value="">Select a time</option>';

        if (!Array.isArray(slots) || slots.length === 0) {
            timeSelect.innerHTML =
                '<option value="">No available times</option>';
            return;
        }

        slots.forEach((slot) => {
            const start =
                typeof slot === "string"
                    ? slot
                    : slot.start_time ??
                      slot.slot_time ??
                      slot.time;

            if (!start) return;

            const option = document.createElement("option");

            option.value = start.slice(0, 5);
            option.textContent = start.slice(0, 5);

            timeSelect.appendChild(option);
        });

        timeSelect.disabled = timeSelect.options.length <= 1;

    } catch (error) {
        console.error("Available times error:", error);

        if (dateInput.value === selectedDate) {
            timeSelect.innerHTML =
                '<option value="">Unable to load times</option>';
        }
    }
}

dateInput.addEventListener("change", loadAvailableTimes);

// --------------------------------------
// CLOUDFLARE TURNSTILE
// --------------------------------------

function waitForTurnstile() {
    return new Promise((resolve, reject) => {
        const started = Date.now();

        const check = () => {
            if (
                window.turnstile &&
                typeof window.turnstile.render === "function"
            ) {
                resolve();
                return;
            }

            if (Date.now() - started > 10000) {
                reject(
                    new Error(
                        "Security verification could not load. Please refresh the page."
                    )
                );
                return;
            }

            setTimeout(check, 100);
        };

        check();
    });
}

async function initializeTurnstile() {
    await waitForTurnstile();

    if (
    TURNSTILE_SITE_KEY ===
    "PASTE_YOUR_TURNSTILE_SITE_KEY_HERE"
) {
    throw new Error("Cloudflare Site Key is not configured.");
}

    turnstileWidgetId = window.turnstile.render(
        "#turnstile-container",
        {
            sitekey: TURNSTILE_SITE_KEY,
            size: "invisible",
            execution: "execute",
            appearance: "interaction-only",

            callback: (token) => {
                if (pendingVerification) {
                    pendingVerification.resolve(token);
                    pendingVerification = null;
                }
            },

            "error-callback": () => {
                if (pendingVerification) {
                    pendingVerification.reject(
                        new Error(
                            "Security verification failed. Please try again."
                        )
                    );
                    pendingVerification = null;
                }
            },

            "expired-callback": () => {
                if (pendingVerification) {
                    pendingVerification.reject(
                        new Error(
                            "Security verification expired. Please try again."
                        )
                    );
                    pendingVerification = null;
                }
            },

            "timeout-callback": () => {
                if (pendingVerification) {
                    pendingVerification.reject(
                        new Error(
                            "Security verification timed out. Please try again."
                        )
                    );
                    pendingVerification = null;
                }
            }
        }
    );
}

const turnstileReady = initializeTurnstile().catch(
    (error) => {
        console.error("Turnstile initialization error:", error);
        throw error;
    }
);

async function getTurnstileToken() {
    await turnstileReady;

    if (turnstileWidgetId === null) {
        throw new Error("Security verification is unavailable.");
    }

    return new Promise((resolve, reject) => {
        pendingVerification = { resolve, reject };

        try {
            window.turnstile.execute(turnstileWidgetId);
        } catch (error) {
            pendingVerification = null;
            reject(error);
        }
    });
}

function resetTurnstile() {
    if (
        turnstileWidgetId !== null &&
        window.turnstile
    ) {
        window.turnstile.reset(turnstileWidgetId);
    }
}

// --------------------------------------
// BOOK APPOINTMENT
// --------------------------------------

bookingForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (isBooking || !bookingForm.reportValidity()) {
        return;
    }

    isBooking = true;
    bookingButton.disabled = true;
    bookingButton.textContent = "Booking...";
    bookingMessage.textContent = "";

    try {
        // Verify the visitor before creating a booking.
        const turnstileToken = await getTurnstileToken();

        const booking = {
            name: document.getElementById("name").value.trim(),
            phone: document.getElementById("phone").value.trim(),
            email: document.getElementById("email").value.trim(),

            service_id: serviceIds[
                document.getElementById("service").value
            ],

            date: dateInput.value,
            time: timeSelect.value,
            note: document.getElementById("note").value.trim(),

            turnstile_token: turnstileToken
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

        const result = await response.json();

        if (!response.ok || !result.success) {
            if (response.status === 409) {
                throw new Error(
                    "This time is already booked. Please choose another."
                );
            }

            if (response.status === 403) {
                throw new Error(
                    "Security verification failed. Please try again."
                );
            }

            throw new Error(
                result.error || "Booking failed. Please try again."
            );
        }

        // Successful booking
        bookingMessage.textContent =
            "Your appointment has been booked successfully!";

        bookingForm.reset();

        timeSelect.disabled = true;
        timeSelect.innerHTML =
            '<option value="">First select a date</option>';

    } catch (error) {
        console.error("Booking error:", error);

        bookingMessage.textContent =
            error.message || "Booking failed. Please try again.";

    } finally {
        resetTurnstile();

        isBooking = false;
        bookingButton.disabled = false;
        bookingButton.textContent = "Book Appointment";
    }
});
