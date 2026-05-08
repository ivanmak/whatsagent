import { expect, test } from "bun:test";

import { parseInteger, parseIntegerArray } from "../src/server/parse.ts";

test("parseInteger accepts integers and applies bounds", () => {
  expect(parseInteger(7)).toBe(7);
  expect(parseInteger("42")).toBe(42);
  expect(parseInteger("-1")).toBe(-1);
  expect(parseInteger(7, { min: 1, max: 10 })).toBe(7);
});

test("parseInteger uses default for missing values", () => {
  expect(parseInteger(undefined, { default: 50 })).toBe(50);
  expect(parseInteger(null, { default: 0 })).toBe(0);
  expect(parseInteger("", { default: 100 })).toBe(100);
});

test("parseInteger rejects non-integers", () => {
  expect(() => parseInteger("foo")).toThrow(/expected integer/);
  expect(() => parseInteger(1.5)).toThrow(/expected integer/);
  expect(() => parseInteger(NaN)).toThrow(/expected integer/);
  expect(() => parseInteger(Infinity)).toThrow(/expected integer/);
  expect(() => parseInteger("1e308")).toThrow(/expected integer/);
});

test("parseInteger rejects out-of-range values", () => {
  expect(() => parseInteger(0, { min: 1 })).toThrow(/below minimum 1/);
  expect(() => parseInteger(11, { max: 10 })).toThrow(/above maximum 10/);
});

test("parseInteger requires a value when no default is set", () => {
  expect(() => parseInteger(undefined)).toThrow(/integer is required/);
  expect(() => parseInteger(null)).toThrow(/integer is required/);
  expect(() => parseInteger("")).toThrow(/integer is required/);
});

test("parseIntegerArray accepts arrays and validates each element", () => {
  expect(parseIntegerArray([1, 2, 3], { min: 1 })).toEqual([1, 2, 3]);
  expect(parseIntegerArray(undefined)).toEqual([]);
  expect(parseIntegerArray(null)).toEqual([]);
  expect(() => parseIntegerArray("not-an-array")).toThrow(/expected an array/);
  expect(() => parseIntegerArray([1, "bad", 3])).toThrow(/expected integer/);
  expect(() => parseIntegerArray([1, 0, 3], { min: 1 })).toThrow(/below minimum 1/);
});
