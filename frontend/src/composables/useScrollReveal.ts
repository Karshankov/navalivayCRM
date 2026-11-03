/**
 * Reveal-анимации при скролле: элементы плавно поднимаются и
 * проявляются, когда входят в вьюпорт (IntersectionObserver).
 *
 * Дизайн: каскад 40мс между соседями, GPU-дружелюбные свойства
 * (opacity/transform), отключается при prefers-reduced-motion.
 * Использование: v-reveal-children на контейнере списка.
 */
import type { Directive } from "vue";

/** Директива на контейнер: дети получают reveal при входе в вьюпорт. */
export const vRevealChildren: Directive<HTMLElement> = {
  mounted(el, binding) {
    const cascade = Number(binding.value ?? 40);
    const children = Array.from(el.children) as HTMLElement[];
    if (!children.length) return;

    if (typeof IntersectionObserver === "undefined") return;

    // Reduced motion — без анимаций, всё видно сразу.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    children.forEach((child, index) => {
      child.classList.add("reveal-item");
      child.style.transitionDelay = `${Math.min(index * cascade, 320)}ms`;
    });

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            (entry.target as HTMLElement).classList.add("reveal-item--visible");
            observer.unobserve(entry.target);
          }
        }
      },
      // Чуть ниже центра — карточка «доезжает» до глаз.
      { root: null, rootMargin: "0px 0px -8% 0px", threshold: 0.05 },
    );

    children.forEach((child) => observer.observe(child));
    (el as HTMLElement & { __revealObserver?: IntersectionObserver }).__revealObserver = observer;
  },
  unmounted(el) {
    const holder = el as HTMLElement & { __revealObserver?: IntersectionObserver };
    holder.__revealObserver?.disconnect();
    holder.__revealObserver = undefined;
  },
};

/** Глобальные стили reveal-анимации (подключаются в main.ts). */
export const SCROLL_REVEAL_CSS = `
.reveal-item {
  opacity: 0;
  transform: translateY(16px);
  transition: opacity 0.45s cubic-bezier(0.22, 1, 0.36, 1),
    transform 0.45s cubic-bezier(0.22, 1, 0.36, 1);
  will-change: opacity, transform;
}

.reveal-item--visible {
  opacity: 1;
  transform: none;
  will-change: auto;
}

@media (prefers-reduced-motion: reduce) {
  .reveal-item {
    opacity: 1;
    transform: none;
    transition: none;
  }
}
`;

export function useScrollReveal() {
  return { vRevealChildren };
}
