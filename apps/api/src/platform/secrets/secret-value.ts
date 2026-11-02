import { inspect } from "node:util";

/**
 * A decrypted secret. Prints as "[secret]" in logs, JSON, template strings and
 * util.inspect, so it cannot leak by accident; call reveal() at the point of use.
 */
export class SecretValue {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return "[secret]";
  }

  toJSON(): string {
    return "[secret]";
  }

  [inspect.custom](): string {
    return "[secret]";
  }
}
