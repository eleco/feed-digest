for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-filter]",
))
  button.addEventListener("click", () => {
    const filter = button.dataset.filter;
    for (const b of document.querySelectorAll("[data-filter]"))
      b.setAttribute("aria-pressed", String(b === button));
    for (const card of document.querySelectorAll<HTMLElement>("[data-feed]"))
      card.hidden = filter !== "all" && card.dataset.feed !== filter;
  });
