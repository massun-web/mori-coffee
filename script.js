"use strict";

// Mobile navigation: keyboard users can close with Escape or cycle through links.
const toggle = document.querySelector(".menu-toggle");
const nav = document.querySelector(".main-nav");
const mobile = window.matchMedia("(max-width: 760px)");

function setMenu(open, returnFocus = false) {
  toggle.setAttribute("aria-expanded", String(open));
  toggle.querySelector(".menu-label").textContent = open ? "CLOSE" : "MENU";
  nav.classList.toggle("is-open", open);
  document.body.classList.toggle("menu-open", open);
  if (returnFocus) toggle.focus();
}

toggle.addEventListener("click", () => setMenu(toggle.getAttribute("aria-expanded") !== "true"));
nav.addEventListener("click", (event) => {
  const link = event.target.closest("a");
  if (!link) return;
  setMenu(false);
  if (mobile.matches) {
    const target = document.querySelector(link.getAttribute("href"));
    target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
    target.addEventListener("blur", () => target.removeAttribute("tabindex"), { once: true });
  }
});
document.addEventListener("keydown", (event) => {
  if (toggle.getAttribute("aria-expanded") !== "true") return;
  if (event.key === "Escape") setMenu(false, true);
  if (event.key === "Tab") {
    const lastLink = nav.querySelector("a:last-child");
    if (event.shiftKey && document.activeElement === toggle) {
      event.preventDefault(); lastLink.focus();
    } else if (!event.shiftKey && document.activeElement === lastLink) {
      event.preventDefault(); toggle.focus();
    }
  }
});
mobile.addEventListener("change", () => setMenu(false));

// Content stays visible if JavaScript or IntersectionObserver is unavailable.
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
if ("IntersectionObserver" in window && !reducedMotion.matches) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.remove("is-pending");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.08 });
  document.querySelectorAll(".reveal").forEach((element) => {
    element.classList.add("is-pending");
    observer.observe(element);
  });
  reducedMotion.addEventListener("change", (event) => {
    if (event.matches) {
      observer.disconnect();
      document.querySelectorAll(".is-pending").forEach((element) => element.classList.remove("is-pending"));
    }
  });
}

// No fictional account is linked to an unrelated real person or business.
const dialog = document.querySelector(".social-dialog");
document.querySelector("[data-instagram]").addEventListener("click", () => dialog.showModal());
document.querySelector(".dialog-close").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (event) => {
  if (event.target !== dialog) return;
  const bounds = dialog.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
});
