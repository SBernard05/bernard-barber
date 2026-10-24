
const SUPABASE_URL = "https://chwgszwodpbphnzlrmvg.supabase.co";

const dateInput = document.getElementById("date");
const timeSelect = document.getElementById("time");

const today = new Date();
const localToday = [
  today.getFullYear(),
  String(today.getMonth() + 1).padStart(2, "0"),
  String(today.getDate()).padStart(2, "0")
].join("-");

dateInput.min = localToday;

dateInput.addEventListener("change", async () => {
  const selectedDate = dateInput.value;

  timeSelect.disabled = true;
  timeSelect.innerHTML = '<option value="">Loading available times...</option>';

  if (!selectedDate) {
    timeSelect.innerHTML = '<option value="">First select a date</option>';
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
        body: JSON.stringify({ date: selectedDate })
      }
    );

    if (!response.ok) {
      throw new Error("Could not load available times");
    }

    const result = await response.json();
    const slots = result.slots;

    timeSelect.innerHTML = '<option value="">Select a time</option>';

    if (!Array.isArray(slots) || slots.length === 0) {
      timeSelect.innerHTML =
        '<option value="">No available times</option>';
      return;
    }

    slots.forEach((slot) => {
      const start = typeof slot === "string"
        ? slot
        : slot.start_time ?? slot.slot_time ?? slot.time;

      if (!start) return;

      const option = document.createElement("option");
      option.value = start.slice(0, 5);
      option.textContent = start.slice(0, 5);
      timeSelect.appendChild(option);
    });

    timeSelect.disabled = timeSelect.options.length <= 1;

  } catch (error) {
    console.error(error);
    timeSelect.innerHTML =
      '<option value="">Unable to load times</option>';
  }
});
