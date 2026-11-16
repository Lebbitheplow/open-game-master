// Links from elsewhere on the page to one table settings row, marked
// data-settings-row (ROW_GROUP in table-settings-groups.ts names the group
// holding each): the Party panel's companion door, and the table language
// warning in the lobby and above the composer.

// Brings a table settings row into view once the Settings tab has mounted
// it (a moment after the switch) and flashes it, so "change this" lands on
// the one control meant rather than the top of a long panel. A row inside a
// closed group is mounted but hidden, so its group is opened first.
export function revealSettingsRow(row: string, tries = 40) {
  const element = document.querySelector<HTMLElement>(`[data-settings-row="${row}"]`);
  if (!element) {
    if (tries > 0) window.setTimeout(() => revealSettingsRow(row, tries - 1), 50);
    return;
  }
  const closed = element.closest<HTMLElement>(".cc-group:not([data-open])");
  if (closed) {
    closed.querySelector<HTMLButtonElement>(".cc-group-toggle")?.click();
    if (tries > 0) window.setTimeout(() => revealSettingsRow(row, tries - 1), 50);
    return;
  }
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  element.scrollIntoView({ block: "center", behavior: still ? "auto" : "smooth" });
  element.removeAttribute("data-flash");
  void element.offsetWidth;
  element.setAttribute("data-flash", "");
}
