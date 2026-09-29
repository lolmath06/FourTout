import { afterEach, describe, expect, it } from "vitest";
import { installPolyfills } from "./polyfills";

type MutableProto = {
  [Symbol.asyncIterator]?: unknown;
  values?: unknown;
};

const proto = ReadableStream.prototype as unknown as MutableProto;

describe("polyfill ReadableStream asyncIterator", () => {
  const original = proto[Symbol.asyncIterator];
  const originalValues = proto.values;

  afterEach(() => {
    Object.defineProperty(proto, Symbol.asyncIterator, {
      value: original,
      writable: true,
      configurable: true,
    });
    proto.values = originalValues;
  });

  it("rétablit l'itération asynchrone quand elle manque (cas WebKitGTK)", async () => {
    // Simule l'absence de l'API, comme dans WebKitGTK 2.46.
    delete proto[Symbol.asyncIterator];
    delete proto.values;
    expect(proto[Symbol.asyncIterator]).toBeUndefined();

    installPolyfills();
    expect(typeof proto[Symbol.asyncIterator]).toBe("function");

    // Reproduit exactement le motif de pdf.js getTextContent().
    const stream = new ReadableStream<string>({
      start(controller) {
        controller.enqueue("PAGE 1");
        controller.enqueue("PAGE 2");
        controller.enqueue("PAGE 3");
        controller.close();
      },
    });
    const collected: string[] = [];
    for await (const value of stream as unknown as AsyncIterable<string>) {
      collected.push(value);
    }
    expect(collected).toEqual(["PAGE 1", "PAGE 2", "PAGE 3"]);
  });

  it("ne remplace pas une implémentation déjà présente", () => {
    const existing = function* () {};
    Object.defineProperty(proto, Symbol.asyncIterator, {
      value: existing,
      writable: true,
      configurable: true,
    });
    installPolyfills();
    expect(proto[Symbol.asyncIterator]).toBe(existing);
  });
});
