import { describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { PageGrid } from "./PageGrid";
import type { PdfSource } from "@/core/pdf/types";

/**
 * Test d'intégration du glisser-déposer de réorganisation.
 *
 * Rejoue la séquence pointeur réelle (pointerdown sur une carte, puis
 * pointermove/pointerup au niveau **fenêtre**) et vérifie le cas historiquement
 * cassé : saisir la page 5 et la déposer devant la page 1. On dispatche des
 * `MouseEvent` typés `pointer*` (jsdom ne construit pas de `PointerEvent` mais
 * transporte bien `clientX/clientY` sur un `MouseEvent`). Les rectangles de mise
 * en page, absents en jsdom, sont simulés pour aligner les cartes.
 */

const SOURCE: PdfSource = { name: "doc.pdf", bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]) };

function layoutCards(cards: Element[]): void {
  cards.forEach((card, i) => {
    vi.spyOn(card, "getBoundingClientRect").mockReturnValue({
      left: i * 100,
      top: 0,
      right: i * 100 + 80,
      bottom: 100,
      width: 80,
      height: 100,
      x: i * 100,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
  });
}

function pointer(type: string, clientX: number, clientY: number): MouseEvent {
  return new MouseEvent(type, { clientX, clientY, bubbles: true, cancelable: true });
}

describe("PageGrid — glisser-déposer", () => {
  it("déplace la page 5 devant la page 1", () => {
    const onReorder = vi.fn();
    const { container } = render(
      <PageGrid source={SOURCE} pageCount={5} order={[1, 2, 3, 4, 5]} onReorder={onReorder} />,
    );
    const cards = Array.from(container.querySelectorAll('[role="button"]'));
    expect(cards).toHaveLength(5);
    layoutCards(cards);

    act(() => cards[4].dispatchEvent(pointer("pointerdown", 440, 50))); // page 5, centre x=440
    act(() => window.dispatchEvent(pointer("pointermove", 5, 50))); // tout à gauche
    act(() => window.dispatchEvent(pointer("pointerup", 5, 50)));

    expect(onReorder).toHaveBeenCalledTimes(1);
    expect(onReorder).toHaveBeenCalledWith([5, 1, 2, 3, 4]);
  });

  it("déplace une page du début vers la fin", () => {
    const onReorder = vi.fn();
    const { container } = render(
      <PageGrid source={SOURCE} pageCount={5} order={[1, 2, 3, 4, 5]} onReorder={onReorder} />,
    );
    const cards = Array.from(container.querySelectorAll('[role="button"]'));
    layoutCards(cards);

    act(() => cards[0].dispatchEvent(pointer("pointerdown", 40, 50))); // page 1
    act(() => window.dispatchEvent(pointer("pointermove", 480, 50))); // après la dernière
    act(() => window.dispatchEvent(pointer("pointerup", 480, 50)));

    expect(onReorder).toHaveBeenCalledWith([2, 3, 4, 5, 1]);
  });

  it("ne réordonne pas sur un simple clic (sans déplacement)", () => {
    const onReorder = vi.fn();
    const { container } = render(
      <PageGrid source={SOURCE} pageCount={5} order={[1, 2, 3, 4, 5]} onReorder={onReorder} />,
    );
    const cards = Array.from(container.querySelectorAll('[role="button"]'));
    layoutCards(cards);

    act(() => cards[2].dispatchEvent(pointer("pointerdown", 240, 50))); // page 3
    act(() => window.dispatchEvent(pointer("pointerup", 240, 50))); // relâché au même endroit

    expect(onReorder).not.toHaveBeenCalled();
  });

  it("annule proprement sur pointercancel", () => {
    const onReorder = vi.fn();
    const { container } = render(
      <PageGrid source={SOURCE} pageCount={5} order={[1, 2, 3, 4, 5]} onReorder={onReorder} />,
    );
    const cards = Array.from(container.querySelectorAll('[role="button"]'));
    layoutCards(cards);

    act(() => cards[4].dispatchEvent(pointer("pointerdown", 440, 50)));
    act(() => window.dispatchEvent(pointer("pointermove", 5, 50)));
    act(() => window.dispatchEvent(pointer("pointercancel", 5, 50)));

    expect(onReorder).not.toHaveBeenCalled();
  });
});
